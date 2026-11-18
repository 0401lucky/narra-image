# 技术架构与体验设计：管理后台现代运营台重构

## 1. 架构分层与设计系统边界

### 1.1 视觉令牌系统（Warm Editorial Operations Studio）
在 `src/app/globals.css` 中，将 `.admin-console` 相关基础样式纳入 `@layer components`，避免压制 `@layer utilities` 中的 Tailwind 类：
- **画布与表面层级**：
  - `--admin-canvas: #f7f3ec`（底层暖麻纸背景，辅以极淡静态网格纹理，无滚动重绘开销）
  - `--admin-surface: #ffffff`（主工作面板/表格底色，清晰利落）
  - `--admin-surface-subtle: #fcf9f4`（次级内嵌区块/表头底色）
  - `--admin-border: rgba(54, 35, 18, 0.09)` / `--admin-border-strong: rgba(54, 35, 18, 0.16)`
  - `--admin-accent: #c85a32` / `--admin-ink-credit: #b54722`（在 `#ffffff` 与 `#fcf9f4` 上对比度 > 5.4:1，替代原 `#f1b99a`）
- **合成器性能准则**：
  - 仅在固定单实例壳层（吸顶 `.admin-topbar`、浮层弹窗遮罩）保留适度 `backdrop-filter`。
  - `.admin-console .studio-card` 移除 `backdrop-filter` 与默认 `:hover { transform: translateY(-2px) }`；新增显式 `.admin-card-interactive` 供导航入口卡使用。

### 1.2 通用后台 UI 原语层（`src/components/admin/ui/`）
| 组件 | 职责与交互契约 |
| :--- | :--- |
| `admin-modal.tsx` | `AdminModal` 与 `AdminConfirmDialog`：`createPortal(..., document.body)`、`motion` `opacity + scale(0.96 -> 1)` 进退场、`Escape` 关闭、背景滚动锁定、`role="dialog"` + `aria-modal="true"`、可选 `preventOutsideClose` 防误触丢稿。 |
| `admin-drawer.tsx` | 右侧滑出详情抽屉（`max-w-xl` / `max-w-2xl`）：用于用户 360° 档案、生成任务排障证据检视、批次码检视；支持粘性顶栏/底栏与独立滚动区。 |
| `admin-toast.tsx` | `AdminToastProvider`（挂载于 `AdminFrame`）+ `useAdminToast()`：右下/右上角非阻塞消息栈，替代散落的内联提示与 `window.alert`。 |
| `admin-switch.tsx` | 标准 `role="switch"` 拨杆控件，彻底消除“按钮显示当前状态 vs 点击后动作”的文案歧义。 |
| `admin-tabs.tsx` | 基于 `motion` `layoutId` 的分段控制器与二级导航条，提供零跳动平滑滑块过渡。 |
| `admin-page-header.tsx` | 统一单页唯一语义 `<h1>`、副标题、统计胶囊与右侧主操作区；顶栏 `AdminFrame` 仅展示非 `<h1>` 的多级面包屑。 |
| `admin-command-palette.tsx` | `⌘K` / `Ctrl+K` 呼出的快捷导航面板，支持拼音/中英文关键词秒跳全部 18 个后台模块与常用设置。 |

## 2. 跨层数据流与新增/扩展接口契约

所有后台接口统一复用 `requireAdminRecord()` 鉴权与 `jsonOk / jsonError` 信封格式，**不引入任何 Prisma Schema 变更**：

1. **系统健康与概览聚合（Server Helper + 轻量状态接口）**
   - `src/lib/server/admin-overview.ts`：
     - `getAdminShellStatus()` / `GET /api/admin/system-status`：汇总数据库连通、存储水位（复用 `getStorageManagementOverview` 容错读取）、启用生图渠道数、待审图片+视频作品数、待处理下架数、`HANDOFF_UNKNOWN` 待协调数、失败提示词源数，供 `AdminFrame` 顶栏真实状态胶囊与侧栏待办角标消费。
     - `getAdminDashboardData()`：除累计指标外，按过去 7 天自然日聚合生图任务数（成功/失败）与积分消耗趋势，并汇总待办队列。
2. **用户 360° 详情与多维查询**
   - `src/app/admin/users/page.tsx`：扩展 `searchParams` 支持 `q`、`role`（`ADMIN | USER`）、`status`（`active | banned`）、`auth`（`oauth | password`）、`sort`（`newest | credits | generations`）与 `view`（`table | card`，默认 `table`）。
   - `GET /api/admin/users/[id]`（在现有 `DELETE` 同路由文件新增 `GET`）：按需返回该用户的注册邀请码、OAuth 绑定、最近 10 条生成任务（含缩略图/状态/积分）、最近 10 条签到与兑换流水、名下 API Key 列表。
3. **作品审核（含视频与批量操作）**
   - `src/lib/server/works.ts` 新增 `listAdminReviewItems({ status, mediaType, q, page, pageSize })` 与 `getAdminReviewCounts()`：使用独立 `count` 统计 `PENDING / TAKEDOWN_PENDING / FEATURED`（合并 `GenerationImage` 与 `GeneratedVideo`），彻底修复 `take: 120` 截断导致统计归零的问题。
   - 新增 `POST /api/admin/works/batch-review`：接收 `{ items: Array<{ id, mediaType }>, action, reviewNote }`（单次上限 50 项），逐项复用 `applyAdminWorkReview` 校验状态转换并在完成后统一 `revalidateTag("featured-works", "max")`，返回成功数与跳过原因。
4. **生成记录排障与筛选**
   - `src/app/admin/generations/page.tsx`：
     - **当未传入额外筛选参数（`status` / `type` / `source` / `providerMode` 均为空）时，严格保持原有 `where` 结构不变**，确保既有单测与默认隐藏普通失败任务的预期完全兼容。
     - 当管理员显式选择筛选条件（如 `status=FAILED`、`status=COORDINATION`、`status=ALL`、`type=TEXT_TO_VIDEO` 等）时按条件查询，并关联 `videos` 以展示视频任务预览。
   - 新增 `GET /api/admin/generations/[id]`：只读查询单条 `GenerationJob` 的完整元数据、关联用户、图片/视频产物及全部 `GenerationAttempt`（按 `ordinal asc` 排序），供排障与协调证据抽屉展示。**严禁修改任何 `contractVersion >= 1` 或 `HANDOFF_UNKNOWN` 记录状态**。
5. **渠道测速、排序与码表分页检索**
   - 渠道单卡“测速”直接调用既有 `POST /api/provider-models/probe`（传入 `{ baseUrl, channelId }`），前端计时 RTT 毫秒数并校验 `defaultModel` 是否在返回列表中。
   - `/admin/invites`、`/admin/redeem-codes`（新增 `GET /api/admin/redeem-codes/batches/[id]` 批次明细接口）、`/admin/api` 补齐 `q` 搜索、`status` 过滤与 `AdminPagination` 分页，并用 `db.redeemCode.count` 修复兑换码启用数统计。

## 3. 兼容性、风险控制与回滚策略

- **零数据库迁移**：全部改动限缩在 `src/app/admin/**`、`src/app/api/admin/**`、`src/components/admin/**`、`src/lib/server/**` 与 `src/app/globals.css` 的 `.admin-console` 作用域内，不影响生产滚动发布或 Go Worker 进程。
- **既有单测锚点保护**：
  - `StorageManager` 保留全部 `data-testid`、`role="region"` 与表单 `label` 文案；
  - `LoginCoverForm`、`AdminWorksBoard`（`作品缩略图` / `作品大图`）、`AdminGenerationsPage` 默认分支完全兼容现有单测断言。
- **分阶段可独立验证与回滚**：三个子任务各自形成独立可编译、可测试、可提交的闭环，任一阶段如需回退均可按子任务粒度安全回滚。
