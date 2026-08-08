# 生产迁移与可观测部署设计

## 1. 设计目标

本设计把“进程启动”“数据库升级”“Worker 可消费”“应用可接流量”拆成可观察、可验证的独立状态，并让 embedded/dedicated 共用同一迁移、就绪、环境和回滚契约。

核心原则：普通启动只做可审计的前向迁移；历史接管和 repair 必须显式；liveness 不替代 readiness；所有自动化数据验证仅使用一次性资源。

## 2. 目标拓扑

```text
                 ┌── migrate deploy / schema gate ──┐
                 │                                  │
embedded: [start-prod] → [Go Worker] → readyz → [Next]
                 │          │                       │
                 └── 统一停止/失败传播 ─────────────┘

dedicated: [migrate job] → [Go Worker(s)] → [Next app]
                              │ shared lock     │
                              └──── readyz ─────┘
```

- embedded 适配 Zeabur 单服务、单公开端口。
- dedicated 适配 Compose 隔离验证及未来独立扩容。
- PostgreSQL 继续是 migration 状态、任务状态和拓扑互斥的共享事实来源。

## 3. 数据库发布设计

### 3.1 普通发布路径

`start-prod` 只负责：

1. 等待 `DATABASE_URL` 可连接。
2. 执行 `prisma migrate deploy`。
3. 执行只读 schema/preflight。
4. 按拓扑启动 Worker 与 Next。

删除普通路径中的空库 `db push`、P3005 自动 baseline、schema 相同即全量 resolve 和手写失败 migration repair。空库本身由 `migrate deploy` 执行全部 migrations 创建。

### 3.2 显式 baseline

提供独立运维入口，分为 inspect 与 apply：

- inspect 读取当前 schema、`_prisma_migrations`、Prisma diff 和本地 migration 列表，只生成报告；候选只能是从首个 migration 开始、无缺口的连续前缀。
- 报告记录脱敏连接身份、数据库/schema 标识、schema hash、每个本地 migration SQL checksum、生成时间和整体 digest，不记录密码或完整 DSN。
- apply 必须具备显式 sentinel、报告 digest 和已确认的连续 migration 前缀；执行前重新 inspect，数据库身份、schema hash 与 checksums 任一变化即拒绝，禁止“resolve all”或使用过期报告。
- apply 完成后立即运行 `migrate deploy` 与 schema probe。
- 非 runner 自建数据库不在自动测试中执行 apply；真实库操作必须另行确认。

### 3.3 显式 repair

- 普通 deploy 遇到 failed migration 直接失败。
- repair inspect 输出失败 migration、数据库中的 migration checksum、日志、schema 差异和建议动作。
- 如确有可重复 repair，放入按 migration ID 精确匹配的 allowlist 命令，并要求 sentinel、报告 digest、失败行/checksum/前置 schema 全匹配；不从普通启动调用。
- repair 后重新运行 deploy，并要求 migration 历史无未决失败且 schema diff 为零。
- 不提供通用“忽略失败并标记 applied”的快捷路径。

### 3.4 Disposable migration runner

复用 Worker 契约 runner 的安全模型：随机容器/数据库/端口、owner label、`--pull=never`、拒绝 `.env` 回退、按归属清理。PostgreSQL 数据目录强制挂载 tmpfs，容器兜底删除带 `--volumes`；清理前验证随机前缀和 owner label，验证后断言没有归属容器或卷残留。

固定场景：

- 空库完整 migrations。
- legacy schema 无迁移表：普通 deploy 失败，baseline inspect 精确，显式 apply 后升级成功。
- 注入 failed migration：普通 deploy 失败且历史未被自动改写。
- 特殊字符 URL：Prisma、Node 和 pgx 指向同一测试库。

## 4. 拓扑互斥与进程契约

### 4.1 配置

- `ENABLE_EMBEDDED_WORKER`：只由 app/supervisor 消费，决定是否派生 Worker。
- `WORKER_RUNTIME_MODE=embedded|dedicated`：由 Worker 消费，决定拓扑锁模式和日志身份。
- `WORKER_INTERNAL_URL`：Next/supervisor 使用的完整内部基址；embedded 默认 loopback，dedicated Compose 为服务名地址。
- `WORKER_READINESS_REQUIRED` 与 readiness timeout：定义生产是否必须具备生成消费能力，以及内部探针的有界等待。
- embedded supervisor 启动子进程时强制传入 `embedded`；Compose worker 强制传入 `dedicated`。

### 4.2 Advisory lock

Worker 使用独立 pgx connection 持有固定 advisory lock：

- embedded 使用 exclusive lock。
- dedicated 使用 shared lock。

因此多个 dedicated 可以同时运行；任何 embedded 与 dedicated 组合、第二个 embedded 都无法获取锁并失败退出。锁由独立 connection 持有并监控：连接丢失即触发 fatal fencing，先撤销 readiness 和 claim，再按 handoff/grace 契约有界 drain，最终非零退出；同一进程不自动重获锁后恢复消费。

### 4.3 启动与停止

- Worker 采用结构化并发：HTTP、拓扑锁监控、claim loops 和 processing 分别有独立生命周期，由统一协调器收敛错误。任一关键 goroutine 异常都会触发整体 shutdown 并返回非零。
- Worker HTTP server 先启动并进入 `booting`，然后获取拓扑锁、检查 DB/schema、启动 claim loops，最后转 `ready`。
- 收到 SIGTERM 或 fatal fencing 后先转 `draining`，readyz 立即 503，claim context 取消；processing context 在 grace 内继续。grace 后取消 processing，并受第二个 hard-stop deadline 约束，禁止无限等待。
- HTTP server 在 drain 窗口继续服务 healthz/readyz，直到 processing 收敛或 hard-stop；监听失败属于 fatal error。
- embedded supervisor 等 `/readyz` 而非 `/healthz`；Worker 或 Next 意外退出时停止其他子进程并传播非零退出。
- dedicated app 依赖 migrate completed + Worker ready；Worker 只依赖 migrate completed。

## 5. Health 与 Readiness 状态模型

```text
BOOTING → READY → DRAINING → STOPPED
   │        │
   └─依赖失败┴→ NOT_READY（进程仍可 health）
```

### Worker

- `/healthz`：HTTP server 可响应即 200；只返回版本、状态和时间，不访问 DB。
- `/readyz`：在短超时内检查 DB Ping、schema contract、拓扑锁、消费启动及非 draining。失败为 503，响应使用稳定 code，例如 `DATABASE_UNAVAILABLE`、`SCHEMA_NOT_READY`、`TOPOLOGY_CONFLICT`、`DRAINING`。
- 就绪检查不重新定义 GenerationJob 业务规则，只调用 Worker 契约任务提供的 probe。

### Next

- `/api/healthz`：进程存活，无 DB 查询。
- `/api/readyz`：验证 env 已解析、DB 可连接；`WORKER_READINESS_REQUIRED=true` 时，以 `WORKER_INTERNAL_URL` 和固定 timeout 调用内部 Worker `/readyz`。多副本由服务发现/负载均衡提供地址，任一成功 ready 响应即表示至少一个消费者可用。
- 对外 payload 不包含底层错误；日志保留内部 code 与 cause。

## 6. 指标与日志

### 指标

继续使用 JSON，避免本任务引入监控基础设施；增加 `schema_version: 1` 和稳定字段：

- queue：pending、processing、oldest_pending_age_ms。
- completion：succeeded、failed、success_rate、queued/processing/total duration。
- reliability：retry attempts、retry exhausted、unknown handoffs、error class counts。
- runtime：mode、ready state、draining、uptime；不暴露完整 worker host 或敏感错误。

provider request ID 不进入指标标签，避免高基数；通过结构化日志和受保护查询追踪。

### 日志

- Go 生产使用 JSON slog，支持 `LOG_LEVEL`；开发可读格式只作为显式选项。
- 关键事件字段固定：component、event、runtime_mode、worker_id、job_id、attempt_ordinal、provider_request_id、error_code、duration_ms。
- Node supervisor、migration runner 和 readyz 使用同一事件命名风格。
- Node/Go/supervisor 使用统一敏感值分类和 redactor；error/cause、URL、header 与 provider body 均走同一清洗边界。
- 负向 fixture 覆盖带密码/查询参数的 DSN、Bearer/API Key、上游响应正文和媒体签名 URL；任何秘密字段必须先脱敏或完全不记录。

### 暴露边界

- embedded `WORKER_HTTP_ADDR` 默认 loopback。
- dedicated 可以监听容器网络地址，但 Compose 不发布该端口。
- metrics 如需跨网络访问，使用 bearer token；healthz/readyz 只返回最小信息。

## 7. 环境变量契约

新增语言无关 manifest，例如 `contracts/runtime/v1/environment.json`，只覆盖共享或发布关键变量，字段包含：

- 名称、owner、类型、默认值。
- production 是否必填、约束和 secret 属性。
- build-time/runtime 属性。
- Node/Go/supervisor/app/worker/compose 的消费范围和唯一允许读取路径。

manifest 覆盖的变量必须迁入 Node env loader、Go `LoadConfig` 或 supervisor runtime-env loader。静态审计测试扫描 `process.env`、`os.Getenv` 等读取点，owner 外直接读取即失败；另行比较 Compose、Dockerfile、`.env.example`、README。运行时不要求 Go 二进制动态读取 manifest，避免把配置解析变成远程/文件依赖。

生产共同约束：

- `AUTH_SECRET >= 32` 且非公开占位值。
- `DATABASE_URL` 由部署环境完整注入并已正确编码。
- contract v1 默认 false。
- Worker 重试、用户并发、shutdown、视频与 supervisor 等变量全部有一致默认值或明确 owner。

## 8. CI 与 E2E 设计

抽取现有 `verify-worker-contracts.mjs` 的进程树终止、deadline 和固定目标检查为共享 runner，避免复制两套 Windows/Linux 超时逻辑。

- `verify:ci`：tsc、lint、Vitest、Worker contracts、Go vet/test/build、Next build。每个单测进程各自使用约 57 秒截止；总流程和 build 使用独立更长截止，不把已有 55/57 秒 runner 再嵌套进 60 秒父截止。
- `verify:migrations`：运行 disposable migration runner。
- `verify:e2e`：随机 Compose project，使用 tmpfs PostgreSQL，实际构建根/Worker 镜像，验证两种拓扑、探针、互斥、SIGTERM、DB 故障恢复和无资源残留。
- `.github/workflows/verify.yml` 按 job 调用上述仓库 wrapper；workflow 不复制具体测试目标或命令参数。

每个 runner 输出阶段名、命令、耗时、退出码和资源 owner；失败保留足够日志，但最终清理只针对自建资源。

## 9. 兼容、灰度与回滚

- migration/schema 只做 additive，不删除 Worker contract v1 数据结构。
- metrics 只新增版本和字段，不删除现有核心字段。
- 部署新启动逻辑前先对目标历史库运行只读 preflight；如需 baseline/repair，另行审批后先备份再执行。
- 提供独立 rollback preflight CLI，调用 `CheckRollbackSafety` 并返回稳定退出码/计数摘要。代码回滚前必须运行；不安全时关闭新 claim 并保留兼容 finalizer。
- readiness 严格化后，平台 liveness 与 readiness 必须分别配置；回滚探针配置不能绕过 schema/topology 故障。

## 10. 明确不做

- 不自动部署生产，不修改非 disposable 数据库。
- 不启用公开 Go gateway、用户域迁移或生产 contract v1。
- 不在本任务重写媒体存储、提示词同步或监控平台。
- 不以引入 Redis/Kafka/Kubernetes 解决当前发布问题。
