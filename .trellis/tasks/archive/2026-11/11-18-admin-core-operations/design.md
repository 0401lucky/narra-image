# 阶段二技术设计：概览大盘、风控合一、用户 360 管理与作品批量审核

## 1. 服务端聚合与 API 设计

### 1.1 系统状态与概览数据（`src/lib/server/admin-overview.ts`）
- **`getAdminShellSummary()`**（可在 `src/app/admin/layout.tsx` 或 `GET /api/admin/system-status` 中调用，所有子查询做容错降级以免单个可选模块阻塞整个后台布局）：
  - `activeChannelCount`: `db.providerChannel.count({ where: { isActive: true } })`
  - `pendingWorksCount`: `db.generationImage.count({ where: { showcaseStatus: "PENDING" } }) + db.generatedVideo.count({ where: { showcaseStatus: "PENDING" } })`
  - `takedownPendingCount`: 图片 + 视频 `TAKEDOWN_PENDING` 合计
  - `coordinationCount`: `db.generationJob.count({ where: { contractVersion: { gte: 1 }, handoffState: "UNKNOWN", status: "FAILED" } })`
  - `failedPromptSourcesCount`: `db.promptSource.count({ where: { isEnabled: true, status: "FAILED" } })`
  - 综合状态分级：`healthy`（渠道 ≥ 1 且无异常） / `attention`（存在待协调任务或同步失败或 0 启用渠道） / `degraded`。
- **`getAdminDashboardTrend(days = 7)`**：
  - 拉取近 7 日 `GenerationJob`（仅 `select: { createdAt, status, creditsSpent }` 或 SQL 按日聚合），在服务端按本地自然日桶生成 `{ dateLabel, succeeded, failed, creditsSpent }[]`，传入纯 SVG 图表组件 `<AdminTrendChart>` 渲染暖陶土渐变折线/柱状组合图。

### 1.2 用户 360° 详情接口（`GET /api/admin/users/[id]`）
在 `src/app/api/admin/users/[id]/route.ts` 新增 `GET` handler：
- 校验 `requireAdminRecord()`；
- 查询用户基础字段（`id, email, nickname, avatarUrl, role, credits, bannedAt, oauthProvider, createdAt`）、`inviteUsed`（`code, note, batch.title`）、`_count`（`generations, canvases, contentReviews, likedWorks`）、最近 8 条 `generations`（含首张图片/视频预览、模型、状态、积分、时间）、最近 8 条 `checkInRecords`、最近 8 条 `redeemRedemptions`（含 `code.code`）、名下 `apiKeys`（前缀、调用数、状态、最后使用时间）。
- 绝不下发 `passwordHash`、`customProviderConfig.apiKeyEncrypted`、`keyHash` 等敏感字段。

### 1.3 作品审核分页、视频整合与批量审核
- **`src/lib/server/works.ts`**：
  - 新增统一后台审核视图类型 `SerializedAdminReviewItem`（在 `SerializedAdminWork` 基础上增加 `mediaType: "image" | "video"`、`posterUrl?: string | null`、`durationSeconds?: number | null`；保留原 `listAdminWorks` 与 `AdminWorksBoard` 兼容导出以保障 `admin-work-image-refresh.test.tsx` 无缝运行，或让 `AdminWorksBoard` 同时支持单页传入与受控分页 props）。
  - `getAdminReviewCounts()`：并行 `count` 图片与视频的 `PENDING`、`TAKEDOWN_PENDING`、`FEATURED`。
  - `listAdminReviewPage({ status, mediaType, q, page, pageSize = 20 })`：按状态过滤并支持对作者邮箱/昵称/提示词/模型的搜索与稳定分页。
- **`src/app/api/admin/works/batch-review/route.ts`**：
  - Zod schema `adminWorkBatchReviewSchema`：`{ items: z.array(z.object({ id: z.string().min(1), mediaType: z.enum(["image", "video"]).default("image") })).min(1).max(50), action: z.enum(adminWorkReviewActions), reviewNote: z.string().trim().max(300).optional().nullable() }`。
  - 在服务端逐项读取当前状态并调用既有 `applyAdminWorkReview()`，状态不匹配项记入 `skippedIds` 而不中断整批，更新完成后统一 `revalidateTag("featured-works", "max")`。

## 2. 前端组件拆分

- `src/components/admin/dashboard/admin-trend-chart.tsx`：响应式纯 SVG 7 日趋势卡片（支持切换「生图量 / 积分消耗」，带键盘/指针悬浮数据气泡）。
- `src/components/admin/users/user-table.tsx`、`user-detail-drawer.tsx`、`credit-adjust-popover.tsx`。
- `src/components/admin/moderation/moderation-nav-tabs.tsx`：复用于 `/admin/moderation` 与 `/admin/settings/moderation`。
- `src/components/admin/admin-works-board.tsx`：升级支持状态 Tab、媒体筛选、全选/多选批量审核工具栏、图片灯箱（保留 `作品缩略图` / `作品大图` 可访问名称）与视频预览弹窗。
