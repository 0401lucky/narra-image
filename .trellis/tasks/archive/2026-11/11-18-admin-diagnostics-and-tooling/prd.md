# 阶段三：生成流水排障抽屉、生图渠道测速检索与运营码表闭环

## Goal

补完后台最后一块拼图——面向日常运维排障与资产发行的全功能工具集：让生成记录流水完整支持视频任务、多维筛选与严守 v1 契约的 `GenerationAttempt` 只读排障证据抽屉，为生图渠道管理补上一键连通测速、百级模型即时搜索与可视化排序，并修复邀请码、兑换码、API Key 页面的统计截断缺陷与搜索/分页/移动端缺失。

## Background & Confirmed Facts

- **前置依赖**：依赖阶段一（`11-18-admin-ui-foundation`）通用原语，建议在阶段二（`11-18-admin-core-operations`）后衔接交付。
- **生成流水现状**：
  - `src/app/admin/generations/page.tsx:143-160,169-178` 默认隐藏普通 `FAILED` 任务且未关联 `videos`；`src/components/admin/admin-actions.tsx:102-104` 将所有非 `IMAGE_TO_IMAGE` 任务误标为“文生图”。
  - 页面统计了 `HANDOFF_UNKNOWN`（“需人工协调”）但无任何详情抽屉查看 `errorCode`、`errorMessage` 或 `GenerationAttempt`（`providerRequestId`、`workerId`）。根据 `.trellis/spec/frontend/generation-worker-contracts.md:7,66`，对 `HANDOFF_UNKNOWN` 严禁执行普通清理、强制改状态、硬删 `attempts` 或非契约人工退款。
  - 既有单测 `src/tests/unit/admin-generations-page.test.tsx` 断言了未传筛选参数时 `AdminGenerationsPage` 的精确默认 `where` 查询结构。
- **生图渠道现状**：`src/components/admin/channel-manager.tsx:519-559` 模型列表无搜索框（中转站常返回数百模型），且存在 `<label>` 内嵌 `<button>` 的非法 HTML 结构；卡片无一键测速按钮（后端 `src/app/api/provider-models/probe/route.ts:28-44` 已支持凭 `channelId` 免泄密探测）；排序仅能手填数字且弹窗点遮罩即丢弃未保存内容。
- **运营码表与 API Key 现状**：
  - `src/components/admin/redeem-code-manager.tsx:110-147` 与 `src/components/admin/admin-actions.tsx:806-814` 存在多个无 `<label>` 裸数字输入框。
  - `src/app/admin/redeem-codes/page.tsx:52-66` 用 `take: 40` 数组过滤计算“启用中的码”，且无分页、无搜索、无批次详情检视弹窗。
  - `src/app/admin/invites/page.tsx:163-197` 移动端卡片漏掉删除与复制操作，顶部含空白无数据的“批次概览”占位卡（`invites/page.tsx:88-93`），且列表无搜索与状态筛选。
  - `src/app/admin/api/page.tsx:25-39` 硬拉 `take: 200` 无搜索、无状态筛选、无分页。

## Requirements

- **R1（生成记录视频兼容、多维筛选与只读排障抽屉）**：
  - 补全 `TEXT_TO_VIDEO`（「文生视频」）与 `IMAGE_TO_VIDEO`（「图生视频」）标签识别，关联 `videos` 并支持视频预览播放；对齐卡片视图与列表视图的操作能力（查看排障详情、复制链接、下载、删除）。
  - 新增状态（默认视图 / 全部 / 已完成 / 生成中 / 普通失败 / 需人工协调）、任务类型、调用来源（网页 / API）、渠道模式（内置 / 自填）筛选器；**当未传入新增筛选参数时，保持与原默认查询结构完全一致**。
  - 新增只读接口 `GET /api/admin/generations/[id]` 与右侧滑出「任务排障与协调证据抽屉」：展示完整正负向提示词、模型与参数、`errorCode`、`errorMessage`、`handoffState`、`refundAppliedAt`、按 `ordinal` 排列的 `GenerationAttempt` 重试时间线（含 `workerId`、`status`、`providerRequestId`、时间戳与错误详情）、一键「复制排障摘要」及「前往该用户积分管理」跳转链接。**不对 `contractVersion >= 1` 或 `HANDOFF_UNKNOWN` 任务提供任何违背 v1 契约的状态修改或自动退款写入口**。
- **R2（生图渠道测速、模型检索与可视化排序）**：
  - 修复 `ChannelManager` 中 `<label>` 嵌套 `<button>` 的非法结构；在编辑弹窗模型区增加即时关键词搜索框与类型过滤提示；未保存修改时点击遮罩弹出确认防丢稿。
  - 在每张渠道卡片新增「探测 / 测速」按钮（调用 `POST /api/provider-models/probe` 传入 `channelId`），展示响应耗时（ms）、拉取模型数及默认模型是否可用。
  - 在渠道卡片展示排序序号并提供快捷「上移 / 下移」按钮。
- **R3（邀请码、兑换码与开放 API 页规范化闭环）**：
  - 为邀请码与兑换码创建器的全部字段补齐可见 `<label>`；修复 `/admin/redeem-codes` 的“启用中的码”服务端精确 `count`，新增 `GET /api/admin/redeem-codes/batches/[id]` 与 `RedeemBatchViewModal` 批次明细检视。
  - 为 `/admin/invites`、`/admin/redeem-codes`、`/admin/api` 补齐关键词搜索（`q`）、状态过滤与服务端分页；补齐邀请码移动端卡片的复制/删除按钮，并将 `/admin/invites` 空白“批次概览”卡替换为真实批次开放/领取率统计。

## Acceptance Criteria

- [ ] **AC1（R1）**：`/admin/generations` 正确区分展示四类生成任务与视频预览；支持按失败状态、待协调状态、类型、来源筛选；点击任一记录可打开只读排障抽屉查看 `errorMessage` 与 `GenerationAttempt` 明细并复制排障摘要；无额外筛选参数时 `admin-generations-page.test.tsx` 原有断言保持 100% 通过；`pnpm verify:worker-contracts:ts` 通过。
- [ ] **AC2（R2）**：`ChannelManager` 无非法 `<label><button>` 嵌套；模型列表支持关键词即时搜索；渠道卡片支持一键连通探测并展示耗时与默认模型状态，支持上下移调整顺序。
- [ ] **AC3（R3）**：邀请码与兑换码创建器所有输入框均带明确可见 `<label>`；兑换码启用数采用数据库精确计数并支持批次详情弹窗检视；邀请码、兑换码、API Key 列表均支持搜索、状态筛选与分页，邀请码移动端具备复制与删除操作。
- [ ] **AC4（质量门禁）**：新增单测与既有全部单测、`pnpm lint`、`npx tsc --noEmit`、`pnpm verify:worker-contracts:ts` 全部零错误通过。

## Out of Scope

- 修改 `contracts/generation/v1/`、Go Worker 代码或新增 `HANDOFF_UNKNOWN` 强制结案/退款写接口。
- 新增数据库列（如邀请码/兑换码物理过期时间字段）。
