# Readiness、可观测性与环境变量审计

## 结论

Worker 已有 schema probe、队列指标和 attempt/provider request ID 数据，但这些能力尚未形成发布级接口：Next 无 healthz/readyz，Worker `/healthz` 仅 DB Ping，HTTP server 在 schema ready 后才启动，`/metrics` 未鉴权且错误与默认值在 Node/Go/Compose/.env 之间漂移。

## 已确认事实

- Next 的 `src/app/api/**` 中没有 healthz/readyz 路由；Compose app 也没有 healthcheck。
- Worker 只注册 `/healthz` 与 `/metrics`（`worker/internal/worker/server.go:37-45`）。`/healthz` 执行 DB Ping，但不检查 `CheckSchemaContract`、拓扑锁、drain 或消费能力（`server.go:72-98`）。
- `CheckSchemaContract` 已验证关键表、列、枚举、默认值、唯一约束、trigger 与 check constraint，可直接作为 readyz 的 schema 层（`worker/internal/worker/schema.go:36-158`）。
- `/metrics` 返回未版本化 JSON，包含 worker_id、队列、成功率与耗时；端点无鉴权，错误响应会直接返回数据库错误文本（`server.go:100-181`）。
- `GenerationAttempt.providerRequestId` 已落库，但现有日志与管理查询没有形成稳定的 provider request ID 追踪入口。
- `.env.example` 缺少 `WORKER_CONTRACTS_V1_ENABLED`、`WORKER_MAX_ACTIVE_PER_USER`、`WORKER_RETRY_BASE_DELAY_MS`、`WORKER_SHUTDOWN_GRACE_SECONDS`、视频轮询/模型/积分等 Go 已消费变量（`.env.example:43-51`；`worker/internal/worker/config.go:68-81`）。
- Go 对 `AUTH_SECRET` 仅要求 10 位；Node 在 production 要求至少 32 位并拒绝公开占位值（`worker/internal/worker/config.go:42-48`；`src/lib/env.ts:5-56`）。
- Compose 用未编码的用户名/密码拼接 `DATABASE_URL`，特殊字符可能在 Node/Prisma/pgx 之间产生不同解析结果（`docker-compose.yml:31-32,65-66`）。

## 推荐状态契约

- Worker HTTP server 在进程启动早期监听。
- `/healthz`：只表达进程和 HTTP 循环存活，响应不包含依赖错误细节。
- `/readyz`：依次检查数据库连接、schema contract、拓扑锁已获取、未进入 draining、消费循环已启用；任一失败返回 503 和稳定错误码。
- Next `/api/healthz`：只表达 Next 进程存活。
- Next `/api/readyz`：检查数据库和配置；生成能力启用时再检查配置的 Worker `/readyz`。对外响应只给稳定状态，详细原因写结构化日志。

## 推荐观测契约

- 保留 JSON 指标以控制范围，但增加 `schema_version`，稳定字段覆盖 pending/processing/oldest age、成功/失败、重试、UNKNOWN handoff、错误分类和耗时。
- provider request ID 只进入结构化日志/受保护管理查询，不作为高基数指标标签。
- Go 使用可配置 level 的 JSON `slog`；固定字段包括 component、event、worker_id、job_id、attempt_ordinal、provider_request_id、error_code、duration_ms。
- embedded 默认绑定 loopback；dedicated 可绑定容器网络但不得发布 Worker 端口。`/metrics` 仅允许内网访问或要求 token，且不返回原始数据库错误。

## 环境变量契约

- 建立语言无关的版本化 manifest，记录变量 owner、类型、默认值、生产约束、是否 secret、build-time/runtime 属性。
- Node、Go、Compose、Dockerfile、`.env.example` 和 README 的测试共同消费该 manifest，防止默认值再次漂移。
- `AUTH_SECRET` 生产规则统一为至少 32 位并拒绝公开占位值。
- Compose 的 app/worker 接收完整、已编码的 `DATABASE_URL`；不要在 YAML 中自行拼接带特殊字符的 URL。

## 验证矩阵

- schema 缺列/枚举/约束：healthz 200、readyz 503、消费未启动。
- DB 断连：readyz 503；恢复后无需重启即可转为 200。
- SIGTERM/draining：healthz 在停止窗口内可存活，readyz 立即 503，且不再 claim。
- metrics 未授权/错误细节：外部访问被拒绝，响应不泄露 DSN、SQL 或数据库错误。
- 配置 fixture：Node 与 Go 对每个共享变量得到相同默认值/拒绝结果，Compose 与 `.env.example` 无缺项。
