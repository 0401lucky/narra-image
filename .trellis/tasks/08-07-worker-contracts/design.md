# Go Worker 与跨层契约设计

## 1. 设计目标

本子任务先解决生成链路最危险的行为漂移：显式渠道被静默替换、模型分流不一致、配置声称可重试但实际不重试、
客户端超时与上游 handoff 混为一谈，以及失败清理可能无法解释“是否已经向上游提交”。

目标不是承诺第三方上游的恰好一次执行，而是建立可证明的边界：

1. 退款最多一次。
2. 只有能够证明尚未被上游接受时才自动重试。
3. 结果不确定时停止自动重提和自动退款，并保留可查询、可协调的证据。
4. Node、Go 和 PostgreSQL 对同一任务字段、状态、错误和计费含义一致。

## 2. 边界与非目标

```text
Next.js 入口
  ├─ 会话/API Key、限流、Turnstile、SSRF/输入校验
  ├─ 规范化模型与渠道、预扣积分、创建 GenerationJob
  └─ 取消/查询与对外错误映射
              │
              ▼
PostgreSQL
  ├─ GenerationJob：当前任务快照、租约、计费与最终状态
  └─ GenerationAttempt：每次 claim/handoff 的不可丢审计记录
              ▲
              │
Go Worker
  ├─ 再校验渠道/模型与 schema
  ├─ 领取、公平性、attempt、重试、租约与停止
  ├─ 调用上游并记录 provider request ID
  └─ 结果写回或一次性退款
```

本任务不实现公开 Go `/v1`、不迁移用户域、不统一媒体存储、不修改生产启动/Compose，也不删除旧 Node 生成器。

## 3. 契约单一来源

新增版本化目录 `contracts/generation/v1/`，由本子任务独占。目录包含：

- `errors.json`：稳定错误码、分类、是否允许重试、用户可见性。
- `models.json`：模型识别/分流输入向量和期望结果。
- `states.json`：任务、handoff、attempt、计费状态及允许转换。
- `scenarios/*.json`：渠道、取消、超时、退款、图片/视频字段的跨层样例。
- `schema.json` 或等价 manifest：契约版本和必填/可空字段。

运行时代码仍保留 Go/TypeScript 的强类型封装，但两端的 conformance test 必须读取同一 fixtures；任何状态、错误码或模型规则变更先改契约向量，
再让两端测试共同失败/通过，禁止各写一套只在本语言自洽的测试。

## 4. 数据模型

采用 additive schema，保留现有 `GenerationStatus` 四态，以降低滚动升级风险。

### 4.1 GenerationJob 新增字段

- `contractVersion Int @default(0)`（或 nullable legacy 等价）：任务按哪个契约版本创建；旧写入者不传字段时必须保持 legacy。
- `errorCode String?`：稳定机器错误码；`errorMessage` 继续保存截断后的用户/运维说明。
- `nextAttemptAt DateTime?`：只有已确认安全的重试才设置。
- `handoffState?`：`NOT_STARTED | SUBMITTING | SUBMITTED | UNKNOWN | RESOLVED`；legacy 行允许 NULL，新 v1 写入者显式写 `NOT_STARTED`。
- `cancelRequestedAt DateTime?`：处理中取消请求的可追踪时间。
- `refundAppliedAt DateTime?`：退款一次性闸门和审计时间。

`attemptCount` 保留，定义为成功 claim 并创建 attempt ledger 的次数；不再只是“被领取过多少次”的模糊计数。

### 4.2 GenerationAttempt 新表

建议字段：

- `id`、`jobId`、`ordinal`，并对 `(jobId, ordinal)` 建唯一约束。
- `workerId`、`operation`、`providerChannelId`、规范化 `model`、`idempotencyKey`。
- `status`：`CLAIMED | SUBMITTING | SUBMITTED | SUCCEEDED | FAILED_RETRYABLE | FAILED_FINAL | UNKNOWN`。
- `providerRequestId`、`upstreamSubmittedAt`、`nextRetryAt`。
- `errorCode`、截断后的 `errorMessage`。
- `createdAt`、`updatedAt`、`completedAt`。

关系和索引至少支持：按 job 顺序查询 attempts；查找待重试任务；查找 `UNKNOWN`；按 provider request ID 协调。

### 4.3 兼容矩阵

- 旧 Worker + 新 schema：必须可继续读取旧字段，不受新增 nullable/default 字段影响。
- 新 Worker + 旧 schema：schema probe 明确拒绝消费并输出缺失项，不把数据库可连接误报为就绪。
- 旧任务 + 新 Worker：缺失的新业务值按契约 v1 默认值解释；不能要求生产批量回填后才可启动。
- 旧 Node/旧 Worker 新写入 + 新 schema：因数据库默认 `contractVersion=0`、`handoffState=NULL`，继续被识别为 legacy；不得自动升级为 v1。

生产 rollout 中 `WORKER_CONTRACTS_V1_ENABLED` 默认关闭。只有发布任务证明旧 Worker 已停止并完成混合版本预检后，新 Node 才显式写
`contractVersion=1/handoffState=NOT_STARTED`；本子任务只在 disposable 环境启用。

## 5. 状态机与事务边界

### 5.1 Claim

同一数据库事务中完成：

1. 选择满足 `PENDING`、`nextAttemptAt <= now/null`、用户并发上限和最大 attempt 的任务。
2. 对候选用户取得事务级互斥，防止多个 Worker 同时突破用户并发上限。
3. 更新任务为 `PROCESSING`，写租约、worker、`attemptCount + 1`、`handoffState=NOT_STARTED`。
4. 插入同 ordinal 的 `GenerationAttempt(status=CLAIMED)`。
5. 提交后才开始解析渠道和准备网络请求。

如果 attempt 行插入失败，claim 整体回滚；不存在“任务已 PROCESSING 但没有 attempt 证据”的中间态。

### 5.2 Handoff

网络调用无法与数据库原子提交，因此采用保守状态：

- 参数构造、渠道校验、源图读取等在发出请求前失败：仍可证明未提交。
- 即将执行可能写出请求字节的 HTTP 调用前，先落库 `SUBMITTING`。
- 得到明确的上游受理响应或 request ID 后，落库 `SUBMITTED`、`upstreamSubmittedAt` 和 `providerRequestId`。
- `SUBMITTING` 期间发生连接复位/超时，且不能证明上游未受理：写 `UNKNOWN`。
- provider 明确返回 429/可重试 5xx 且语义证明未创建任务：允许 `FAILED_RETRYABLE`；不能确定时仍为 `UNKNOWN`。

`UNKNOWN` 的 job 使用 `status=FAILED` + `errorCode=HANDOFF_UNKNOWN` + `handoffState=UNKNOWN` 表达可查询终态，
保留 `creditsSpent` 且不自动退款。管理协调完成后另行把 handoff 标为 `RESOLVED`；本子任务不执行生产人工对账。

### 5.3 成功写回

结果写回事务必须同时验证：job 仍为当前 Worker 的 `PROCESSING` 租约、attempt ordinal 匹配且不为 `UNKNOWN`。
事务内先写媒体元数据，再把 job 置 `SUCCEEDED`、attempt 置 `SUCCEEDED`、清理租约并把 handoff 置 `RESOLVED`。

如果上游成功但数据库写回失败，attempt 不能被改成“安全可重试”；有 provider request ID 时进入可协调状态，无 request ID 时进入 `UNKNOWN`。

### 5.4 重试与最终失败

- 可重试分类：明确未受理的连接建立失败、429、允许重试的 5xx。
- 不可重试分类：输入/模型/渠道、鉴权、策略、SSRF、媒体格式/大小、密钥解密、持久化契约错误。
- 若 `attemptCount < WORKER_MAX_ATTEMPTS` 且失败可证明安全：attempt 置 `FAILED_RETRYABLE`，job 回到 `PENDING`，
  写指数退避后的 `nextAttemptAt`，不退款。
- 重试耗尽或不可重试：job/attempt 终态失败，并调用统一退款事务。
- `SUBMITTED`/`UNKNOWN` 不自动回到 `PENDING`，即使还未达到最大次数。

### 5.5 一次性退款

所有 Node/Go 退款入口调用同一语义：

1. 锁定 job。
2. 仅当 `creditsSpent > 0`、`refundAppliedAt IS NULL`，且当前 handoff 状态允许退款时执行。
3. 同一事务将 job 的 `creditsSpent` 清零、写 `refundAppliedAt`/错误码，并增加用户积分。
4. 重复 finalizer、租约扫描、取消或管理员清理只能得到“未更新/退款 0”。

退款不是 attempt 级动作；它只发生在 job 进入允许退款的最终结论时。

新增数据库更新保护（优先使用 `BEFORE UPDATE` trigger）保护 v1 未决 handoff：仅当旧值 `creditsSpent > 0`、新值将其清零，且
`contractVersion >= 1`、handoff 仍为 `SUBMITTING/SUBMITTED/UNKNOWN` 时拒绝；授权协调必须在同一事务先把 handoff 置 `RESOLVED`。
零积分自填渠道任务必须能够正常进入未决 handoff。另加静态 CHECK 保证 `contractVersion >= 1` 时 `handoffState` 非空。
这样即使旧 finalizer SQL 被误执行，也会由数据库拒绝并整体回滚，不能误退款。

本任务不引入覆盖全站积分业务的通用 `CreditLedger`。生成退款在日志/调用层使用逻辑键 `refund:<jobId>`；数据库中的真实执行闸门是
锁定 `GenerationJob.id` 对应的单行，并以 `refundAppliedAt IS NULL AND creditsSpent > 0` 做 CAS 条件更新。这里不新增无意义的复合唯一索引。
该方案足以关闭当前生成链路的重复退款窗口，同时避免把 P0 Worker 契约扩大成用户账务重构。
如未来需要完整充值/消费审计，再以独立任务引入通用账务流水。

## 6. 取消与等待超时

- `PENDING`：条件更新为失败/取消终态，退款一次。
- `PROCESSING + NOT_STARTED/CLAIMED`：写 `cancelRequestedAt`；Worker 观察后停止进入 handoff，并终态退款。
- `SUBMITTING/SUBMITTED/UNKNOWN`：取消接口返回 409 或“已提交，继续查询”，不立即退款。
- 外部 API 的 HTTP abort/等待超时不改变 job；返回 job ID、`GENERATION_WAIT_TIMEOUT` 和查询提示。
- heartbeat 失去租约时取消本地 context；根据最新 attempt 状态选择安全重试、最终失败或 `HANDOFF_UNKNOWN`，不能统一失败退款。

## 7. 渠道与模型契约

### 显式渠道

Node 入队与 Go 领取都校验：存在、启用、密钥可解密，且模型等于 `defaultModel` 或包含在 `models`。
任何一步失败均使用稳定错误码，禁止继续执行 `channelByModel`、`firstActiveChannel` 或 env fallback。

### 策略渠道

仅当请求没有显式渠道时，才允许按 `sortOrder, createdAt` 选择活动渠道。选择结果和规范化模型清单快照必须在任务开放给 Worker 前写入
`providerChannelId/providerModels`；Worker 遇到缺失 id 的旧任务可以按契约兼容策略解析，但必须记录选择结果，不能每次重试换渠道。

### 模型分流

把 gpt-5/Responses 等识别样例移入共享 fixtures，覆盖 `gpt-5`、供应商命名空间、版本后缀、`gpt-5x` 等相似字符串。
TS 与 Go 必须对所有向量给出同一 operation；旧 Node 生成器仅作为对照，不再成为契约 owner。

## 8. 队列公平性 MVP

不在本任务中引入优先级系统或外部消息队列。最小策略为：

- 新增 `WORKER_MAX_ACTIVE_PER_USER`，限制单用户同时 `PROCESSING` 的任务数。
- claim 时对候选用户使用事务级互斥并检查当前活动数，避免多 Worker 竞态突破上限。
- 在每个用户最老的 eligible job 之间按创建时间选择，防止一个用户的长队列饿死其他用户。
- 测试 fixture：用户 A 连续 20 个任务、用户 B 1 个任务、两个 Worker；B 应在至多一个并发批次/轮询周期内被领取，A 不超过配置上限。

## 9. Schema probe 与停止

本任务提供可复用的 `CheckSchemaContract`/等价函数，检查关键表、列、枚举、默认值和 attempt 唯一约束，并返回结构化缺失项。
Worker 消费循环在 probe 成功前不得启动。`release-hardening` 负责把 probe 接到 `/readyz`、Compose 和发布流程。

优雅停止分两阶段：先停止 claim，再在 `WORKER_SHUTDOWN_GRACE_SECONDS` 内维持当前任务租约并等待完成；超时后取消本地调用，
依据 attempt/handoff 状态做安全重试或未知终态。测试使用可注入时钟/短 lease，不依赖真实等待。

## 10. 文件所有权

- 本任务可修改：Prisma generation/attempt schema 与对应新 migration；Worker 队列、渠道、重试、退款、schema probe、停止实现；
  Next 生成入队/取消/等待/退款边界；共享契约 fixtures 与相关测试。
- `release-hardening` 保留：`scripts/start-prod.mjs`、Dockerfile、Compose、CI/E2E runner、HTTP readyz/metrics 暴露和生产迁移执行器。
- `media-sync-boundary` 保留：对象存储、长期 URL、历史媒体回填和提示词同步。
- `go-api-gateway` 保留：公开 `/v1` Go 协议层、Next 薄代理切换和旧 Node 文件删除。

共享文件若确需跨任务修改，必须先冻结本任务的 schema/contract 版本，再由后续任务消费，禁止并行重定义。

## 11. 发布与回滚形态

建议顺序：

1. 合并共享 fixtures 与失败测试。
2. 合并 additive migration；只在一次性测试数据库执行。
3. 部署能读取旧任务的新 Worker，但保持严格重试/公平性开关关闭。
4. 验证契约与故障注入后再由发布任务启用开关。

代码回滚时保留新增表/列，并设置“handoff guard 兼容下限”：一旦存在 contract v1 的 `SUBMITTING/SUBMITTED/UNKNOWN` 数据，
不得直接启动不认识这些状态的旧 Worker/旧 stale finalizer。优先关闭重试/公平性/新 claim 开关，但保留能识别 handoff guard 的新 finalizer；
只有停止新入队/claim、排空并证明相关活动任务数量为 0 后，才允许完整回滚旧二进制。

由于旧二进制本身无法读取新启动闸门，生产启用/回滚必须由 `release-hardening` 的 supervisor/部署检查强制；本任务提供预检查询、
默认关闭的 v1 开关和数据库未决退款 trigger，不能声称仅靠新 Worker 的 schema probe 就能阻止旧二进制。

禁止在本任务中运行生产 `db push`、`migrate resolve`、删列、批量回填、真实渠道故障注入或手工退款。

## 12. 延后事项

- provider 已受理任务的自动对账/补拉结果，可在 provider request ID 覆盖率稳定后另立任务。
- 基于业务等级的优先级队列、Redis/Kafka 和跨区域队列。
- 独立账务流水系统；本任务只为现有积分模型补一次性退款审计。
- 公开 Go ingress、API Key/限流/用户域下沉。
