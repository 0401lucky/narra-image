# 生产迁移与可观测部署执行计划

## 1. 执行原则

- 先固化测试与只读 preflight，再改普通生产启动行为。
- 普通路径、baseline/repair 和 disposable 测试路径必须物理分离，不能靠同一脚本的隐式猜测分支。
- 先增加 liveness/readiness 与拓扑锁，再让 supervisor/Compose 消费；最后收紧探针与启动依赖。
- 不运行生产 migration、不部署 Zeabur、不删除 volume；任何非 disposable 数据库操作需另行确认。

## 2. 阶段 0：基线与共享验证框架

- [x] 保存当前 `start-prod`、Compose、环境变量、health/metrics 和测试耗时基线到任务 verification 目录。
- [x] 从 `verify-worker-contracts.mjs` 抽取跨平台命令 runner：固定目标、进程树终止、阶段 deadline、耗时和退出码。
- [x] 为现有 Worker contract wrapper 增加回归，确保抽取后行为不变。
- [x] 创建 runtime environment manifest、一致性测试骨架和 owner 外直接环境读取的静态审计。
- [x] 定义统一 Node/Go/supervisor redactor 与敏感 fixture，先锁定日志负向测试。

验证：

```powershell
pnpm verify:worker-contracts:ts
pnpm verify:worker-contracts:go
pnpm exec tsc --noEmit
```

回滚点：仅重构验证工具和新增契约文件，不改变启动行为。

## 3. 阶段 1：Migration 路径分离

- [x] 将数据库等待与普通 `migrate deploy` 提取为可测试模块；`start-prod` 删除 `db push`、自动 baseline/resolve 和自动 repair。
- [x] 增加 baseline inspect/apply；候选仅允许连续 migration 前缀，报告绑定脱敏数据库身份、schema hash、migration checksums 与 digest；apply 重新检查并拒绝过期/错库报告。
- [x] 增加 failed migration inspect/显式 repair allowlist；核对失败行/checksum/前置 schema，repair 后要求 deploy 成功、失败记录清零且 schema diff 为零。
- [x] 构建 disposable migration runner，复用 Worker 契约的镜像预检、随机资源、owner label、URL 归一化和清理规则；PostgreSQL 数据目录使用 tmpfs，兜底删除带 `--volumes`，结束时断言无归属资源残留。
- [x] 若迁移历史缺少空库 foundation，只新增一个位于现有最早 migration 之前的 synthetic foundation migration。内容由最早历史 schema，加上后续已发布 migrations 在执行前假定存在、但从未被任何 migration 创建的 db-push 遗留对象组成；每项必须记录 Git 来源、首个消费者和无冲突证明。禁止修改任何已发布 migration SQL/checksum，最终以空库全链 deploy + schema diff=0 验证。已有库若已记录后续 migrations，只能通过显式 allowlist repair 记录该新增 foundation migration，不能由普通启动自动 resolve。
- [x] 覆盖空库、legacy baseline、故意失败 migration、特殊字符 DATABASE_URL。
- [x] 为 embedded 和 dedicated 提供同一 migration entry；dedicated Compose 使用一次性 migrate service。

建议文件所有权：单一实施代理独占 `scripts/**` migration/runner、`prisma/migrations/**`、`package.json`、`Dockerfile`、两个 Compose 文件和迁移测试，避免入口冲突。

验证：

```powershell
pnpm verify:migrations
docker compose config --quiet
docker compose -f docker-compose.e2e.yml config --quiet
```

回滚点：保留 additive migrations；若新普通启动阻塞历史库，只回滚代码入口，不自动恢复旧的静默 repair。通过显式 preflight 决定后续动作。

## 4. 阶段 2：Worker 拓扑、Health 与 Readiness

- [x] 新增 Worker runtime state（booting/ready/draining）和 `WORKER_RUNTIME_MODE` 校验。
- [x] 使用独立 pgx connection 持有 embedded exclusive / dedicated shared advisory lock；冲突返回稳定 `TOPOLOGY_CONFLICT` 并失败退出。
- [x] 监控 lock connection；丢失时立即撤销 ready/claim，按有界 drain 结束并非零退出，不在同一进程静默重获锁。
- [x] 用结构化并发协调 HTTP、锁监控、claim 和 processing；关键 goroutine 错误必须传播。
- [x] 调整 Worker 启动顺序：HTTP server 先启动，schema/lock/consumer 就绪后再 ready；HTTP 在 drain 期间继续响应，监听失败触发整体退出。
- [x] `/healthz` 改为纯 liveness；新增 `/readyz`，复用 `CheckSchemaContract` 并覆盖 DB、schema、lock、consumer、draining。
- [x] SIGTERM 时先撤销 readiness，再停止 claim，保留既有 handoff/grace 语义；grace 后增加 hard-stop deadline，禁止无限等待。
- [x] 增加 rollback preflight CLI，调用 `CheckRollbackSafety` 并提供稳定退出码。
- [x] 补齐 healthz/readyz、锁竞争、DB 恢复与停止测试。

建议文件所有权：Worker 实施代理独占 `worker/internal/worker/**`、`worker/cmd/worker/**` 及对应 Go 测试；不得修改 Compose、package scripts 或 Node 路由。

验证：

```powershell
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./...
go -C worker build ./...
pnpm verify:worker-contracts:db
```

回滚点：schema 不变；拓扑锁实现可随代码回滚，但回滚前仍须检查活动 contract v1/handoff，不能启动旧 finalizer。

## 5. 阶段 3：Next Readiness、环境契约与观测

- [x] 增加 Next healthz/readyz 路由和共享 readiness service；对外只返回稳定 code。
- [x] 定义 `WORKER_INTERNAL_URL`、`WORKER_READINESS_REQUIRED` 和 timeout；embedded supervisor 等待 Worker `/readyz`，dedicated app 通过服务地址要求至少一个 ready 副本，并配置 app healthcheck。
- [x] 移除 dedicated Worker 固定 `container_name`，确保 Compose 可扩容；服务发现/负载均衡负责多副本地址。
- [x] 指标响应增加 `schema_version`、重试/UNKNOWN/错误分类；敏感错误不返回客户端。
- [x] Go/Node/supervisor 使用结构化日志字段记录 job、attempt、provider request ID、error code 与耗时；统一 redactor 处理 error cause、DSN/header/body/签名 URL，并增加负向测试。
- [x] 完成 environment manifest，统一 AUTH_SECRET、DATABASE_URL、contract/重试/并发/停止/视频/supervisor 配置；把覆盖变量迁入唯一 loader，静态扫描拒绝 owner 外直接读取。
- [x] Compose 改为完整注入已编码 DATABASE_URL；embedded loopback，dedicated Worker 端口仅容器网络可见。
- [x] 更新 `.env.example`、README 与发布/回滚文档。

建议文件所有权：Node/契约实施代理独占 `src/app/api/*health*`、`src/lib/readiness*`、runtime manifest、Node 测试和文档；Compose、package、Docker 仍由阶段 1 owner 统一修改。

验证：

```powershell
pnpm exec tsc --noEmit
pnpm exec vitest run --reporter=dot --testTimeout=15000
pnpm lint
```

回滚点：healthz 保持最小兼容；readyz 与指标只做 additive payload。平台不得在回滚时把 readiness 重新指向纯 liveness。

## 6. 阶段 4：CI 与 Embedded/Dedicated E2E

- [x] 增加 `verify:ci`；每个单元测试进程独立使用约 57 秒截止，总流程和 build 使用独立更长截止，DB/migration runner 不嵌套进 60 秒父截止。
- [x] 稳定 `generator-studio-feedback` 等已知超时：优先消除不必要等待；如确需调整，全仓采用明确测试超时并保留慢测诊断。
- [x] 将 E2E Compose 改为随机 project/端口、无固定 container_name、PostgreSQL tmpfs、无任何持久卷和无 restart 策略；清理带 `--volumes` 且验证 owner。
- [x] `verify:e2e` 覆盖 embedded、dedicated、两个 dedicated、拓扑冲突、schema 缺失、DB 断连恢复、SIGTERM drain 和子进程失败传播。
- [x] 新增 `.github/workflows/verify.yml`，按 job 调用仓库内 wrapper，不复制另一套命令清单；E2E job 实际构建根镜像和独立 Worker 镜像。

验证：

```powershell
pnpm verify:ci
pnpm verify:migrations
pnpm verify:e2e
```

回滚点：CI/E2E 不接触持久资源；失败清理只按随机前缀与 owner label 处理 runner 自建资源。

## 7. 阶段 5：全量验收与交付记录

- [x] 写入 `verification/`：命令、耗时、退出码、场景矩阵、资源归属和未覆盖外部证据。
- [x] 复查普通启动不存在 `db push`、隐式 resolve、自动 repair；全仓搜索所有 migration/health/metrics/env 消费者。
- [x] 运行 rollback preflight 的 safe/unsafe fixture；验证退出码、活动任务计数和日志脱敏。
- [x] 运行全量 Trellis check，逐条验证 CRITICAL/WARNING 是否符合真实调用链。
- [x] 更新 `.trellis/spec/` 中稳定的发布、migration、readiness 和环境契约。
- [x] 提交前 `git diff --check`，确认没有覆盖无关用户改动。

最终命令：

```powershell
pnpm verify:ci
pnpm verify:migrations
pnpm verify:e2e
pnpm verify:worker-contracts:db
docker compose config --quiet
docker compose -f docker-compose.e2e.yml config --quiet
git diff --check
```

## 8. 文件所有权与并行策略

- Worker owner：`worker/internal/worker/**`、`worker/cmd/worker/**`、Go tests。
- Migration/Release owner：`scripts/**`、`prisma/migrations/**`、`package.json`、`Dockerfile`、`docker-compose*.yml`、`.github/workflows/**`、migration/E2E runner。
- Node/Contract owner：Next health/readiness、runtime manifest、Node tests、`.env.example`、README/运维文档；涉及 Compose/package 的需求提交给 Release owner 集中落盘。
- 同一文件只允许一个 owner；共享接口先由设计定义，跨 owner 合并后再跑集成测试。

## 9. 风险与危险操作闸门

- 禁止对非 runner 自建数据库执行 baseline/repair/migration；如后续需要真实库验证，必须先展示目标摘要、影响、备份和回滚方案并请求确认。
- 禁止使用固定容器名或宽泛 `docker compose down -v` 清理用户资源；runner 只处理自己创建且标签匹配的资源。
- 不自动 pull 镜像，不安装全局包，不修改系统环境变量。
- 不在本任务启用生产 contract v1、删除 schema/数据或切换公开流量。

## 10. 启动前检查清单

- [x] `prd.md`、`design.md`、`implement.md` 已收敛且无阻塞问题。
- [x] `implement.jsonl`、`check.jsonl` 均包含真实 spec/research 条目并通过 `task.py validate`。
- [x] 用户已明确批准本版最终规划摘要。
- [x] 只启动 `08-07-release-hardening` 子任务，不启动父任务。
