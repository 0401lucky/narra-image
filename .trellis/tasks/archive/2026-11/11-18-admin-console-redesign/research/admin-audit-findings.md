# 管理后台（/admin）代码级审计与契约盘点

## 1. 现有路由与组件清单

- 页面路由（18 个）：`src/app/admin/layout.tsx`、`src/app/admin/page.tsx`、`users/page.tsx`、`invites/page.tsx`、`redeem-codes/page.tsx`、`generations/page.tsx`、`works/page.tsx`、`moderation/page.tsx`、`prompts/page.tsx`、`benefits/page.tsx`、`api/page.tsx`、`settings/page.tsx` 及 6 个二级设置页（`oauth`、`turnstile`、`channels`、`login-cover`、`moderation`、`storage`）。缺失 `src/app/admin/loading.tsx`。
- 客户端组件（23 个）：位于 `src/components/admin/` 及 `src/components/admin/storage/`。

## 2. 已确认渲染与数据缺陷（附代码锚点）

1. **B1 — `backdrop-filter` 劫持 `position: fixed`**：`src/components/admin/cleanup-failed-button.tsx:44-67` 在 `.studio-card` 内部直接渲染未使用 `createPortal` 的 `fixed inset-0` 弹窗；因 `src/app/globals.css:203-224` 为 `.admin-console .studio-card` 设置了 `backdrop-filter: blur(20px)` 与 `:hover transform`，弹窗被限制在单行横幅内部。
2. **B2 — Tailwind v4 层叠覆盖**：`src/app/globals.css:1` 使用 `@import "tailwindcss"`（工具类在 `@layer utilities`），而 `src/app/globals.css:203-215` 与 `348-354` 的 `.admin-console .studio-card` / `.admin-console input|select|textarea` 未放入 `@layer`，覆盖了组件上的 `border-dashed`、`rounded-[2rem]` 与 `border-transparent bg-white/75`（`src/components/admin/generation-search-bar.tsx:49`）。
3. **B3 — 积分对比度崩溃**：`src/components/admin/admin-actions.tsx:573` 与 `1414` 使用 `text-[var(--accent-soft)]`（`#f1b99a`）配暖白底 `#fcf9f4`，对比度约 1.65:1，远低于 WCAG AA 4.5:1。
4. **B4 — 概览 7 列挤压**：`src/app/admin/page.tsx:83` 在扣除 `288px` 侧栏后的 `max-w-7xl` 内设置 `2xl:grid-cols-7`，单卡净宽仅约 114px。
5. **B5 — 截断切片统计失真**：`src/lib/server/works.ts:336-362` 单次混合拉取 `take: 120` 后由 `src/app/admin/works/page.tsx:23-27` 前端过滤计数；`src/app/admin/redeem-codes/page.tsx:52-66` 基于 `take: 40` 数组计算“启用中的码”。
6. **B6 — 非法交互嵌套**：`src/components/admin/channel-manager.tsx:524-559` 在 `<label>` 内同时嵌套 `<input type="checkbox">` 与 `<button>`。
7. **B7 — 视频任务误判与缺失**：`src/components/admin/admin-actions.tsx:102-104` 将 `TEXT_TO_VIDEO` / `IMAGE_TO_VIDEO` 硬编码显示为“文生图”，且 `src/app/admin/generations/page.tsx:169-178` 未关联 `videos`。

## 3. 可直接复用的后端能力与必须严守的契约

- **视频作品审核 API 已就绪**：`src/app/api/admin/works/[id]/review/route.ts:27-59` 与 `src/lib/validators.ts:172-176` 已支持 `mediaType: "image" | "video"` 并更新 `GeneratedVideo`。
- **渠道免泄密探测 API 已就绪**：`src/app/api/provider-models/probe/route.ts:28-44` 已支持管理员传入 `channelId` 在服务端解密探测上游 `/models`。
- **系统就绪探针已就绪**：`src/lib/readiness.ts` 提供 `checkApplicationReadiness()`。
- **Worker v1 契约红线**（`.trellis/spec/frontend/generation-worker-contracts.md:7,66`）：严禁对 `HANDOFF_UNKNOWN` 或 `contractVersion >= 1` 任务执行普通清理、强制改状态、硬删 `attempts` 或非契约人工退款；排障抽屉必须保持只读证据检视，积分补偿走独立的用户积分调整通道。
- **既有测试契约红线**：
  - `src/tests/unit/storage-manager.test.tsx`：依赖 `data-testid="storage-manager|storage-used|storage-unmanaged|storage-preview|storage-job|storage-job-released"` 及现有表单 label/按钮文案。
  - `src/tests/unit/login-cover-form-projection.test.tsx`：依赖自定义 URL `textbox`、`封面预览` 图片 `alt` 与 `保存配置` 按钮。
  - `src/tests/unit/admin-work-image-refresh.test.tsx`：依赖 `AdminWorksBoard` 的 `作品缩略图` 按钮与 `作品大图` 灯箱图片跟随 props 刷新。
  - `src/tests/unit/admin-generations-page.test.tsx`：依赖无额外筛选参数时 `AdminGenerationsPage` 的默认 `where` 结构与 `skip/take=20`。
