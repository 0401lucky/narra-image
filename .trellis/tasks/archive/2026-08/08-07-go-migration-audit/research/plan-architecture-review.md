# Research: 渐进深化规划架构反对意见审查

- Query: 审查父任务规划是否过度设计、违背渐进深化、遗漏依赖，及单容器 Go 网关与子任务边界是否可实施。
- Scope: internal
- Date: 2026-08-07

## Findings

### BLOCKER

1. **Go 网关的鉴权/计费边界自相矛盾。** PRD 将用户、积分、API Key 域 Go 化延后（`prd.md:75-79`），设计也保留 Next 会话鉴权与 `/v1` 薄代理（`design.md:33-46`），但执行计划又要求网关迁移 API Key、限流和计费（`implement.md:96-103`）。这会把最后一个子任务从“协议网关”扩大成用户域迁移，违背渐进深化。**建议：** MVP 明确由 Next 完成 API Key、限流、扣费和请求级安全校验，Go 只接收已认证、已规范化的内部请求并负责生成协议；若确需下沉，另立后续子任务。

2. **“不得重复上游提交/计费”缺少可实现的故障模型。** 规划仅提出稳定 `Idempotency-Key`、重试次数和退款一次（`prd.md:18-23`，`design.md:78-83`），却未定义 Worker 在“上游已接受、数据库尚未记录”时崩溃的持久化 attempt/handoff 状态。第三方若不保证幂等，自动重试无法证明恰好一次。**建议：** 增加持久化 attempt ledger、`upstreamSubmittedAt/providerRequestId` 与“结果不确定”终态；只在确认未提交时自动重试，对提交结果不确定的任务停止自动重试并进入查询/人工协调。验收语义改为“退款恰好一次；上游提交在可证明安全时重试”。

3. **子任务依赖与共享文件所有权尚未形成可启动契约。** 父计划允许 `worker-contracts` 与 `release-hardening` 分别推进，但二者都会改 schema gate、Worker server/config、readyz 和测试基础设施（`design.md:139-150`，`implement.md:121-127`）；当前只有“先协调”，没有明确前置顺序、共享接口 owner 或合并闸门。**建议：** 在两个子任务 PRD/implement 中写明：契约/schema 由 `worker-contracts` 先定版，`release-hardening` 依赖该版本并独占部署与健康入口；媒体响应契约由 `media-sync-boundary` 先交付，网关子任务只消费。子任务文件就绪前不得启动父任务实施。

### WARNING

1. **单容器网关方向可行，但进程契约不足。** `loopback Go gateway + Next 薄代理` 不需要 Zeabur 暴露第二个公网端口（`design.md:92-101`），但规划未决定网关是并入现有 Worker HTTP 进程还是新增二进制，也未定义端口冲突、启动顺序、崩溃重启、优雅停止和 dedicated 模式地址发现。**建议：** 优先复用同一 Go 进程/HTTP server；明确 `GATEWAY_ADDR`、Next 内部 URL、liveness/readiness、supervisor 退出传播和两种拓扑矩阵。

2. **`media-sync-boundary` 合并了两个独立风险域。** 媒体持久化与提示词抓取/调度的依赖、回滚和验收并不相同（`design.md:85-109`，`implement.md:76-94`），绑在一个子任务会扩大变更面并阻塞 Go 网关。**建议：** 至少在子任务内拆成可独立验收的 A/B 阶段；更稳妥的是拆为两个子任务，网关只依赖媒体阶段，不依赖提示词同步完成。

3. **发布验收包含当前不可本地证明的外部条件。** 计划要求 Zeabur、真实 S3、历史数据库升级和故障恢复，但又明确不自动部署生产（`prd.md:33-37`，`implement.md:129-136`）。**建议：** 把验收分为仓库内强制闸门与需用户授权的环境验收，定义测试数据库快照/fixture、对象存储模拟器和 Zeabur 手工证据模板，避免子任务因外部权限无限期无法完成。

### OK

1. **总体边界符合渐进深化。** Next 保留页面、BFF、鉴权和管理域，Go 聚焦生成、队列、存储与观测（`prd.md:26-44`，`design.md:33-52`），没有为了“全 Go”引入新的消息基础设施。

2. **单容器主路径的架构选择合理。** 先让 Next 代理 loopback Go 网关，再把直接公开路由延期（`prd.md:39-44`，`design.md:94-101`），能保留单公网端口和快速回滚；在补齐上述进程契约后具备可实施性。

3. **迁移顺序和回滚原则基本正确。** 先契约与 additive schema，再发布/媒体，最后网关切换与旧实现清理（`prd.md:41-53`，`design.md:131-150`），且明确不在同一发布删除旧字段或旧路径。

## Files Found

- `prd.md`：目标范围、关键决策、子交付与父级验收。
- `design.md`：目标架构、跨运行时契约、单容器网关及依赖图。
- `implement.md`：阶段计划、子任务职责、验证与回滚点。

## Related Specs

- `.trellis/workflow.md`：复杂任务与父子任务的规划、依赖和启动闸门。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：跨运行时数据流、契约 owner 与回滚检查。

## Caveats / Not Found

- 本评审只判断父级规划的一致性和可实施性，未重新验证代码或生产平台状态。
- 子任务尚需各自形成 PRD、design、implement 和显式依赖；父级文档不能替代这些启动契约。
