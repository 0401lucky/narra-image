# Research: worker-contracts 规划审查

- Query: 审查首个 P0 子任务的验收矩阵可重复性、attempt/handoff 与退款/重试闭环、schema/migration 所有权、遗漏的 fixtures/文件及危险操作边界。
- Scope: internal
- Date: 2026-08-07

## Verdict

**NO-GO（暂不运行 `task.py start`）**。方向与父任务的渐进深化目标一致，但当前子任务只有
`prd.md`，没有复杂任务必需的 `design.md`/`implement.md`，`implement.jsonl` 与
`check.jsonl` 仍是种子行；更重要的是验收条件还不能被一次性测试数据库和固定输入重复证明。
完成下列修订后再复审，可转为条件 GO。

## Findings

### BLOCKER

1. **没有可执行的验收矩阵。** `prd.md:22-28` 只有结果性句子，没有测试输入、预期状态、
   错误码、计费账本断言、时间控制或命令/fixture。至少要建立 `verification/worker-contracts-matrix.md`
   或等价表，覆盖：
   - 固定渠道：合法模型、模型不属于渠道、停用/删除渠道、未指定渠道的默认选择；
   - 错误分类：提交前网络/429/5xx、参数/鉴权/策略/SSRF/媒体错误、提交结果不确定；
   - 生命周期：PENDING 取消、PROCESSING（未 handoff/已 handoff）取消、客户端超时、租约过期、
     SIGTERM/drain、重复消费者；
   - 断言：最终状态、`attemptCount`/`nextAttemptAt`、provider request ID、积分扣减/退款账本恰好一次。
   每格必须指定 Node 测试、Go 测试或 disposable PostgreSQL 集成测试及稳定退出码。

2. **attempt/handoff 仍缺少事务级闭环。** 子 PRD 只写“建立记录”（`prd.md:9-12`），父设计虽列
   `attemptCount`、`upstreamSubmittedAt`、`providerRequestId` 和不确定标记（父 `design.md:85-89`），
   但没有规定 claim、attempt 写入、上游提交、结果回写和 lease recovery 的原子边界。必须明确：
   - claim 与 attempt ledger 如何在同一事务中落盘，崩溃点如何恢复；
   - 何时可证明“尚未提交”并回到 PENDING，何时进入 `HANDOFF_UNKNOWN`（若不能加枚举，定义稳定错误码）；
   - 退款使用何种唯一键/条件更新，重复 worker、重复 finalizer、租约扫描都不会二次退款；
   - provider 不支持幂等时，未知结果不得自动重试。否则“重试不会重复提交/计费”的父级闸门（父 `implement.md:49`）不可证明。

3. **schema 与 migration 所有权未落地。** 子 PRD 要求 additive schema/schema gate（`prd.md:10-14`），
   但生产 migration 和发布由 `release-hardening` 提供（`prd.md:17-20`）。未说明谁拥有
   `prisma/schema.prisma`、具体 migration SQL、Go 手写 SQL、索引/约束、schema 版本常量及兼容矩阵。
   建议明确：`worker-contracts` 独占字段/状态/索引/错误码契约和 migration 内容，产出版本化 fixtures；
   `release-hardening` 只拥有迁移执行器、启动顺序、备份/演练和 readyz 接入。新增列必须 nullable/default
   并验证旧 Worker 读新 schema、新 Worker 在旧 schema 上明确拒绝；禁止本子任务执行生产 `db push`、
   `migrate resolve`、删列/批量回填。

4. **Trellis 启动前置条件未满足。** 子任务目录目前缺少 `design.md` 和 `implement.md`，且两个 JSONL
   只有 `_example`（`task.json.status=planning`）。这是复杂 P0 的流程性阻塞，不是可用“后续补文档”
   解决的细节；必须先补齐架构边界、执行顺序、回滚点及真实 spec/research context，再请求启动批准。

### WARNING

1. **公平性/用户限流的 MVP 没有可量化定义。** `prd.md:14` 同时要求公平队列和用户级限流，但未给出
   配额维度、窗口、超限行为、优先级是否存在或性能阈值。建议先锁定最小规则（例如每用户并发上限 +
   跨用户 round-robin），用两用户/突发负载 fixture 断言最大等待时间和不饿死；没有负载证据的优先级系统延期。

2. **取消、超时与优雅停止的时间语义不足。** 需要可注入时钟和短 lease/timeout fixture，明确“停止后多久
   可重新领取/何时退款”，以及已 handoff 任务为何继续查询而非退款。单纯检查“不永久悬挂”（`prd.md:27`）
   不能发现中间状态卡死或误退款。

3. **跨层 fixtures/文件清单尚未列出。** 规划应明确新增/归属至少包括：
   `contracts/generation/v1/` 状态与错误样例、TS/Go fixture loader、一次性 PostgreSQL schema/seed、
   可注入的上游 fake（含“已接受但响应丢失”）、时间/租约测试工具、Node 生成的 AES-GCM 密钥 fixture、
   旧任务兼容样本，以及 `worker.go`/`config.go`/`server.go`/Prisma schema 和 migration 的单一 owner。
   目前验收没有要求这些产物可追溯。

4. **危险操作的防线需写进执行计划。** 本子任务可能触及 schema、退款和真实上游调用。应在
   `implement.md` 写明：默认只使用 disposable DB/fake provider；生产连接、真实渠道/S3、批量回填、
   删除/不可逆 DDL、手工退款均需显式用户确认；任何 migration 先 dry-run/备份检查，敏感值不得进入日志。

### OK

1. **范围基本符合渐进深化。** 子任务聚焦 Worker 与跨运行时契约，明确不迁移登录、用户域和公开 Go 网关
   （`prd.md:30-33`），与父设计保留 Next 外壳的边界一致。

2. **先行顺序合理。** 作为 P0，先冻结任务/错误/媒体字段，再让发布和网关依赖其版本，能降低跨层漂移；
   依赖关系已至少在 `prd.md:17-20` 表达出方向。

3. **已识别核心高风险行为。** 固定渠道静默回退、模型归属、无效 `WORKER_MAX_ATTEMPTS`、取消/超时
   计费边界均有父研究证据，且子 PRD 已把它们列入要求；这是形成回归矩阵的良好起点。

## Suggested Revision Gate

在重新请求启动前，子任务至少应交付以下规划产物：

1. `design.md`：状态机、attempt ledger/退款账本、事务边界、schema 字段/索引/版本和 owner 表。
2. `implement.md`：按“契约 fixtures → Go/TS 单测 → disposable PostgreSQL 集成 → 故障注入 → 全量门禁”
   排序，列出每个文件所有权、回滚点、危险操作确认点。
3. `verification/worker-contracts-matrix.md`：每个场景的固定输入、预期 DB 快照/错误码/计费断言、
   执行命令和通过标准。
4. `implement.jsonl` 与 `check.jsonl`：至少引用父研究文件、跨层思考 spec 和本子任务验收矩阵，删除种子行。

## Files Found

- `.trellis/tasks/08-07-worker-contracts/prd.md`：P0 子任务需求、依赖、验收与范围。
- `.trellis/tasks/08-07-worker-contracts/task.json`：当前仍为 `planning` 状态。
- `.trellis/tasks/08-07-worker-contracts/implement.jsonl`、`check.jsonl`：尚为种子上下文清单。
- `.trellis/tasks/08-07-go-migration-audit/design.md`：父级状态机、attempt/handoff 设计和 schema 发布边界。
- `.trellis/tasks/08-07-go-migration-audit/implement.md`：父级阶段顺序、验证与回滚闸门。
- `.trellis/tasks/08-07-go-migration-audit/research/feature-parity.md`：现有渠道、重试、取消和测试盲区证据。
- `.trellis/tasks/08-07-go-migration-audit/research/architecture-inventory.md`：Worker 队列、schema gate 与运行拓扑证据。

## Related Specs

- `.trellis/spec/guides/cross-layer-thinking-guide.md`：跨 API、数据库、Worker 的契约与往返验证。
- `.trellis/spec/guides/code-reuse-thinking-guide.md`：共享 fixture/单一 owner 与重复契约防漂移。
- `.trellis/workflow.md`：复杂子任务必须具备规划文档和真实上下文清单后才能启动。

## Caveats / Not Found

- 本评审未修改 `prd.md`、`design.md`、`implement.md`、JSONL、schema 或业务代码；只新增本报告。
- 未连接真实 PostgreSQL、上游渠道或生产环境；报告判断的是规划可验证性，不是线上行为已修复。
