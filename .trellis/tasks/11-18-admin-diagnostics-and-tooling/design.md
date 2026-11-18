# 阶段三技术设计：生成流水排障抽屉、生图渠道测速检索与运营码表闭环

## 1. 生成流水与只读排障抽屉设计

### 1.1 默认查询兼容与扩展筛选（`src/app/admin/generations/page.tsx`）
- 解析可选查询参数：`status`（`"" | "ALL" | "SUCCEEDED" | "ACTIVE" | "FAILED" | "COORDINATION"`）、`type`（`"" | GenerationType`）、`source`（`"" | GenerationClientSource`）、`mode`（`"" | ProviderMode`）。
- **兼容守卫**：当 `status`、`type`、`source`、`mode` 均为空时，`visibleWhere` 构造逻辑保持原样（保证 `admin-generations-page.test.tsx` 对 `mockFindMany` 参数的快照式深比较不发生偏差；注意检查 `admin-generations-page.test.tsx` 中 `include` 使用的是 `expect.objectContaining({ user: ... })`，因此在 `include` 中安全追加 `videos: { orderBy: { createdAt: "asc" } }` 不会破坏该单测！）。
- 当管理员选择 `status=FAILED` 时，查询 `status: GenerationStatus.FAILED`（同时展示普通失败与待协调失败），让管理员终于能在后台排查上游报错。

### 1.2 单任务只读排障详情接口（`GET /api/admin/generations/[id]`）
- 新建 `src/app/api/admin/generations/[id]/route.ts`（仅暴露 `GET`，严禁添加写接口）：
  - 校验 `requireAdminRecord()`；
  - 查询 `GenerationJob`（含 `user: { id, email, nickname }`、`apiKey: { id, name, keyPrefix }`、`images`、`videos`、`attempts: { orderBy: { ordinal: "asc" } }`，如存在 `providerChannelId` 同步附带渠道名称 `name/slug`，**绝不返回 `providerApiKeyEncrypted`**）；
  - 前端 `GenerationDiagnosticDrawer`（基于 `AdminDrawer`）分四栏展示：① 状态与计费/退款摘要（对 `HANDOFF_UNKNOWN` 显式展示契约保护说明与跳转用户积分管理快捷入口）；② 上游错误码与原始 `errorMessage`；③ `GenerationAttempt` 重试轨迹卡片（`ordinal`、`workerId`、`status`、`providerRequestId`、提交与完成耗时）；④ 完整参数与一键复制纯文本排障报告。

## 2. 生图渠道升级设计（`src/components/admin/channel-manager.tsx`）

- **单卡连通测速**：每张卡片维护本地探测状态 `probeState[channel.id]: { status: "idle" | "probing" | "ok" | "error"; latencyMs?: number; modelCount?: number; defaultModelAvailable?: boolean; message?: string }`。点击“探测”记录 `performance.now()` 并请求 `POST /api/provider-models/probe`（`{ baseUrl: ch.baseUrl, channelId: ch.id }`），完成后在卡片底部显示耗时徽章与默认模型命中状态。
- **可视化排序**：按 `sortOrder asc` 排序展示卡片；点击“上移 / 下移”与相邻渠道交换顺序（若两者 `sortOrder` 相同则按当前数组索引重排赋值），并行调用 `PATCH /api/admin/channels/[id]` 持久化并刷新本地列表。
- **DOM 合法化与模型搜索**：将模型项外层由 `<label>` 改为普通 `<div>` 容器，左侧 `<label>` 仅包裹 `<input type="checkbox">`，右侧独立 `<button type="button">` 设为默认模型，彻底消除 HTML5 非法交互嵌套；顶部增加 `modelQuery` 搜索框实时过滤 `fetchedModels`。

## 3. 码表与 API Key 检索分页设计

- **兑换码批次详情接口**：在既有 `src/app/api/admin/redeem-codes/batches/[id]/route.ts` 中新增 `GET` handler，返回批次元数据、下属兑换码（含 `redeemedCount / maxRedemptions`）及最近兑换用户明细，前端提供 `RedeemBatchViewModal`（对标 `InviteBatchViewModal`）。
- **精确统计与服务端分页**：
  - `src/app/admin/redeem-codes/page.tsx`：使用 `db.redeemCode.count({ where: { isActive: true, OR: [{ batchId: null }, { batch: { isActive: true } }] } })` 计算真实启用码数；兑换码表支持 `q`、`status`（`active | inactive`）与 `page` 分页。
  - `src/app/admin/invites/page.tsx`：邀请码表支持 `q`（码值/备注/使用邮箱）与 `status`（`unused | claimed | used`）筛选，移动端卡片补齐一键复制码值与 `<InviteDeleteBtn>`。
  - `src/app/admin/api/page.tsx`：支持 `q`（Key 名称/前缀/用户邮箱）、`status`（`active | revoked`）与 `page`（每页 20 条）服务端分页。
