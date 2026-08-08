# 固化生产迁移与可观测部署

## Goal

让当前 `Next.js + PostgreSQL + Go Worker` 混合系统具备可重复、可诊断、可回滚的发布路径：正常启动不再静默接管或修复数据库，两种 Worker 拓扑不会误混跑，平台能够区分进程存活与业务就绪，CI/E2E 能在一次性环境中证明迁移、启动、停止和恢复行为。

这项交付为后续媒体持久化和 Go `/v1` 网关提供可信的发布基础，但不自动部署生产，也不改变页面、认证或计费边界。

## Confirmed Facts

- Zeabur 单容器由 `scripts/start-prod.mjs` 依次准备数据库、启动 embedded Worker、等待 `/healthz`、再启动 Next；根镜像同时携带 Node/Prisma 与 Go 二进制（`scripts/start-prod.mjs:516-562`；`Dockerfile:40-60`）。
- 普通启动当前会在空库执行 `db push` 并批量 resolve migrations；历史库和失败 migration 也可能被自动 baseline/repair（`scripts/start-prod.mjs:309-341,393-527`）。
- dedicated Compose 的 app 与 worker 只等待数据库，app 不等待 Worker，且没有运行时机制阻止 embedded/dedicated 混跑（`docker-compose.yml:20-67`）。
- Worker 已有 `CheckSchemaContract`、回滚安全检查、优雅停止和 contract v1 数据，但 HTTP server 只在 schema ready 后启动，`/healthz` 仅 DB Ping（`worker/internal/worker/schema.go`；`worker/internal/worker/worker.go:67-153`；`worker/internal/worker/server.go:72-98`）。
- Next 当前没有 healthz/readyz；Worker `/metrics` 是未版本化、未鉴权 JSON，provider request ID 已落库但没有稳定日志/查询入口。
- 仓库没有 CI workflow；E2E Compose 使用固定资源和持久化 volume，也没有测试执行器。
- Worker 契约任务已提供共享 schema fixtures、57 秒进程树截止和安全 disposable PostgreSQL runner，可复用其安全边界与命令执行机制。

## Requirements

### R1. 发布拓扑与进程生命周期

- Zeabur embedded 继续作为生产主路径；dedicated Compose 作为隔离联调、故障演练和未来独立扩缩容路径。
- embedded 启动顺序必须是：数据库可连接 → `migrate deploy` 成功 → Worker liveness 可达 → Worker ready → Next 启动。
- dedicated 启动顺序必须是：一次性 migration 成功 → Worker ready → app ready；app 不得在无可用 Worker 时把生成能力报告为 ready。
- `ENABLE_EMBEDDED_WORKER` 继续决定 app 是否派生 Worker；Worker 使用明确的 `embedded|dedicated` 运行模式，并通过 PostgreSQL advisory lock 拒绝两种模式混跑。允许多个 dedicated Worker，不允许多个 embedded supervisor。
- app 使用显式 `WORKER_INTERNAL_URL`、readiness timeout 和 required 开关定位 Worker；dedicated 以服务发现/负载均衡后的任一 ready 副本为可用，Compose 不得用固定 Worker 容器名阻止横向扩容。
- advisory lock 连接丢失必须立即撤销 ready、停止 claim，并在有界 drain 后非零退出；同一进程不得在无 fencing token 的情况下静默重获锁并恢复消费。
- SIGTERM 时先令 readyz 失败并停止 claim，再按既有 grace period drain；HTTP server、拓扑锁或消费协调器的内部失败必须传播给 supervisor/容器，并有第二个硬停止上限，不能无限等待。

### R2. 受控 Prisma migration

- 普通生产启动只执行 `prisma migrate deploy` 和只读 schema/readiness 检查，不得自动执行 `db push`、`migrate resolve`、手写 DDL repair 或“全部标记已应用”。
- 空库必须通过完整 migration 历史创建 schema。
- 已有表但缺失迁移历史的数据库只能通过显式 baseline 流程接管：默认 dry-run，只允许从首个 migration 开始的连续前缀；报告绑定脱敏数据库身份、schema hash、本地 migration checksum 和报告 digest，apply 前必须重新检查且完全匹配。
- failed migration 只能通过显式 repair 流程处理；repair 必须按 migration ID allowlist，核对失败记录与 checksum，并在执行后证明 migration 状态正确且 schema diff 为零。普通启动保持失败并给出诊断，不得静默修改 DDL 或迁移历史。
- 所有自动 migration 测试只使用 runner 自建的随机 localhost PostgreSQL，拒绝 `.env`、开发库和生产库回退，也不得自动 pull 镜像。

### R3. Health、Readiness 与故障语义

- Worker HTTP server 必须在启动早期提供 `/healthz`；liveness 只表示进程/HTTP 循环存活，不因数据库或 schema 暂时不可用而伪装成进程崩溃。
- Worker `/readyz` 必须检查数据库连接、`CheckSchemaContract`、拓扑锁、消费循环和 draining 状态；失败返回稳定错误码与 503。
- Next 提供独立 healthz/readyz；readyz 检查数据库和运行配置，并在生成能力启用时检查 Worker readyz。
- schema 缺失、数据库断连、Worker 崩溃、migration 失败或停止窗口均不得返回 ready。
- 外部响应不得泄露 DSN、SQL、密钥或原始数据库错误；详细原因进入结构化日志。

### R4. CI、Migration 与 E2E 验证入口

- 提供唯一、稳定退出码的 `pnpm verify:ci`，覆盖 TypeScript、lint、稳定化单测、Worker 契约、Go vet/test/build 和 Next 生产构建；GitHub Actions 必须只调用仓库内 wrapper，不复制命令清单。
- 每个单元测试进程必须独立在约 57 秒外层上限内通过或给出可诊断失败；`verify:ci` 总流程、migration、镜像构建和 E2E 使用各自更长且独立的 timeout，不能把 55/57 秒 runner 嵌套进另一个 60 秒总截止。
- 提供 `pnpm verify:migrations`，自动覆盖空库、历史 baseline 升级和故意失败 migration。
- 提供 `pnpm verify:e2e`，覆盖 embedded/dedicated 启动、readyz、拓扑互斥、SIGTERM、数据库断连和恢复。
- E2E 资源必须随机命名、带 owner label，PostgreSQL 数据目录使用 tmpfs；不得创建 named/anonymous 持久卷。兜底清理必须带 `--volumes`，且只能作用于归属校验通过的 runner 自建资源。
- `verify:e2e` 必须实际构建根镜像和独立 Worker 镜像，并验证两个 Compose 文件，而不只做配置语法检查。

### R5. 指标、日志与安全暴露

- 保留 JSON 指标以控制范围，但增加稳定 `schema_version`；至少包含 PENDING/PROCESSING、最老等待时间、成功/失败、重试、UNKNOWN handoff、错误分类和耗时。
- provider request ID、job ID、attempt ordinal、error code 和 duration 进入结构化日志或受保护管理查询，不作为高基数指标标签。
- embedded Worker HTTP 默认 loopback；dedicated Worker 端口只在容器网络可见，不发布公网。`/metrics` 只能通过内网或令牌访问。
- Node/Go/supervisor 共用明确的敏感值分类与 redactor；负向测试必须覆盖带密码/查询参数的 DSN、Authorization/API Key、上游响应正文和媒体签名 URL。
- 日志不得输出 API Key、AUTH_SECRET、完整 DATABASE_URL、未清洗的上游响应正文或媒体签名 URL。

### R6. 环境变量单一契约

- 建立语言无关、版本化的共享/发布关键环境 manifest，定义变量 owner、允许读取路径、类型、默认值、生产约束、secret 属性和 build-time/runtime 属性。
- manifest 覆盖的变量必须迁入各自唯一 loader；静态审计测试枚举 `process.env`/`os.Getenv` 等直接消费者，发现 owner 之外的新读取即失败。Node、Go、supervisor、Compose、Dockerfile、`.env.example` 和 README 必须由测试验证与 manifest 一致。
- Node/Go 的生产 `AUTH_SECRET` 规则统一为至少 32 位并拒绝公开占位值。
- Compose 为 app/worker 接收完整且已编码的 `DATABASE_URL`，不得在 YAML 中拼接无法安全处理特殊字符的连接串。
- 补齐 contract v1、用户并发、重试、停止、视频与启动等待相关变量的文档和验证。

### R7. 灰度、回滚与外部证据

- contract v1 生产开关保持默认关闭；只有 migration、schema probe、拓扑互斥和回滚安全检查均通过后才允许另行启用。
- 提供返回稳定退出码的 rollback preflight 命令，调用 `CheckRollbackSafety`；回滚代码时保留 additive schema，存在活动 contract v1 或未决 handoff 时不得启动旧 Worker/finalizer，只能停止新 claim 并排空或使用兼容终结器。
- 仓库内验证与 Zeabur/真实历史库/真实监控平台证据分开记录；本任务不自动执行任何生产发布。
- 任何非 disposable 数据库 baseline/repair、volume 删除或生产配置变更仍需用户另行明确确认。

## In Scope

- `start-prod`、Prisma 发布/接管/修复入口、Docker/Compose 拓扑与进程编排。
- app/Worker healthz、readyz、指标保护、结构化日志与环境变量契约。
- CI、本地 wrapper、disposable migration runner 和 embedded/dedicated E2E。
- 发布、故障演练、外部证据模板和回滚文档。

## Out of Scope

- 不自动部署 Zeabur，不连接或修改生产数据库，不删除生产数据/volume。
- 不在本任务启用生产 contract v1，不修改生成状态/退款/handoff 语义。
- 不实现媒体长期存储、提示词同步或公开 Go `/v1` 网关。
- 不迁移 OAuth、Turnstile、用户、API Key、积分、页面渲染和管理后台。
- 镜像 digest、非 root、只读根文件系统及完整供应链加固如无法在不扩大范围下完成，记录为后续项。

## Dependencies and Ownership

- 消费已完成的 `worker-contracts` schema、错误码、`CheckSchemaContract`、`CheckRollbackSafety` 与验证 wrapper；不得重新定义其业务语义。
- 本任务独占启动脚本、migration/CI/E2E runner、Docker/Compose、app/Worker HTTP 就绪接入、指标暴露和环境变量发布契约。
- `media-sync-boundary` 后续消费本任务的生产环境变量和发布闸门；`go-api-gateway` 后续消费 readyz、回滚和内部拓扑，不在本任务提前切流。

## Acceptance Criteria

- [ ] embedded 与 dedicated 均通过自动启动、ready、停止和恢复矩阵；两种模式不能混跑，多个 dedicated Worker 仍可合法运行，锁连接丢失后无未 fencing 的继续消费。
- [ ] 普通启动只执行 `migrate deploy`；空库完整迁移、连续前缀 baseline、防重放 digest 和故意失败 migration 均有自动化证据，且没有静默 resolve/repair。
- [ ] app/Worker healthz 与 readyz 语义分离；schema 缺失、DB 断连、Worker 崩溃和 draining 均不会假绿。
- [ ] `verify:ci`、`verify:migrations`、`verify:e2e` 有稳定退出码和独立超时；每个单元测试进程在 60 秒上限内给出明确结果，GitHub Actions 调用同一 wrapper。
- [ ] 指标带版本、端点不暴露公网或受保护；结构化日志可通过 job/attempt/provider request ID 追踪且不泄露秘密。
- [ ] 环境变量 manifest 与 Node、Go、supervisor、Compose、Dockerfile、`.env.example`、README 一致；owner 外直接读取会令测试失败，特殊字符数据库 URL 回归通过。
- [ ] rollback preflight、备份/停止/恢复步骤及外部验证模板完整；未执行生产部署或非 disposable 数据操作。
- [ ] disposable PostgreSQL 使用 tmpfs，验证后无归属卷/容器残留；`pnpm verify:ci`、`pnpm verify:migrations`、`pnpm verify:e2e`、`docker compose config --quiet`、`git diff --check` 全部通过并有验证记录。

## Risks and Deferred Items

- 取消普通启动的自动 baseline/repair 会让历史库在下一次发布时显式失败；发布文档必须先提供只读 preflight 与人工接管流程。
- 更严格的 readyz 可能暴露过去被 liveness 掩盖的真实故障；平台探针必须分别配置，不能继续只看端口存活。
- Docker/Next build 可能超过 60 秒，因此与单元测试采用不同超时和日志，不把所有命令塞进一个短截止时间。
- 真实 Zeabur、多副本平台探针和监控采集需用户授权后补证据，但不阻塞仓库内实现和 disposable 验收。
