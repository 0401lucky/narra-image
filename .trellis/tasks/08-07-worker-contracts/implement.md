# Go Worker 与跨层契约执行计划

## 1. 启动条件与完成标准

本文件只描述实施顺序。当前子任务保持 `planning`；只有最新 `prd.md`、`design.md`、本计划、上下文 JSONL 和验收矩阵完成复审，
且用户在看到最终摘要后的后续消息中明确批准，才运行 `task.py start`。

完成标准：所有 PRD 验收项有自动化证据；仓库内 TypeScript/Go/一次性 PostgreSQL 验证通过；无生产部署、生产数据修改或旧实现删除。

## 2. 文件所有权与并行边界

- 契约/fixtures：`contracts/generation/v1/**`，由本子任务独占。
- 数据库：`prisma/schema.prisma` 中 generation/attempt 相关 additive 字段，以及本任务创建的单个 migration 目录；不改历史 migration。
- Go：`worker/internal/worker` 的队列、渠道、attempt、重试、退款、schema probe、停止及测试；同一文件同一时刻只由一个实现代理修改。
- Node：生成入队、外部等待、取消、退款、模型识别和相应单测；不改认证/API Key/管理后台边界。
- 明确不拥有：启动脚本、Docker/Compose、CI/readyz 暴露、对象存储/提示词同步、公开 Go 网关和旧 Node 删除。

可并行节点：共享 fixtures 设计、Node conformance 测试、Go conformance 测试、fake provider/一次性 DB fixture。
必须串行节点：schema 冻结 → claim/attempt 实现 → retry/refund/cancel → lease/stop/fairness → 全量集成。

## 3. 阶段 0：冻结基线与验收矩阵

- [ ] 按已冻结映射创建以下目标文件，不在实施中另起一套命名：
  - `src/tests/contracts/generation-contract.test.ts`：共享 fixture、模型、错误、序列化与密钥兼容。
  - `src/tests/integration/worker-contracts/worker-contracts.test.ts`：无数据库的 Node 状态、取消、退款和混合版本逻辑场景。
  - `src/tests/integration/worker-contracts/worker-contracts-db.test.ts`：真实 disposable PostgreSQL 场景；缺强制 DB sentinel 时直接失败。
  - `src/tests/integration/worker-contracts/fake-provider.ts`：429/5xx/已接受后断连/request ID 故障注入。
  - `src/tests/integration/worker-contracts/postgres-runner.ts`：一次性 PostgreSQL 安全预检、迁移、seed、测试和退出码。
  - `worker/internal/worker/contract_test.go`、`worker_contracts_integration_test.go`：Go fixtures、claim/attempt/handoff、公平性、schema、停止。
- [ ] 保存当前渠道选择、`WORKER_MAX_ATTEMPTS`、取消、退款和模型识别测试结果。
- [ ] 全仓搜索 `GenerationStatus`、`attemptCount`、`creditsSpent`、`providerChannelId`、`WORKER_MAX_ATTEMPTS`、模型识别和退款调用者。
- [ ] 确认旧 Node 生成器的生产/测试引用，写入 `verification/legacy-node-reference-gate.md`；此阶段不删除文件。

验证：

```powershell
pnpm exec tsc --noEmit
pnpm exec vitest run src/tests/unit/external-generation-service.test.ts src/tests/unit/job-refund.test.ts src/tests/unit/generation-cancel-route.test.ts --reporter=dot --testTimeout=15000
go -C worker test -count=1 -timeout=50s ./...
```

回滚点：只有文档、fixtures 和测试，不改变运行行为。

## 4. 阶段 1：共享契约与失败测试

- [ ] 创建 `contracts/generation/v1/` manifest、错误、状态、模型和场景 fixtures。
- [ ] 建立 TypeScript fixture loader/validator 和 Go embed/loader；加载失败必须给出 fixture 路径和字段。
- [ ] 先增加跨语言 conformance 测试，锁定渠道、模型、错误、状态、计费、attempt 和媒体字段。
- [ ] 增加固定 Node 生成、Go 解密的 AES-GCM fixture，验证跨运行时渠道密钥兼容。
- [ ] 所有新错误码由单一映射 owner 生成用户文案，原始上游错误仅进入截断/脱敏日志。

审查闸门：TS/Go 均消费同一文件；没有复制第二份 JSON/常量清单来“让测试通过”。

## 5. 阶段 2：Additive schema 与兼容性

- [ ] 在 Prisma 中加入 `GenerationAttempt`、handoff/错误/重试/退款审计字段和必要索引/唯一约束。
- [ ] `contractVersion` 默认 0/legacy、`handoffState` 对旧写入可空；所有 v1 Node 入队路径仅在显式开关开启时写 1/`NOT_STARTED`。
- [ ] migration 增加 v1 未决 handoff 的精确 UPDATE 保护：只阻止 `OLD.creditsSpent>0 → NEW.creditsSpent=0` 且 handoff 未决的更新；
  零积分 custom 任务正常流转。另加 `contractVersion>=1 → handoffState 非空` CHECK。
- [ ] 创建新的 forward-only migration；禁止编辑历史 migration，禁止默认值导致长表重写的高风险变更。
- [ ] 更新 Go 手写 SQL 的扫描/写入结构，并新增 schema probe。
- [ ] `postgres-runner.ts` 只创建带随机名称、无持久化 named volume 的 disposable PostgreSQL；拒绝非 localhost/容器网络地址、已存在资源名和生产标记。
- [ ] runner 依次执行安全预检 → legacy schema snapshot（含与 snapshot 对应的 `_prisma_migrations` baseline 记录）→ 确认仅本任务 migration 待执行 →
  `prisma migrate deploy` → seed fixtures → TS/Go 集成断言，任一步失败立即退出；
  不把当前历史 migration 目录从空库部署的能力误报为已验证。
- [ ] disposable PostgreSQL 上验证：legacy schema → 新 additive schema、旧任务读取、新 Worker 对旧 schema 的明确拒绝；完整空库/历史升级矩阵由
  `release-hardening` 负责。
- [ ] 验证旧 Worker 源码/二进制兼容新增 schema；若无法运行旧二进制，至少用旧查询 fixture 和编译/SQL 测试证明新增字段不破坏读取。

允许命令仅针对一次性测试数据库：

```powershell
pnpm exec prisma validate
# 仅 runner 创建的 legacy snapshot 数据库，且已校验只有本任务 migration 待执行
pnpm exec prisma migrate deploy --schema prisma/schema.prisma
pnpm verify:worker-contracts:db
```

`pnpm verify:worker-contracts:db` 最终固定为 `pnpm exec tsx src/tests/integration/worker-contracts/postgres-runner.ts`：
退出码 `0=全部通过`、`2=环境/连接安全预检失败`、`3=Prisma 生成或迁移失败`、`4=TypeScript 集成失败`、`5=Go/数据库集成失败`、`6=清理或资源归属异常`。

危险操作闸门：不得把 `DATABASE_URL` 指向生产；不得运行生产 `db push`、`migrate resolve`、删列、删表或批量回填。

## 6. 阶段 3：渠道、模型与错误分类

- [ ] Next 对显式渠道验证模型归属并持久化最终渠道；无效时在扣费/开放 Worker 前失败。
- [ ] Go 对显式渠道重复验证；移除显式 id 失效后的按模型/首活动/env 静默回退。
- [ ] 只有未显式指定渠道的兼容任务允许确定性选择，选择后固定到 job/attempt。
- [ ] 用共享模型 fixtures 统一 TS/Go operation 识别，覆盖 `gpt-5x` 等边界。
- [ ] 引入稳定错误分类器和 fake provider：明确未受理的网络错误、429、5xx、鉴权、参数、策略、媒体、已接受但响应丢失。

回滚点：通过显式兼容开关恢复旧的“首次失败即终态”路径；不得恢复显式渠道静默换渠。

## 7. 阶段 4：Claim/attempt/handoff 与有限重试

- [ ] 在同一事务完成 claim、`attemptCount + 1` 和 attempt 行插入。
- [ ] 在上游调用前落 `SUBMITTING`，受理后落 `SUBMITTED/providerRequestId`，无法判断时落 `UNKNOWN`。
- [ ] 只有分类器证明尚未受理且未达上限时，写 `nextAttemptAt` 并回 `PENDING`；实现可注入的指数退避/时钟。
- [ ] `WORKER_MAX_ATTEMPTS` 真正限制总 attempt；补充边界值和并发 claim 测试。
- [ ] 成功写回和 attempt/job 终态使用同一租约/ordinal 条件，避免旧 Worker 或重复 finalizer 覆盖新状态。
- [ ] `HANDOFF_UNKNOWN` 终态保留积分与证据，不自动重试/退款；查询序列化能区分普通失败与待协调状态。
- [ ] 增加兼容下限：旧 Worker/旧 finalizer 不能在存在 contract v1 活动 handoff 数据时启动；schema probe/启动检查返回明确阻塞原因。
- [ ] `WORKER_CONTRACTS_V1_ENABLED` 默认 false；测试显式开启，生产启用留给 `release-hardening`。不得在本子任务交付时自动切换生产写入。

故障注入必须使用本地 fake provider，覆盖“服务端已接受后立即断开连接”和“返回 request ID 后数据库写回失败”。

## 8. 阶段 5：退款、取消与等待超时

- [ ] 收敛 Node/Go 退款为同一条件更新语义：`creditsSpent > 0`、`refundAppliedAt IS NULL`、handoff 允许退款。
- [ ] 同步修正 `src/lib/generation/job-refund.ts`、`src/app/api/admin/generations/route.ts`、管理员清理/删除路由和页面触发的 stale cleanup；
  所有入口都必须尊重 UNKNOWN/SUBMITTED guard，并保留 attempts/evidence。
- [ ] 单事务清零 `creditsSpent`、写退款审计并增加用户积分；重复执行断言退款为 0。
- [ ] 覆盖 PENDING 取消、PROCESSING 未 handoff 取消、已 handoff/UNKNOWN 取消、租约清理和管理员/页面触发的重复 finalizer。
- [ ] 外部 API abort/等待超时只返回 job ID 与稳定错误，不调用退款；后续查询能获得真实终态。
- [ ] 用户文案不声称“已退款”，除非数据库事务实际返回已退款金额。

审查闸门：每个失败分支都明确回答“是否可能已提交上游”“是否允许重试”“是否允许退款”。

## 9. 阶段 6：公平性、schema probe 与优雅停止

- [ ] 实现 `WORKER_MAX_ACTIVE_PER_USER` 与每用户最老任务候选策略，使用事务级互斥避免多个 Worker 竞态超额。
- [ ] 两用户/突发 fixture 验证不饿死和并发上限；不引入优先级系统。
- [ ] Worker 消费前调用 schema probe；测试缺表、缺列、缺枚举、缺唯一约束和正常 schema。
- [ ] 将 run loop 拆成停止 claim 与 drain 当前任务两阶段，支持可配置 grace period。
- [ ] 注入时钟/短 lease 测试 SIGTERM、租约丢失、grace 超时；按 attempt/handoff 状态选择安全重试或 UNKNOWN。

`release-hardening` 后续只把 probe 接到 HTTP `/readyz` 和部署拓扑，本任务不修改其拥有的文件。

## 10. 阶段 7：集成验证与记录

- [ ] 在 disposable PostgreSQL legacy snapshot + fake provider 上执行本任务验收矩阵，记录 job、attempt、用户积分和错误码快照；
  空库 migration 与历史升级证据链接到 release-hardening，不在此任务重复声称覆盖。
- [ ] 执行双 Worker 并发、重试、重复 finalizer、停止恢复和旧任务兼容测试。
- [ ] 运行全量 TypeScript/Go 门禁；前端全量测试的既有默认超时由 `release-hardening` 负责稳定化，本任务需记录是否仍为同一已知问题。
- [ ] `git diff --check`，全仓搜索旧字段/错误/模型规则消费者，确认文档、fixtures 与实现一致。
- [ ] 把命令、时间、退出码和未授权外部验证写入 `verification/`；不得记录密钥、完整 provider 响应或生产连接串。

最终命令：

```powershell
pnpm exec tsc --noEmit
pnpm verify:worker-contracts:ts
pnpm verify:worker-contracts:go
pnpm verify:worker-contracts:db
go -C worker build ./...
git diff --check
```

固定命令契约：

```powershell
# package.json 最终脚本应等价于以下命令，不得改成隐式全量入口
pnpm exec vitest run src/tests/contracts/generation-contract.test.ts src/tests/integration/worker-contracts/worker-contracts.test.ts src/tests/unit/external-generation-service.test.ts src/tests/unit/job-refund.test.ts src/tests/unit/generation-cancel-route.test.ts --reporter=dot --testTimeout=15000
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./internal/worker/...
pnpm exec tsx src/tests/integration/worker-contracts/postgres-runner.ts
```

普通 TS 门禁不包含 `worker-contracts-db.test.ts`；DB runner 必须设置 `WORKER_CONTRACTS_REQUIRE_DB=1` 和随机 `TEST_DATABASE_URL`，
再单独运行该文件。该文件禁止因环境缺失而 skip。

`verify:worker-contracts:ts/go/db` 分别包装上面三组命令，每组外层超时不超过 60 秒并保留真实退出码。全量 `pnpm test` 的既有并发超时
由 `release-hardening` 稳定化，不用占位符或可能无限运行的全量命令代替本子任务验收。

## 11. 质量复核与后续依赖

- [ ] 由 Trellis check 代理全范围复核 PRD/design/implement、schema、Node/Go 数据流和测试证据，并直接修复发现的问题。
- [ ] 若发现产品级 handoff/计费决策变化，回到 planning 更新文档并重新请求批准，不在实现中自行改变语义。
- [ ] 将冻结的 contract/schema 版本和 probe 接口交给 `release-hardening`；将媒体字段 fixture 交给 `media-sync-boundary`；
  `go-api-gateway` 只消费最终版本。
- [ ] 不在本子任务提交旧 Node 删除、生产迁移执行、真实渠道/S3/Zeabur 验证或手工退款。

## 12. 回滚策略

- 运行行为由兼容开关恢复为“无自动重试/现有队列处理”，但稳定错误码、显式渠道禁止静默换渠和 additive schema 保留。
- 新 Worker 不稳定时先关闭新 claim/重试/公平性开关，但保留识别 handoff guard 的兼容 finalizer；新增表/列继续保留。
- 完整回滚旧 Worker 前必须停止新入队与 claim，并通过固定查询/runner 证明 `PROCESSING + contractVersion>=1` 及
  `SUBMITTING/SUBMITTED/UNKNOWN` 数量均为 0；否则阻止启动旧二进制。
- 旧二进制无法自我执行新 probe；部署级阻断归 `release-hardening`。本任务必须提供默认关闭开关、预检命令和数据库 trigger 作为防误操作下限。
- 未知 handoff 数量异常时立即关闭自动重试，保留 attempts 和积分现状，交由后续授权的协调流程处理。
- 任何涉及生产 schema、真实账务、删除或批量修复的回滚都必须先单独向用户说明影响并取得明确确认。
