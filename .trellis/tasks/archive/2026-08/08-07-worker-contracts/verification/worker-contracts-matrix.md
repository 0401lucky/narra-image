# Worker Contracts 验收矩阵

本文件定义实施后必须可重复执行的固定场景。默认运行环境为 disposable PostgreSQL 和本地 fake provider；
真实生产数据库、真实渠道、S3/R2、Zeabur 和人工退款均不在自动矩阵内。

## 通用断言

每个场景至少记录：

- job 最终 `status/errorCode/handoffState/attemptCount/nextAttemptAt/creditsSpent/refundAppliedAt`。
- 所有 attempt 的 ordinal、状态、idempotency key、provider request ID、错误码和时间顺序。
- 用户积分变化，且重复执行 finalizer 后不再次变化。
- Node 返回/序列化与 Go 数据库结果符合 `contracts/generation/v1/`。
- 测试使用可注入时钟；不得用长时间真实 sleep 证明 lease/重试。

## A. 渠道与模型

### WC-A01 显式渠道 + 合法默认模型

- 输入：活动渠道 C1，默认模型 M1，请求显式 C1/M1。
- 预期：任务固定使用 C1；单次 attempt 成功；fake provider 只收到 C1/M1。
- 层级：Node 入队单测 + Go provider 单测 + PostgreSQL 集成。

### WC-A02 显式渠道 + 合法附加模型

- 输入：C1.models 包含 M2，请求 C1/M2。
- 预期：成功，不修改成默认模型，不访问其他渠道。

### WC-A03a 入队前拒绝不兼容模型

- 输入：C1 只支持 M1，请求 C1/M9。
- 预期：Next 返回 `MODEL_NOT_SUPPORTED_BY_CHANNEL`；不创建 job、不扣积分、不产生“退款”记录、无上游调用。

### WC-A03b 入队后配置漂移/Worker 防御拒绝

- 输入：C1/M1 合法入队并预扣，随后 C1 的模型清单移除 M1，Worker 再校验。
- 预期：终态 `MODEL_NOT_SUPPORTED_BY_CHANNEL`；无上游调用；已预扣积分退款一次。

### WC-A04 显式渠道被停用/删除

- 输入：入队后把 C1 停用或删除，系统仍有活动 C2/env provider。
- 预期：`CHANNEL_INACTIVE`/`CHANNEL_NOT_FOUND`；绝不调用 C2/env；终态与退款符合契约。

### WC-A05 未指定渠道的确定性选择

- 输入：C1/C2 活动，固定 sortOrder/createdAt。
- 预期：选择顺序稳定并把 id/模型清单快照落库；后续渠道配置变化或重试继续使用同一快照，不换渠道。

### WC-A06 模型分流向量

- 输入：共享 fixtures 中 `gpt-5`、命名空间、版本后缀、`gpt-5x` 等全部样例。
- 预期：TS/Go operation 完全一致。

## B. Attempt、错误与重试

### WC-B01 Claim 原子性

- 故障：attempt insert 被数据库拒绝。
- 预期：job 仍为 `PENDING`，`attemptCount` 不增加，无孤立 `PROCESSING`。

### WC-B02 提交前网络失败

- 故障：连接建立前失败，可证明未写出请求。
- 预期：attempt `FAILED_RETRYABLE`；未达上限时 job 回 `PENDING` 并写 `nextAttemptAt`；不退款。

### WC-B03 明确 429

- 故障：fake provider 明确返回未受理的 429。
- 预期：按退避重试；idempotency key 稳定；attempt 不超过上限。

### WC-B04 明确可重试 5xx

- 故障：provider 明确未创建任务的 503。
- 预期：与 B03 相同；若 provider 语义不能证明未创建，则转 B07。

### WC-B05 不可重试错误

- 输入：参数、鉴权、策略、SSRF、媒体格式/大小、密钥解密错误。
- 预期：一次 attempt 终态失败；无重试；允许退款时只退一次。

### WC-B06 重试耗尽

- 输入：`WORKER_MAX_ATTEMPTS=2`，两次安全可重试失败。
- 预期：总 attempt 恰为 2；最终失败并退款一次；不存在第三次领取。

### WC-B07 上游已接受后响应丢失

- 故障：fake provider 记录已接受，然后断开连接，不返回 request ID。
- 预期：attempt/job `HANDOFF_UNKNOWN`；无自动重试、无自动退款；查询返回协调提示。

### WC-B08 已返回 provider request ID，结果写回失败

- 故障：provider 返回 request ID/结果，数据库结果事务失败。
- 预期：保存 request ID 或进入可协调状态；不得把任务当作未提交重试；无自动退款。

### WC-B09 重复 finalizer

- 输入：Worker 失败处理、租约扫描、Node 清理和管理员清理同时尝试终结普通失败任务，并对 `HANDOFF_UNKNOWN` 再执行同样调用。
- 预期：只有一个事务更新并退款；其他调用返回 updated=false/refund=0。
- 额外预期：`HANDOFF_UNKNOWN` 的所有清理入口均被 handoff guard 拒绝，积分保持不变。

## C. 取消与客户端超时

### WC-C01 PENDING 取消

- 预期：原子终态、无 attempt/上游调用、退款一次。

### WC-C02 PROCESSING 未 handoff 取消

- 输入：attempt 仅为 `CLAIMED`。
- 预期：Worker 观察取消并停止；终态退款；无上游调用。

### WC-C03 SUBMITTING/SUBMITTED 取消

- 预期：接口返回 409/继续查询；不立即退款；attempt 继续保留。

### WC-C04 外部 API 等待超时/abort

- 预期：返回稳定 `GENERATION_WAIT_TIMEOUT` 或取消响应并包含 job ID；job 不变；不调用退款；后续查询可见真实终态。

### WC-C05 取消与 claim 竞态

- 输入：Node 取消与 Worker claim 同时发生。
- 预期：只有一个状态转换获胜；不存在已退款但仍提交上游。

## D. 租约、停止与公平性

### WC-D01 租约丢失且未 handoff

- 预期：停止本地处理；若仍有次数可安全重试，否则终态退款。

### WC-D02 租约丢失且 handoff 未知

- 预期：`HANDOFF_UNKNOWN`；无重试/退款。

### WC-D03 SIGTERM drain 内完成

- 预期：停止领取新任务，当前任务在 grace 内完成，租约持续更新，进程正常退出。

### WC-D04 SIGTERM grace 超时

- 预期：取消本地 context；依据 handoff 状态安全重试或 UNKNOWN；无永久 `PROCESSING`。

### WC-D05 两用户公平性

- 输入：A 用户 20 个 PENDING、B 用户 1 个 PENDING、两个 Worker、每用户并发上限 1。
- 预期：A 同时 PROCESSING 不超过 1；B 在至多一个并发批次/轮询周期内被领取。

### WC-D06 双 Worker claim 竞态

- 预期：同一 job/ordinal 只被一个 Worker 获得；同一用户不突破并发上限。

## E. Schema 与兼容性

### WC-E01 正常新 schema

- 预期：schema probe 返回 contract v1 可消费。

### WC-E02 缺关键列/表/枚举/约束

- 预期：probe 返回结构化缺失项并拒绝消费；liveness 可独立存在，但不得报告 ready。

### WC-E03 旧任务 + 新 Worker

- 输入：只含迁移前字段的任务 fixture。
- 预期：`contractVersion=0/handoffState=NULL`，按 legacy 兼容路径解释并可执行，不要求批量回填。

### WC-E04 旧 Worker 查询 + 新 schema

- 输入：旧 writer 在新 schema 上创建任务，不传新字段。
- 预期：旧查询/扫描不受新增 nullable/default 字段影响；新行仍为 contract 0/NULL，不能被误认作 v1。

### WC-E05 跨语言密钥 fixture

- 输入：Node 使用固定 AUTH_SECRET 生成的 AES-GCM 密文。
- 预期：Go 解密为相同明文；fixture 不包含真实密钥。

### WC-E06 混合版本回滚闸门

- 输入：数据库含 contract v1 的 `PENDING(nextAttemptAt=未来)`、`PROCESSING + SUBMITTING/SUBMITTED/UNKNOWN` 任务，尝试启用旧 Worker/旧 stale finalizer 兼容 fixture。
- 预期：启动/回滚检查失败并列出活动任务数量；旧清理 SQL 不得执行退款。
- 后续：停止新入队/claim 并排空所有 `contractVersion>=1` 的 PENDING/PROCESSING 到计数为 0 后，才允许完整回滚；否则只能关闭新执行特性并保留新 handoff finalizer。

### WC-E07 数据库未决退款保护

- 输入：已预扣正积分的 contract v1 `SUBMITTING/SUBMITTED/UNKNOWN` job，执行旧 Node/Go finalizer 等价 SQL，尝试把 `creditsSpent>0` 清零。
- 预期：数据库 trigger 拒绝并回滚整个事务，用户积分不变；同一事务先置 `RESOLVED` 的授权协调 fixture 才可退款。
- 边界：`creditsSpent=0` 的 custom v1 job 可以进入/离开未决 handoff，但不会增加用户积分。

### WC-E08 v1 开关默认关闭

- 输入：未设置开关的 Node/Go 配置和显式测试开启配置。
- 预期：默认新任务仍写 contract 0/NULL 且不进入 v1 attempt；只在 disposable 测试显式开启时写 1/`NOT_STARTED`。

## 命令与证据

固定目标文件与场景映射：

- `src/tests/contracts/generation-contract.test.ts`：A01-A06、E05。
- `src/tests/integration/worker-contracts/worker-contracts.test.ts`：A03b-A05、B01-B09、C01-C05、D05-D06、E02-E04、E06。
- `src/tests/integration/worker-contracts/worker-contracts-db.test.ts`：需要真实 PostgreSQL 的 B01、B09、C05、D05-D06、E01-E08；
  缺 `WORKER_CONTRACTS_REQUIRE_DB=1` 或显式测试 URL 时必须失败，不能 skip。
- `src/tests/integration/worker-contracts/fake-provider.ts`：B02-B08 的确定性上游故障。
- `worker/internal/worker/contract_test.go`：A01-A06、共享状态/错误 fixtures。
- `worker/internal/worker/worker_contracts_integration_test.go`：B01-B09、D01-D06、E01-E06。
- `src/tests/integration/worker-contracts/postgres-runner.ts`：一次性数据库、legacy snapshot、additive migration、安全预检和跨运行时调度。

固定目标命令：

```powershell
pnpm exec tsc --noEmit
pnpm exec vitest run src/tests/contracts/generation-contract.test.ts src/tests/integration/worker-contracts/worker-contracts.test.ts src/tests/unit/external-generation-service.test.ts src/tests/unit/job-refund.test.ts src/tests/unit/generation-cancel-route.test.ts --reporter=dot --testTimeout=15000
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./internal/worker/...
pnpm exec tsx src/tests/integration/worker-contracts/postgres-runner.ts
go -C worker build ./...
```

最终 `package.json` 暴露 `verify:worker-contracts:ts`、`verify:worker-contracts:go`、`verify:worker-contracts:db`，分别等价于上述三组测试命令。
DB runner 退出码固定为：`0=通过`、`2=安全预检/Docker 或 legacy snapshot 缺失`、`3=Prisma/additive migration 失败`、`4=TS 集成失败`、
`5=Go/数据库集成失败`、`6=资源归属/清理异常`。它不得自动 pull 镜像或回退到 `.env`/开发数据库。
每个验证命令外层最长 60 秒；runner 只创建随机命名、无持久化 named volume 的 disposable 资源，拒绝复用生产/开发数据库。

实施验证结果写入本目录的日期化记录，至少包含 commit、命令、耗时、退出码、通过场景 ID、失败原因和外部未验证项。
