# 稳定 Go Worker 与跨层契约

## Goal

在保留 Next.js 认证、计费和页面边界的前提下，先把生成任务的
“入队 → 领取 → 上游 handoff → 结果/失败 → 退款”行为固化为 Node/Go
共同遵守的版本化契约。首个交付只增加兼容性与可观测性，不切换公开
`/v1`，不删除旧实现，也不做生产数据回填。

## Confirmed Evidence

- 网页入口会写入 `providerChannelId` 和 `workerManaged=true`，但只在入口检查渠道是否存在/启用，未确认模型属于该渠道
  （`src/app/api/generate/route.ts`；`worker/internal/worker/worker.go`）。
- Go `resolveProvider` 在显式渠道找不到后仍会按模型、首个活动渠道和环境变量回退，存在静默换渠道风险。
- `attemptCount` 会递增，但领取只挑选 `PENDING`，过期 `PROCESSING` 直接失败退款；`WORKER_MAX_ATTEMPTS` 当前没有实际重试效果。
- 外部 API 在源图上传后把任务交给 Worker；客户端取消/等待超时不会撤销已 handoff 的任务，且没有持久化的上游不确定状态
  （`src/lib/generation/external-api.ts`）。
- 当前 Prisma 只有 `GenerationJob` 的租约字段，没有 attempt ledger、稳定错误码或 provider request ID；退款依靠将 `creditsSpent` 清零实现幂等。

## Requirements

### R1. 版本化跨层契约

- 建立单一契约目录（建议 `contracts/generation/v1/`）及 JSON fixtures，定义任务状态、模型/渠道选择、错误分类、计费状态、
  attempt/handoff 和图片/视频结果字段；Node 与 Go 测试均消费同一组向量。
- 所有新增字段必须说明来源、空值/版本兼容和终态；不得在两个运行时复制一套未经测试的常量或解析器。
- 保留现有 `PENDING → PROCESSING → SUCCEEDED/FAILED` 枚举兼容性；如需表达取消或不确定 handoff，优先使用 additive 字段与稳定错误码，
  不在本子任务中删除或重命名现有枚举。
- `contractVersion` 的数据库默认值必须代表 legacy（0 或 NULL），`handoffState` 对旧写入必须可空；只有启用 v1 的新 Node 入队路径显式写入版本与初始状态，
  禁止把历史任务或旧写入者伪装成 v1。

### R2. 渠道与模型选择

- 显式指定的渠道必须在入队和 Worker 领取时都验证：渠道存在、启用、密钥可解密且请求模型等于默认模型或属于 `models`。
- 显式渠道失效/不兼容时返回稳定错误码并终止任务，不得按模型、首个活动渠道或环境变量静默回退。
- 未指定渠道的策略请求可以按确定性排序选择默认渠道，但选择结果必须落库为 `providerChannelId` 后才能领取；Node/Go 对同一组模型 ID
  （含前缀、斜杠、版本后缀和相似字符串）必须得到相同分流结果。
- 入队时保存所选渠道的规范化模型清单/关键快照；后续渠道配置漂移不得让同一 job 在重试时换渠道或改变模型归属判断。
- 自填渠道的 URL、密钥和模型列表继续由 Next 做入口校验，Go 只做防御性复核，不扩大到公开 Go ingress。

### R3. Attempt/handoff、重试与不确定状态

- 在可能向上游提交前创建持久化 attempt 记录，至少包含 `attemptCount`、开始/提交时间、稳定 operation/idempotency key、
  `providerRequestId`（如有）、错误码和结果确定性/状态。
- 只有能证明请求尚未提交上游的网络/429/明确 5xx 才允许回到 `PENDING`；`nextAttemptAt` 和 `WORKER_MAX_ATTEMPTS` 必须真实控制领取次数。
- 上游已接受但本地未写回、连接在提交边界断开或 provider request ID 不明时，标记 `HANDOFF_UNKNOWN`（或等价稳定错误码），禁止盲目重试和自动退款，
  并保证可通过查询/运维记录继续处理。
- 稳定 `Idempotency-Key` 只能降低重复提交风险，不能替代 attempt ledger，也不能假设所有第三方渠道具备恰好一次语义。

### R4. 取消、等待超时与计费

- `PENDING` 且尚未领取的取消：原子转失败/取消终态并退款一次。
- `PROCESSING` 但尚未 handoff 的取消：停止本地调用并退款一次；已 handoff 或不确定状态不得因 HTTP 连接中断自动退款。
- Worker 失败、租约过期、重试耗尽和结果写回冲突必须使用同一套一次性退款闸门；重复清理不会再次增加用户积分。
- 外部 API 等待超时只代表响应等待结束，返回可查询的 job ID 和稳定错误码；不把客户端超时误判为上游未执行。

### R5. 队列公平性、schema gate 与优雅停止

- 在不引入新消息基础设施的前提下增加可配置的用户级并发保护或等价公平性策略；验证单一用户突发任务不会永久阻塞其他用户。
- Worker 启动/`readyz` 前必须检查生成任务所需表、列、枚举和契约版本；缺失时拒绝报告可用，且错误可诊断。schema 检查函数/接口由本子任务提供，
  发布端点与拓扑接入由 `release-hardening` 独占。
- 收到停止信号后停止领取新任务，按明确 grace period 等待当前工作；租约丢失或进程退出后不得留下无法被清理/查询的永久 `PROCESSING`。
- 一旦数据库存在 contract v1 的活动 handoff 状态，旧 Worker/旧 stale finalizer 必须被启动闸门拒绝；完整回滚前必须停止新 claim 并证明相关任务已排空，
  否则只能关闭新执行特性、保留能识别 handoff guard 的兼容 finalizer。
- v1 入队/执行开关默认关闭；只有 `release-hardening` 完成旧 Worker 停止与部署闸门后才允许生产启用。本子任务只在 disposable 环境打开开关验证。
- 数据库保护必须允许 `creditsSpent=0` 的自填渠道任务正常进入 handoff；它只阻止未决 v1 任务把已预扣的正积分从 `>0` 清成 `0`。

### R6. 旧实现删除闸门

- 产出旧 `src/lib/providers/generate-images.ts`、`resolve-provider.ts` 及相关测试/构建入口的全仓生产引用清单和保留理由。
- 本子任务只记录删除前置条件（新网关替代路径、回滚开关、测试依赖和引用归零）；文件删除由 `08-07-go-api-gateway` 独占，且须另行确认。

## Ownership and Dependencies

- 本子任务独占：`contracts/generation/**`、attempt/错误/状态 fixtures、`GenerationJob` additive schema/migration、队列领取/重试/退款/租约核心实现、
  对应 Node/Go 单测与契约测试，以及 schema probe 接口。
- `08-07-release-hardening` 独占启动脚本、Docker/Compose、CI、readyz HTTP 暴露和迁移发布编排；它只能消费本任务冻结的 schema/状态/错误版本，
  不在同一变更中重新定义字段。
- `08-07-media-sync-boundary` 独占媒体 URL 长期存储和提示词同步；本任务只冻结媒体响应字段，不负责对象存储回填。
- `08-07-go-api-gateway` 必须等待本任务契约冻结，并独占公开协议切换和旧 Node 实现删除。

## Acceptance Criteria

- [ ] 固定渠道 + 不属于渠道的模型、停用渠道、删除渠道、配置漂移和密钥解密失败均产生稳定错误码；集成测试证明没有回退到其他渠道。
- [ ] 共享 fixtures 在 Node 与 Go 中均通过：状态流、模型分流、错误分类、图片/视频参数、attempt/handoff 字段和退款结果一致。
- [ ] 可重复测试覆盖：尚未提交时的有限重试、429/5xx、重试耗尽、提交后连接断开、provider request ID 缺失、重复清理和重复退款；
  每个 job 的 attempt 次数不超过配置，未知 handoff 不自动重提/退款。
- [ ] 取消/HTTP 等待超时在未领取、已领取未 handoff、已 handoff 三种阶段的状态、积分和查询响应均符合契约。
- [ ] 两个并发 Worker 和单一用户突发任务的队列测试通过公平性/用户并发上限；旧任务仍能被新 Worker 读取。
- [ ] schema probe 在缺少任一关键列/枚举/契约版本时失败；正常 schema 才允许消费，停止演练无永久悬挂任务。
- [ ] 混合版本测试证明：存在 `SUBMITTING/SUBMITTED/UNKNOWN` 时旧 Worker/旧 finalizer 不能启动或退款；排空闸门通过后才允许完整回滚。
- [ ] 形成旧 Node 生成器引用清单与网关删除闸门；本任务没有删除文件、没有生产部署、没有批量回填。

## Verification Matrix

- [ ] `pnpm exec tsc --noEmit`
- [ ] 相关 Vitest 契约/退款/取消测试（单次命令最长 60 秒）
- [ ] `go -C worker vet ./...`
- [ ] `go -C worker test -count=1 -timeout=50s ./...`
- [ ] `go -C worker build ./...`
- [ ] 若启用 PostgreSQL 集成测试，使用一次性测试数据库并把结果写入
  `.trellis/tasks/08-07-worker-contracts/verification/`；真实生产数据库另列为需授权证据。

## Rollback and Safety

- 先执行 additive migration，再部署兼容旧任务的 Worker；新重试/严格渠道校验由显式开关控制，默认可回到现有失败路径。
- 回滚代码时保留新增列/表和 fixtures，不执行删列、删表、批量回填或生产数据修复；任何这类操作需另行取得明确确认。
- 若发现上游 handoff 语义无法证明安全，关闭自动重试并保留查询/人工协调记录，不以“测试通过”掩盖不确定性。

## Out of Scope

- 不迁移登录、OAuth、Turnstile、用户资料、API Key 管理后台或页面渲染。
- 不在本子任务中实现公开 Go `/v1` 网关，不删除旧 Node 生成器，不引入 Redis/Kafka/Kubernetes。
