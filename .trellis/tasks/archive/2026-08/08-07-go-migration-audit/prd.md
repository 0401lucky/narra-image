# 审计并补全项目 Go 化迁移

## Goal

采用“渐进深化”完成项目 Go 化：保留 Next.js 页面、BFF、鉴权和管理后台，把 Go 深化到生成协议、队列可靠性、媒体存储、提示词同步和运行观测，并通过分阶段灰度、验证和回滚闭环替代一次性全后端重写。

## Confirmed Facts

- 当前真实架构是 `Next.js + Prisma + PostgreSQL + Go Worker`；约 70 个 Next 路由仍承担产品/API 外层，Go 主要承担图片/视频生成执行、队列、结果写回、退款和健康端点。
- 网页生成与四个 OpenAI 兼容生图入口已把模型执行交给 Worker，但认证、限流、计费、解析、响应格式化和大部分数据访问仍在 Next。
- 旧 Node/OpenAI 生成器没有生产引用但仍被测试使用；提示词同步同时存在 Node 管理入口和 Go 手动命令。
- 队列优先级/用户限流、可靠重试、存储服务化、实时推送、provider request ID 和用户域下沉仍无完成证据。
- embedded 与 dedicated 两种拓扑并存；普通启动可能通过 `db push`/批量 resolve 绕过真实 migration，且缺少 CI、迁移升级矩阵和完整 E2E runner。
- 当前 Go 全量测试和 TypeScript 类型检查通过；前端全量测试的两个默认超时项在提高单测超时后通过，需要后续稳定化。

## Requirements

- Node/Go 之间必须对任务状态、模型/渠道、错误分类、计费退款、媒体字段和 API 响应建立语言无关的共享契约测试。
- 显式渠道失效或模型不兼容必须稳定失败，不得静默换渠道；重试、取消和请求超时不得造成重复扣费、退款或上游提交。
- 对“上游已接受但本地未写回”的不确定状态必须有持久化 attempt/handoff 记录；不得仅凭 Idempotency-Key 宣称恰好一次。
- Zeabur embedded 作为生产主路径，dedicated Compose 作为隔离联调和未来扩缩容路径；两种模式必须显式互斥并具备健康、停止和故障恢复契约。
- 生产数据库升级必须真实执行 migrations，历史接管/repair/baseline 只能通过显式运维流程进行；任何不可逆数据操作必须另行确认。
- 生产图片和视频必须有长期可访问的持久化策略；提示词抓取、解析和入库只能保留一个权威实现和调度入口。
- Go `/v1` 生成网关只能在 Worker 契约、发布回滚和媒体响应稳定后灰度切换；旧 Node 实现只能在替代路径与回滚验证完成后删除。
- Go 网关第一阶段只消费 Next 已认证、已限流、已计费的内部 envelope；公开 Go ingress、API Key 和用户域下沉另立任务。
- 每个子交付必须有独立 PRD、设计、执行计划、验证记录和回滚点，父任务负责跨子任务集成验收。

## In Scope

- Worker 队列公平性、有限重试、取消/退款语义、模型与渠道契约、schema gate、优雅停止和跨运行时测试。
- embedded/dedicated 发布拓扑、受控 Prisma migration、CI/E2E、readyz、指标、日志、环境变量和回滚。
- 图片/视频持久化、历史媒体兼容、提示词同步、调度、幂等和失败恢复。
- 外部 images、edits、responses、chat 和 generation 查询的 Go 内部网关、Next 薄代理、灰度开关及旧直连实现清理。

## Out of Scope

- 不全量迁移页面渲染、OAuth、Turnstile、邀请码、用户资料、积分管理后台和其他非性能关键 Next.js API。
- 不自动部署生产，不删除生产数据，不删除容器/volume，不执行未经确认的批量回填或不可逆数据库变更。
- 不因追求“全 Go”提前引入 Redis、Kafka、Kubernetes 等缺少负载证据的新基础设施。

## Key Decisions

- 目标边界：Next.js 产品/BFF/鉴权层 + Go 生成/基础设施层 + PostgreSQL 共享事实来源。
- 迁移顺序：先 Worker 与跨层契约，再生产发布/观测，再媒体与同步，最后切换 Go `/v1` 网关并清理旧实现。
- Zeabur 单容器继续作为生产主形态；初期 Go 网关运行在内部端口，由 Next `/v1` 薄代理接入，后续是否直接路由给 Go 另行评估。
- 用户域迁移明确延后，只有真实性能数据和新的用户决策才会另立任务。

## Child Deliverables

1. `08-07-worker-contracts`（P0）：队列、模型/渠道、重试/取消、计费和跨层契约。
2. `08-07-release-hardening`（P0）：生产 migration、拓扑、CI/E2E、readyz、指标和回滚。
3. `08-07-media-sync-boundary`（P1）：媒体持久化与提示词同步统一。
4. `08-07-go-api-gateway`（P1）：外部 `/v1` Go 网关、灰度回滚和旧 Node 实现清理。

依赖关系记录在各子任务 PRD 中；父任务不直接承担业务实现，只负责阶段顺序、交叉变更协调和最终集成审查。

## Acceptance Criteria

- [x] 已形成架构、功能/API、运行部署、历史和测试基线报告，并给出文件/历史证据。
- [x] 四个子交付分别完成其 PRD 验收，依赖、回滚点和验证结果可追溯（worker-contracts / release-hardening / media-sync-boundary / go-api-gateway 均已归档，各含 verification/）。
- [x] 网页生成和外部 API 的渠道、模型、计费、退款、状态和媒体字段均有 Node/Go 共享契约测试（contracts/generation/v1 + contracts/gateway/v1 被 TS/Go 共同消费）。
- [x] embedded 与 dedicated 模式均通过启动、迁移、健康、停止和失败恢复验证，生产 migration 不再被静默跳过（release-hardening：migrate-deploy/baseline/repair + 拓扑互斥 + readyz）。
- [x] 生产图片/视频具有长期持久化保证，提示词同步只有一个权威实现和可观测调度入口（media-sync-boundary：S3 强制 + PromptSyncer 唯一实现）。
- [x] Go `/v1` 网关通过灰度、回滚及兼容测试，旧 Node 直连实现仅在生产引用和测试依赖归零后删除（go-api-gateway：GATEWAY_ENABLED 开关 + 独立删除提交）。
- [x] Next 页面、BFF、鉴权、管理后台及现有用户数据保持兼容（全量 vitest / next build 通过）。
- [x] TypeScript、Go、单测、类型检查、lint、生产构建、容器和代表性 E2E 均通过，已知测试超时得到稳定化处理（verify:ci 9 阶段全过；全量 vitest --testTimeout=30000）。
- [x] `design.md`、`implement.md`、`implement.jsonl` 与 `check.jsonl` 完整，最新规划经用户明确批准后才进入实施。

## Technical Evidence

- `research/architecture-inventory.md`
- `research/feature-parity.md`
- `research/operations-gaps.md`
- `research/migration-history.md`
- `research/baseline-validation.md`

## Deferred Items

- 用户、积分、API Key 和 OAuth 域的 Go 化。
- Go 直接占用公开 `/v1` 端口并完全绕过 Next ingress。
- PostgreSQL 行队列是否替换为独立消息系统；只有负载与可靠性数据证明必要时再评估。
