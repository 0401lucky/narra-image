# Research: Worker 跨层契约与任务生命周期证据

- Query: 为 `08-07-worker-contracts` 规划 attempt/handoff ledger、重试/取消/退款、渠道模型校验、队列公平性、schema gate、优雅停止和 Node/Go 契约 fixtures。
- Scope: internal（Next.js、Prisma schema/migration、Go Worker、现有测试）
- Date: 2026-08-07

## Findings

### 现有状态模型与数据流

- `GenerationJob` 目前只有 `PENDING → PROCESSING → SUCCEEDED/FAILED` 四个枚举状态；迁移新增 `workerManaged`、`workerId`、`lockedAt`、`startedAt`、`completedAt`、`attemptCount`、渠道快照字段和复合索引（`prisma/schema.prisma:19-33、345-401`；`prisma/migrations/20260530090000_go_worker_generation_jobs/migration.sql:1-20`）。没有独立的 attempt、handoff、取消请求或退款账本表。
- 网页 API 在单事务中创建已预扣积分的 `PENDING` 任务并立即设置 `workerManaged=true`（`src/app/api/generate/route.ts:151-189、226-246`）。外部 API 则先以 `workerManaged=false` 创建任务，参考图上传成功后再更新为 `true`（`src/lib/generation/external-api.ts:169-204、233-259`）。这两个入口的 handoff 原子性不同，且没有记录“提交上游前/后”的阶段。
- Worker 的 `claimJob()` 使用 `FOR UPDATE SKIP LOCKED`、按 `createdAt ASC` 领取 `PENDING`，同时递增 `attemptCount`、写入 worker/租约信息（`worker/internal/worker/worker.go:165-214`）。这能避免重复领取，但 `attemptCount` 只代表领取次数，不代表上游提交次数或结果确定性。

### Attempt / handoff 与重试证据

- `processJob()` 在渠道解析、图片/视频调用或结果写回失败时统一调用 `failJobAndRefund()`，没有错误分类或重试分支（`worker/internal/worker/worker.go:250-315`）。
- Worker 明确只领取从未提交上游的 `PENDING`；过期 `PROCESSING` 任务由清理流程直接失败并退款，注释说明“不再依赖 attemptCount 自动重试”（`worker/internal/worker/worker.go:175-191、681-722`）。但配置仍暴露 `MaxAttempts`（`worker/internal/worker/config.go:24-25、67-73`），形成配置与行为漂移。
- 当前可观测字段不足以回答“请求是否已发给渠道”：`lockedAt`/`attemptCount` 只能表示 Worker 领取，`errorMessage` 只能保存最终错误（`prisma/schema.prisma:351-382`）。第三方超时后可能已受理，现行过期清理仍会退款，存在重复生成和积分争议窗口。

### 取消 / 超时 / 退款证据

- 用户 DELETE 只允许取消 `PENDING`；`PROCESSING` 返回 409“任务已开始处理，无法取消”（`src/app/api/me/generations/[id]/route.ts:47-79`）。因此 API 客户端 Abort 或等待超时无法取消已领取任务。
- `runExternalGeneration()` 在交给 Worker 后把 `handedToWorker` 设为 `true`；异常路径只有未 handoff 才调用退款（`src/lib/generation/external-api.ts:166、257、265-271`）。等待超时只返回查询提示，不改变任务状态（`external-api.ts:11-13、116-159`）。
- `failGenerationJobAndRefund()` 用 `creditsSpent` 条件更新并清零，再增加用户积分，具备基本的幂等 CAS（`src/lib/generation/job-refund.ts:27-78`）；但它默认允许 `FAILED`，没有独立退款事件/唯一键，跨 Node/Go 的退款原因和时序仍靠调用方约定。Go 版本也以状态和 `creditsSpent` 条件更新后退款（`worker/internal/worker/worker.go:629-677、729-777`）。

### 渠道与模型契约证据

- 入队端选择渠道时只验证渠道存在/启用，未验证请求模型属于该渠道（`src/app/api/generate/route.ts:38-51`）。外部 API 的 `resolveApiChannel()` 会按 `defaultModel`/`models` 匹配（`src/lib/generation/external-api.ts:68-86`），但网页路径与 Worker 路径的规则不一致。
- Go 固定渠道查询只取 `baseUrl/apiKey/defaultModel`，`channelByID()` 不带模型归属条件（`worker/internal/worker/worker.go:391-398`），并在缺失时继续按模型、首个活动渠道、环境变量回退（`:355-389`）。这会让 pinned channel 失效时静默换渠道。
- `providerModels` 仅保存自填渠道模型列表（网页入队 `route.ts:173-179`），内置渠道没有模型快照，无法在 Worker 执行时检测配置漂移。

### 队列公平性、schema gate、停止证据

- 全局 FIFO + `SKIP LOCKED` 对并发去重有效，但没有按用户配额、租户轮转或老化策略；单一用户可占满 `WORKER_CONCURRENCY`（`worker/internal/worker/worker.go:130-191`）。指标只统计总 pending/processing 和最老任务年龄，没有用户级等待/限流维度（`worker/internal/worker/server.go:123-178`）。
- `waitForSchema()` 只检查 `to_regclass('"GenerationJob"') IS NOT NULL`，表存在即认为就绪，没有检查关键列、`PROCESSING` 枚举或迁移版本（`worker/internal/worker/worker.go:101-123`）。启动主程序也只 `Ping` 数据库后进入 Worker（`worker/cmd/worker/main.go:24-49`）。
- SIGINT/SIGTERM 通过 `signal.NotifyContext` 取消根 context，`Run()` 等待 HTTP 与 worker goroutine 结束（`worker/cmd/worker/main.go:26-30`；`worker/internal/worker/worker.go:60-98`）。活动任务的请求 context 会被取消，但任务仍留在 `PROCESSING`，要等下一轮过期扫描才失败退款；没有停止时的显式租约释放/状态转移。

## 建议契约（供设计/实现阶段采用）

### 1. Attempt / handoff ledger

建议新增 `GenerationAttempt`（或等价事件表），至少包含：`id`、`jobId`、`sequence`、`phase`（`CLAIMED/PREPARED/SUBMITTED/UNKNOWN/RECONCILED/SUCCEEDED/FAILED/CANCEL_REQUESTED`）、`providerChannelId`、`model`、`idempotencyKey`、`startedAt`、`submittedAt`、`finishedAt`、HTTP 状态/错误分类、`upstreamRequestId`、`refundDecision`。在以下边界写入不可变事件：

1. 入队预扣成功（`RESERVED`）。
2. Worker claim/准备请求（`CLAIMED/PREPARED`）。
3. 发出 HTTP 前后分别记录；只有收到明确未发送/连接建立前错误才可判定 `NOT_SUBMITTED`。
4. 渠道返回成功、永久失败或超时未知（`UNKNOWN`）时记录最终事件。

`attemptCount` 可保留为汇总字段，但应由 ledger sequence 驱动；同一 `idempotencyKey` + phase 设唯一约束，避免重复提交和重复退款。

### 2. 重试分类与退款

- `VALIDATION/AUTH/4XX（除 408/409/429）`：不重试，立即失败；通常退款。
- `429/408/网络连接前失败/5xx`：仅在 `NOT_SUBMITTED` 且未观察到上游受理时重试，次数由 `WORKER_MAX_ATTEMPTS` 控制并写入 ledger。
- 提交后超时、连接断开、响应解析失败：标记 `UNKNOWN`，不得盲目重试或自动退款；通过上游查询/人工重试 reconciliation 决定。
- 结果写回数据库失败：使用同一 job/attempt 的幂等写回，不能再次调用渠道；若无法确认写回，保留 `PROCESSING`/`UNKNOWN` 并报警。

退款必须采用单独的 `CreditLedger`/退款事件唯一键（如 `refund:<jobId>`），并与状态 CAS 同一事务完成；`creditsSpent=0` 可作为兼容汇总，但不应是唯一审计依据。

### 3. 取消与 handoff 语义

- `PENDING` 且未 claim：允许取消并退款（保留现有 DELETE 行为）。
- `PROCESSING`、尚未提交：写 `cancelRequestedAt`，Worker 在发送前 CAS 为 `CANCELLED` 并退款。
- 已提交或结果未知：只接受取消请求/停止轮询，不自动退款；任务最终由上游状态或 reconciliation 收敛。
- 客户端 Abort/等待超时只影响 HTTP 响应，不应隐式改变已 handoff 任务的扣费；返回稳定的 `jobId` 查询语义。

### 4. 渠道模型校验

- 入队时对内置和自填渠道统一执行 `model == defaultModel || model ∈ models`；把归一化后的模型列表快照写入 `providerModels`。
- Worker 读取 pinned channel 时同时检查 `isActive` 与模型归属；找不到或不匹配必须返回可追踪的 `CHANNEL_DISABLED`/`MODEL_NOT_ALLOWED`，禁止 fallback 到其他 channel/env。
- 仅在任务没有 pinned channel（明确的环境配置模式）时才允许 `channelByModel`/默认渠道回退；错误码和计费渠道写入 attempt ledger。

### 5. 队列公平性与优雅停止

- 第一阶段可保留 FIFO，但增加每用户/租户并发上限与 `oldest_pending_age` 告警；后续改为“每用户最老一条 + 全局最老优先”的选择，避免单用户占满槽位。
- schema gate 应检查 `GenerationJob` 必需列、`PROCESSING` enum、ledger/取消/退款表和迁移版本；缺失时启动失败并让 `/healthz` 非 ready，而不是仅检查表名。
- 停止时先停止新 claim，再等待在途请求的短宽限期；对仍持有租约的任务写 `STOPPING/UNKNOWN` 或释放为可安全重试的状态，避免永久 `PROCESSING`。过期清理应只处理明确未知且按策略退款的任务。

### 6. 共享契约 fixtures

建议建立版本化 fixtures（例如 `worker/testdata/contracts/v1/*.json`，Node 测试读取同一目录），覆盖：

- 状态转移：`PENDING→PROCESSING→SUCCEEDED/FAILED/CANCELLED/UNKNOWN` 及非法转移。
- 计费：预扣、一次性退款、重复退款、未知结果不退款。
- 渠道：默认模型、别名模型、停用渠道、pinned channel 不匹配、无 pinned channel 回退。
- 重试：408/429/5xx、鉴权/参数 4xx、连接前失败、提交后超时。
- 媒体：图片 `count/n=1`、输出格式/压缩/质量、Responses SSE；视频 JSON URL、参考图形式、封面可空。

Node 侧断言入队 payload/错误码，Go 侧断言请求构造、状态机和退款事件；fixture 中固定 `jobId`、`attemptNo`、`idempotencyKey`，避免各语言各自生成不一致样例。

## 验证命令与回滚点

建议实现后按以下顺序验证（单项失败即停止发布）：

1. `pnpm prisma generate`、`pnpm prisma migrate deploy`（验证 schema/enum/索引）。
2. `pnpm test -- src/tests/unit/job-refund.test.ts src/tests/unit/generation-cancel-route.test.ts src/tests/unit/external-generation-service.test.ts src/tests/unit/external-v1-routes.test.ts`。
3. `go -C worker test ./...`（含契约 fixtures、claim/租约/视频测试）。
4. `pnpm lint`、`pnpm build`；再用代表性数据库运行 Worker readiness、停止和重复退款场景。

回滚点：

- 先关闭 `ENABLE_EMBEDDED_WORKER`/暂停新 `workerManaged` 入队，再回滚 Worker 二进制；不要回滚已应用的 schema migration。
- 新 ledger/状态列应向后兼容（可空/默认值），确认旧 Node 只读路径能忽略新增字段。
- 若重试/取消策略出现未知结果，优先保持任务 `UNKNOWN` 并停止自动退款/重试，人工 reconciliation 后再恢复队列。

## Files found

- `prisma/schema.prisma`：GenerationJob 状态、租约、计费和渠道字段。
- `prisma/migrations/20260530090000_go_worker_generation_jobs/migration.sql`：Go Worker 迁移字段与索引。
- `src/app/api/generate/route.ts`：网页入队和预扣事务。
- `src/lib/generation/external-api.ts`：外部 API handoff、等待、超时边界。
- `src/app/api/me/generations/[id]/route.ts`：用户取消限制与退款调用。
- `src/lib/generation/job-refund.ts`：Node 侧状态 CAS 与退款。
- `worker/internal/worker/worker.go`：claim、租约心跳、完成/失败退款、过期清理、schema gate。
- `worker/internal/worker/config.go`：`WORKER_MAX_ATTEMPTS` 等配置。
- `worker/cmd/worker/main.go`：启动、数据库 Ping、SIGTERM context。
- `worker/internal/worker/server.go`：健康/指标与队列可观测字段。
- `src/tests/unit/job-refund.test.ts`、`generation-cancel-route.test.ts`、`external-generation-service.test.ts`：现有 Node 退款/取消/handoff mock 覆盖。
- `worker/internal/worker/video_test.go`、`generation_test.go`：现有 Go provider/视频单元测试。

## Code patterns

- 领取锁：`worker/internal/worker/worker.go:175-214` 使用 `FOR UPDATE SKIP LOCKED` 与 `workerId/lockedAt`。
- 租约心跳：`worker/internal/worker/worker.go:320-350` 按 `workerId` 更新 `lockedAt`，丢租约则取消 context。
- 失败退款 CAS：`worker/internal/worker/worker.go:629-677、729-777`；Node 对应 `src/lib/generation/job-refund.ts:42-78`。
- schema 就绪：`worker/internal/worker/worker.go:101-123` 只检查表存在。
- 优雅停止：`worker/cmd/worker/main.go:26-49` + `worker/internal/worker/server.go:37-68`。

## External references

- `.trellis/tasks/08-07-go-migration-audit/research/feature-parity.md`：父任务迁移对齐审计（内部研究）。
- `docs/go-backend-migration-plan.md`：迁移边界与发布意图（内部文档）。
- Prisma migration `20260530090000_go_worker_generation_jobs`：当前数据库契约的唯一版本化依据。
- 本研究未联网核对第三方渠道重试/取消 API；上游是否支持查询、幂等和取消需在实现前以供应商文档/沙盒验证。

## Related specs

- `.trellis/spec/guides/cross-layer-thinking-guide.md`：跨层状态、计费和数据流契约。
- `.trellis/spec/guides/code-reuse-thinking-guide.md`：Node/Go 共享 fixture 与重复实现治理。
- `.trellis/spec/frontend/quality-guidelines.md`：取消/轮询接口的稳定错误与状态呈现约束。

## Caveats / Not Found

- 当前代码没有独立 attempt/handoff/credit ledger，也没有 `CANCELLED` 或 `UNKNOWN` 枚举；建议字段/表名是设计提案，不是现存 API。
- `WORKER_MAX_ATTEMPTS` 已读入配置但未参与决策；不能据此推断第三方请求一定可安全重试。
- 现有测试大多 mock 数据库或 HTTP，尚未证明多 Worker、公平调度、schema 缺列启动和 SIGTERM 中断时的真实行为。
