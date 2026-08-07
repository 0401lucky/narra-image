# Research: worker-contracts 最终启动前复审

- Query: 复审 `worker-contracts` 最新规划，判断原 4 个 BLOCKER 是否关闭，并核对事务/状态、一次性退款、文件所有权、验证命令与生产安全。
- Scope: internal
- Date: 2026-08-07

## Findings

## Verdict

**CONDITIONAL GO。两项技术 BLOCKER 已关闭。**

最新修订已经固定测试文件、三组 60 秒命令、disposable PostgreSQL runner 与退出码，并补齐 contract v1 混合版本回滚下限和 `WC-E06`。`refund:<jobId>` 已明确为逻辑键，数据库幂等闸门明确为单 job 行锁/CAS；`WC-A03` 也已拆分为“未扣费”与“已扣费后退款”。技术规划现在可以进入启动批准环节，但在运行 `task.py start` 前仍须由主会话确认两份 JSONL 有真实条目，并在展示最新摘要后的后续用户消息中取得明确批准。

## 最新修订复审补充

1. **原 BLOCKER 1 已关闭。** 验收矩阵已固定 TS、Go、数据库测试文件与场景映射（`verification/worker-contracts-matrix.md:183-192`），并固定 `verify:worker-contracts:ts/go/db` 三组命令、DB runner 退出码和 60 秒外层限制（`:194-207`）。执行计划同步冻结目标文件和 runner 顺序，不再把命名与命令留到实现时临时决定（`implement.md:21-31,53-74,126-148`）。

2. **原 BLOCKER 2 已关闭。** 设计已定义 contract v1 handoff guard 兼容下限：存在 `SUBMITTING/SUBMITTED/UNKNOWN` 时禁止旧 Worker/旧 stale finalizer 启动，只有停入队、停 claim 并排空后才允许完整回滚（`design.md:195-209`）。`WC-E06` 固定验证旧清理 SQL 不退款和计数归零后才放行（`verification/worker-contracts-matrix.md:177-181`）；执行计划也要求启动检查阻塞旧二进制（`implement.md:88-96,158-165`）。

3. **退款与 A03 修订通过。** `refund:<jobId>` 已改为日志/调用层逻辑键，真实 at-most-once 保证来自 `GenerationJob.id` 单行锁和 `refundAppliedAt IS NULL AND creditsSpent > 0` CAS，不新增无意义复合索引（`design.md:128-142`）。A03a 明确入队前拒绝时无 job、无扣费、无退款；A03b 明确预扣后配置漂移由 Worker 拒绝并退款一次（`verification/worker-contracts-matrix.md:29-37`）。

4. **结论边界。** 本次为规划可执行性通过，不代表 runner、脚本或测试已经存在并通过；这些是 Phase 2 的实现与验收内容。当前仅剩 Trellis 流程条件，不再有文档级技术阻塞。

## 原 4 个 BLOCKER 关闭情况（最终）

1. **可执行验收矩阵：已关闭。** 已新增覆盖渠道、重试、取消、退款、停止、公平性和 schema 的固定场景，通用 DB/积分快照断言也完整（`verification/worker-contracts-matrix.md:6-14,16-181`）；目标测试文件、场景映射、三组命令、DB runner 退出码和 60 秒限制均已固定（`:183-209`；`implement.md:21-31,126-148`）。

2. **Attempt/handoff 事务闭环：已关闭。** claim、attempt 插入和计数在同一事务完成（`design.md:87-97`）；`SUBMITTING → SUBMITTED/UNKNOWN` 的网络非原子边界、成功写回租约/ordinal 条件、可重试与未知结果规则均已明确（`:99-126`）。

3. **Schema/migration 所有权：已关闭。** 本任务独占 generation/attempt additive schema、单个新 migration、Worker/Node 契约实现；发布任务独占启动、Compose、CI、readyz 暴露和生产迁移编排（`prd.md:67-74`；`implement.md:10-19`；`design.md:185-193`）。

4. **Trellis 启动前置：技术部分已关闭，流程条件待确认。** `prd.md`、`design.md`、`implement.md` 和验收矩阵已具备，且执行计划明确要求最新摘要后的后续用户批准（`implement.md:3-8`）。研究角色按隔离规则不能读取 `implement.jsonl`/`check.jsonl`，故两份清单是否已由真实条目替换种子行仍须主会话验证；这不再是规划内容阻塞，但在验证前不能启动。

## 已关闭的历史 BLOCKER（保留审计记录）

> 以下内容记录上一版规划的阻塞依据；均已由上方“最新修订复审补充”关闭，不再作为当前 NO-GO 条件。

### 1. 验收命令尚不能从干净环境直接执行

- 矩阵仍保留 Vitest 占位符，且 disposable PostgreSQL 集成 runner 没有固定命令、入口文件和稳定退出码（`verification/worker-contracts-matrix.md:172-185`）。
- `implement.md` 把“场景映射到具体测试文件/fixture”列为启动后的阶段 0 工作（`:21-26`），与原启动前修订闸门冲突。
- 最终门禁直接运行全量 `pnpm exec vitest run`，同时只说明超时后再拆分，没有预先给出符合 60 秒限制的稳定分组（`implement.md:106-125`）。

**必须修订：** 在矩阵和执行计划中写出预期测试文件路径、场景 ID 映射、一次性 PostgreSQL/fake provider runner 的唯一命令与退出码；补 `prisma generate/validate/migrate deploy` 的受控顺序；把 Vitest 拆成可在 60 秒外层限制内运行的确定性命令。即使测试文件尚未创建，也应先固定目标路径与最终命令契约。

### 2. 新 handoff 状态与旧 Worker 回滚的行为兼容未闭环

当前兼容矩阵只证明“旧 Worker 能读取新 schema”（`design.md:79-83`），回滚策略又允许直接回滚 Worker 二进制（`implement.md:135-139`）。但旧 Worker 不认识 `SUBMITTING/SUBMITTED/UNKNOWN`：若新 Worker 崩溃后留下仍为 `PROCESSING` 的已提交任务，旧租约清理逻辑可能把它当普通过期任务退款，从而绕过新 handoff guard。

`WC-B09` 已正确要求所有**新代码**清理入口拒绝 `HANDOFF_UNKNOWN` 并保持积分不变（`verification/worker-contracts-matrix.md:91-95`），但尚未覆盖旧二进制/旧 Node finalizer 或混合版本窗口。

**必须修订：** 新增“旧 Worker/旧 finalizer + 新 handoff 数据”的兼容场景，并选择一种明确策略：

- 回滚前停止 claim、排空或冻结所有 `PROCESSING + SUBMITTING/SUBMITTED/UNKNOWN` 任务，再允许旧 Worker 启动；或
- 保留能识别 handoff guard 的兼容 finalizer/sweeper，不允许完整回滚到旧清理语义。

在此闸门明确前，“直接回滚二进制”不可作为安全回滚方案。

## 必须澄清但不扩大范围

### 退款一次性方案

方案本身**足够且边界正确**：锁定单个 job，仅在 `creditsSpent > 0`、`refundAppliedAt IS NULL` 且 handoff 允许退款时，同一事务清零消费、写审计时间并增加用户积分；重复 finalizer 返回退款 0（`design.md:128-137`）。这能为当前“一个生成 job 对应一次预扣”模型提供 at-most-once 退款，不需要在本 P0 引入全站 `CreditLedger`（`:139-141`）。

但 `refund:<jobId>` 当前只是逻辑操作标识，并未作为独立字段或数据库唯一键持久化；`GenerationJob.id + refundAppliedAt` 也不是额外的唯一约束，真正的幂等保证来自 job 主键行锁与 `refundAppliedAt IS NULL` 条件。

**必须修订措辞：** 明确 `refund:<jobId>` 是日志/调用层逻辑键，数据库执行闸门是单 job 行锁/CAS。不要实现无意义的 `(id, refundAppliedAt)` 唯一索引；若未来需要独立账务审计，再另立任务。

### 状态与计费断言

`HANDOFF_UNKNOWN` 采用 `status=FAILED + errorCode=HANDOFF_UNKNOWN + handoffState=UNKNOWN`，保留积分且禁止自动退款（`design.md:109-110`），在保留四态枚举的约束下是自洽的兼容编码；查询必须始终按 `errorCode/handoffState` 区分普通失败与待协调失败。

矩阵 `WC-A03` 仍把“入口拒绝”和“Worker 防御性拒绝”合并为一个结果，并统一写“允许退款”（`verification/worker-contracts-matrix.md:29-32`）。入口在扣费前拒绝时应是**无 job/无扣费/无退款**；只有任务已创建并预扣后才断言一次退款。

**必须修订：** 拆成 A03a（入队前拒绝，不产生扣费）与 A03b（入队后配置漂移或 Worker 防御性拒绝，终态并退款一次），避免实现阶段误把“未扣费”写成一次退款。

## WARNING

1. **共享 Go 文件仍需启动前锁定。** 当前本任务拥有整个 `worker/internal/worker` 的队列、配置、停止和 probe，而 `release-hardening` 后续会接入 HTTP readyz/metrics（`implement.md:12-16`；`design.md:185-193`）。若两个 P0 并行，应在各自计划中点名 `config.go`、`server.go` 等共享文件的唯一修改者；否则先只启动本任务。

2. **数据库命令只有文字防线。** 执行计划禁止生产 `DATABASE_URL` 并限制 `migrate deploy` 到 disposable DB（`implement.md:48-63`），生产安全方向正确；最终 runner 仍应加入可失败的环境预检，而不是依赖操作者目测连接串。

3. **人工协调明确延期是合理的，但用户可见语义必须进入最终摘要。** `HANDOFF_UNKNOWN` 会显示失败却暂不退款，这是产品/计费风险决策；规划已写清，但在最新启动摘要中必须显式展示并取得用户批准，不能作为纯实现细节带过。

## OK

1. **事务状态总体自洽。** claim 原子性、网络边界保守状态、结果写回条件、有限重试和租约丢失决策均能回答“是否可能已经提交、是否可重试、是否可退款”（`design.md:85-149`）。

2. **退款没有越界到通用账务重构。** `refundAppliedAt` 只服务生成 job 的一次性退款，完整充值/消费流水明确延期（`design.md:128-141,207-212`）。

3. **生产安全和任务边界清楚。** 只允许 additive migration 与 disposable DB/fake provider；禁止生产 migration、真实渠道故障注入、手工退款、旧 Node 删除和批量回填（`prd.md:97-106`；`implement.md:56-63,127-140`）。

## 启动前条件

1. [x] 固定矩阵场景到测试文件/fixture/runner 的映射，替换命令占位符。
2. [x] 增加混合版本与旧 Worker 回滚场景，定义回滚前 drain/freeze 闸门。
3. [x] 修正 `refund:<jobId>` 的逻辑键/CAS 措辞，并拆分 A03a/A03b。
4. [ ] 由主会话验证 `implement.jsonl`、`check.jsonl` 均有真实有效条目。
5. [ ] 向用户展示包含 `HANDOFF_UNKNOWN` 暂不退款政策的最新规划摘要，并在后续消息获得明确启动批准。

## Files found

- `.trellis/tasks/08-07-worker-contracts/prd.md`：最终需求、验收、边界和所有权。
- `.trellis/tasks/08-07-worker-contracts/design.md`：状态机、attempt ledger、事务、退款、公平性和回滚设计。
- `.trellis/tasks/08-07-worker-contracts/implement.md`：实施阶段、文件边界、验证命令和危险操作闸门。
- `.trellis/tasks/08-07-worker-contracts/verification/worker-contracts-matrix.md`：固定故障与兼容场景矩阵。
- `.trellis/tasks/08-07-worker-contracts/research/planning-review.md`：原始 4 个 BLOCKER 的来源。
- `.trellis/tasks/08-07-worker-contracts/research/contract-evidence.md`：现有代码状态、退款、租约和 schema 证据。

## Code patterns

- **Claim 与 attempt 同事务：** `design.md:87-97`。
- **未知 handoff 保守终态：** `design.md:99-126`。
- **单 job 行锁/CAS 退款：** `design.md:128-141`。
- **所有清理入口拒绝 UNKNOWN：** `verification/worker-contracts-matrix.md:91-95`。
- **Additive migration 与子任务所有权：** `implement.md:10-19,48-63`。

## External references

- 未使用外部资料；本复审仅判断仓库内规划能否安全进入实施。

## Related specs

- `.trellis/workflow.md`：复杂任务必须完成规划、上下文清单、最终复审和后续用户批准后才可启动。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：状态、计费和错误必须在 Node、Go、数据库与查询边界往返一致。
- `.trellis/spec/guides/code-reuse-thinking-guide.md`：共享 fixtures 和退款条件必须有单一 owner，避免两套语义漂移。

## Caveats / Not Found

- 研究角色按隔离规则未读取 `implement.jsonl` 或 `check.jsonl`；清单状态必须由主会话确认。
- 未执行测试、Prisma、PostgreSQL、Go、Docker 或真实上游命令；本结论是启动前规划审查，不代表实现已验证。
- 未修改任何规划文档、JSONL、业务代码或数据库；只新增本研究报告。
