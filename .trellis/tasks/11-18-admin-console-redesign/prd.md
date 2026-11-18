# 管理后台现代运营台重构（视觉、交互、动效与运营闭环）

## Goal

将 Narra Image 管理后台（`/admin`）从当前多批次拼装的卡片页全面升级为一套**兼具「暖纸质社论美学（Warm Editorial Operations Studio）」与高效率现代运营体验的管理中枢**：根治多卡毛玻璃掉帧、CSS 层叠覆盖与弹窗受困等渲染缺陷，统一导航架构、微交互动效与反馈原语，并在零数据库 Schema 迁移、严守 Worker v1 契约的前提下补齐大盘趋势、作品批量/视频审核、用户 360° 洞察、失败与待协调任务排障、渠道测速检索等核心运营闭环。

## Background & Confirmed Facts

- **视觉与性能现状**：`src/app/globals.css:203-224` 在未分层 CSS 中为 `.admin-console .studio-card` 全局开启 `backdrop-filter: blur(20px)` 与 `:hover` 位移，不仅在 20～120 张卡片同屏时拖慢合成器滚动帧率，还因 Tailwind v4 `@layer utilities` 优先级低于未分层样式，吞掉了空状态卡片的 `border-dashed`、`rounded-*` 及 `src/components/admin/generation-search-bar.tsx:49` 的输入框透明边框样式。
- **壳层与路由现状**：`src/components/layout/page-transition.tsx:19-21` 对 `/admin` 短路返回裸容器，且 `src/app/admin/` 下无 `loading.tsx`，导致所有 `force-dynamic` 页面切换时出现点击无反馈硬切；`src/components/admin/admin-frame.tsx:31-61,230-239` 与各子页面重复渲染双 `<h1>`，遗漏 `/admin/moderation` 与 `/admin/settings/*` 二级面包屑，将 `/admin/api` 误标为“自填渠道与密钥”，并在顶栏硬编码“系统正常”（`admin-frame.tsx:260-263`）。
- **交互与弹窗现状**：10 余处后台弹窗中仅 `ImageLightbox` 与移动端抽屉具备动效；`src/components/admin/cleanup-failed-button.tsx:44-67` 因未用 `createPortal` 被父级 `backdrop-filter` 锁死在窄横幅内；多处删除/停用混用阻塞式 `window.confirm/alert`，角色提权无二次确认（`src/components/admin/user-admin-card.tsx:160-181`），签到保存与积分更新无成功提示，多处开关操作静默忽略 `!response.ok`。
- **数据模型与后端能力现状**：`prisma/schema.prisma` 已有完整的 `GeneratedVideo`、`GenerationAttempt`、`OAuthProvider` 等字段；`/api/admin/works/[id]/review`（`src/app/api/admin/works/[id]/review/route.ts:27-59`）已原生支持 `mediaType: "video"`，`/api/provider-models/probe`（`src/app/api/provider-models/probe/route.ts:28-44`）已支持管理员凭 `channelId` 探测上游模型，无需任何 Prisma Schema 迁移即可打通全部三阶段后台能力。

## Child Task Map

1. **`11-18-admin-ui-foundation`（阶段一：后台底层样式止血、动效体系与通用 UI 原语建设）**
   - 负责 CSS `@layer` 修复、去重度模糊化 Bento 视觉令牌、通用原语库（`AdminModal` / `AdminConfirmDialog` / `AdminDrawer` / `AdminToastProvider` / `AdminSwitch` / `AdminTabs` / `AdminPageHeader` / `AdminCommandPalette`）、可折叠分组侧栏、多级面包屑、`/admin/loading.tsx` 骨架屏，以及全后台原生 `confirm/alert` 和破损弹窗替换。
2. **`11-18-admin-core-operations`（阶段二：概览大盘、风控合一、用户 360 管理与作品批量审核升级）**
   - 依赖阶段一原语；负责真实系统健康度与待办角标聚合、概览页 7 日趋势图与待办队列、设置总览实时状态徽章、内容风控（拦截日志 + 规则词库检索）双页联动、用户管理高密度表格/筛选排序/积分预览确认/360° 详情抽屉，以及作品审核服务端分页 Tab、视频作品接入与多选批量审核。
3. **`11-18-admin-diagnostics-and-tooling`（阶段三：生成流水排障抽屉、生图渠道测速检索与运营码表闭环）**
   - 依赖阶段一原语并与阶段二集成；负责生成流水视频任务兼容、多维状态/类型/渠道筛选、只读排障与 `GenerationAttempt` 协调证据抽屉，生图渠道一键连通测速、模型关键词搜索与可视化排序，以及邀请码/兑换码/API Key/福利页的标签规范、精确统计、批次检视弹窗、搜索筛选与分页闭环。

## Requirements

- **R1（现代暖纸质运营台视觉与 CSS 层叠修复）**：修复 `src/app/globals.css` 中 `.admin-console` 的 `@layer` 归属，恢复 Tailwind 工具类（`border-dashed`、`rounded-*`、输入框类）正常生效；移除普通展示/列表容器上的 `backdrop-filter: blur(20px)` 与非交互 `:hover` 上浮特效（仅可点击卡片保留悬停反馈）；修正 `src/components/admin/admin-actions.tsx:573,1414` 的低对比度积分文字（达到 WCAG AA ≥ 4.5:1）与 `src/app/admin/page.tsx:83` 的 7 列挤压布局。
- **R2（丝滑微交互与路由加载体系）**：新增 `src/app/admin/loading.tsx` 结构化骨架屏与路由切换视觉反馈；侧栏导航、二级导航、分段控制器统一接入 `motion` `layoutId` 共享滑块过渡；弹窗、侧滑抽屉、折叠区与全局 Toast 统一具备平滑进退场动画并遵守 `prefers-reduced-motion`。
- **R3（统一后台交互原语与无障碍防呆）**：建立统一 `AdminModal` / `AdminConfirmDialog` / `AdminDrawer` / `AdminToastProvider` / `AdminSwitch`，全面替换 `window.confirm/alert` 与非 Portal 内联弹窗（修复 `cleanup-failed-button.tsx:44-67` 受困弹窗）；所有弹层支持 `Esc` 关闭、背景滚动锁定与 `role="dialog"`；所有操作失败必须显式报错、成功有明确反馈；管理员角色变更必须二次确认；消除所有无可见 `<label>` 输入框、开关正反语义混用与 `<label><button>` 非法嵌套（`channel-manager.tsx:524-559`）。
- **R4（分组可折叠壳层、精准面包屑与快捷指令）**：将侧栏重组为「运营中枢 / 内容与风控 / 用户与增长 / 模型与基建」四大分组（保留全部既有 `/admin/*` 路由兼容），支持桌面侧栏展开/窄轨折叠与 `⌘K` / `Ctrl+K` 全局快捷跳转面板；消除顶栏与正文双 `<h1>` 重复，补齐 `/admin/moderation` 与全部 `/admin/settings/*` 精确面包屑，修正 `/admin/api` 标题文案，统一设置子页容器宽度避免导航跳动。
- **R5（真实健康度、行动导向大盘与设置状态透出）**：接通数据库/存储就绪度、启用渠道数、存储水位、待审投稿/下架、待协调任务与同步异常源，驱动顶栏真实健康状态指示器、侧栏待办角标、概览页 7 日生图/积分趋势 SVG 图表与待办事项面板，并在 `/admin/settings` 各模块卡片直接展示当前启用/配置状态摘要。
- **R6（内容风控收口升级）**：打通 `/admin/moderation` 与 `/admin/settings/moderation` 的双向 Tab 导航；拦截记录支持按关键词/用户搜索与分类筛选；内置敏感词库改为支持关键词即时过滤的分类标签视图。
- **R7（用户管理高密度化与 360° 详情抽屉）**：提供紧凑表格（默认）与卡片双视图，支持按角色、封禁状态、OAuth 登录源筛选及按注册时间/积分/生成数排序；积分调整器改为明确的「增加 / 扣减」双模式并实时预览变更后余额；点击用户可打开 360° 详情抽屉查看邀请码来源、OAuth 绑定、最近生成、签到/兑换记录与 API Key。
- **R8（作品审核分页化、视频支持与批量审核）**：修复 `listAdminWorks(take = 120)` 截断统计失真，改为服务端精确分状态计数 + 分页 + 搜索 + 状态 Tab（待审核/下架申请/已公开）；打通 `GeneratedVideo` 视频作品预览与审核；支持多选批量通过、批量拒绝与批量强制下架。
- **R9（生成流水排障、渠道测速检索与码表闭环）**：生成记录支持 `TEXT_TO_VIDEO` / `IMAGE_TO_VIDEO` 标签与视频预览，补齐状态（含 `FAILED` 与 `HANDOFF_UNKNOWN`）/类型/来源/渠道模式筛选及卡片/列表一致操作；新增严守 v1 契约的只读「任务排障与协调证据抽屉」（展示 `errorCode`、`errorMessage`、`refundAppliedAt`、`GenerationAttempt` 明细、一键复制排障摘要及跳转用户积分管理入口）；生图渠道新增单卡一键连通测速、弹窗模型搜索过滤、可视化上下移排序与未保存防误关；邀请码、兑换码与 API Key 补齐精确统计、批次详情检视、搜索、状态筛选、分页与移动端操作对齐。

## Acceptance Criteria

- [ ] **AC1（R1/R2/R3 视觉、动效与原语）**：后台列表滚动无大面积 `backdrop-filter` 重绘负担；空态虚线框、圆角、输入框样式与积分对比度（≥ 4.5:1）正常；`window.confirm` / `window.alert` 在 `src/components/admin/` 中清零；所有弹窗/抽屉通过 `createPortal` 渲染并支持 `Esc` 关闭与进退场动画；路由切换有骨架屏与导航滑块过渡。
- [ ] **AC2（R4/R5/R6 壳层、大盘与风控）**：单页仅保留唯一语义 `<h1>`，全部 18 个后台路由面包屑准确无误；桌面侧栏可折叠且支持 `⌘K`/`Ctrl+K` 跳转；顶栏状态与概览页待办/7日趋势反映真实服务端数据；内容风控日志与规则词库可一键互切且支持搜索过滤。
- [ ] **AC3（R7/R8 用户与作品核心运营）**：用户页支持表格/卡片切换、多维筛选排序、带预览的增减积分与 360° 用户详情抽屉；作品审核页统计不受单页条数截断，支持图片与视频作品分状态分页审核及多选批量操作。
- [ ] **AC4（R9 排障、渠道与码表闭环）**：生成记录可筛选查看失败任务、视频任务与待协调任务的 `GenerationAttempt` 证据抽屉，且不对 `contractVersion >= 1` 或 `HANDOFF_UNKNOWN` 任务产生任何违背 v1 契约的写操作；生图渠道支持单卡测速、模型搜索与排序调整；邀请码、兑换码、API Key 统计准确且具备搜索、状态筛选与分页。
- [ ] **AC5（兼容性与质量门禁）**：零 Prisma Schema 迁移；既有单测（含 `storage-manager.test.tsx`、`login-cover-form-projection.test.tsx`、`admin-work-image-refresh.test.tsx`、`admin-generations-page.test.tsx`）与新增后台单测全部通过；`pnpm lint`、`npx tsc --noEmit`、`pnpm verify:worker-contracts:ts` 全部零错误通过。

## Out of Scope

- 修改数据库表结构或新增 Prisma Migration（如新增后台操作审计日志物理表、可编辑敏感词数据库表、邀请码过期字段等均不在本次范围）。
- 修改 `contracts/generation/v1/`、Go Worker 状态机或为 `HANDOFF_UNKNOWN` 新增强制改状态/自动退款写接口。
- 变更前台页面（首页 `/`、创作台 `/create`、视频台 `/video`、公开作品页 `/works`、登录注册页）的视觉与交互行为。

## Key Decisions & Constraints

- **审美定位**：采用「Warm Editorial Operations Studio（暖调现代运营台）」——保留深咖侧栏 + 暖宣纸画布 + 陶土橙品牌色 + 衬线/等宽数字排版层次，以高锐度轻量边框 Bento 面板与侧滑抽屉替代厚重低效的全卡片毛玻璃。
- **路由完全向后兼容**：侧栏分组重构与风控页面联动均保留原有全部 `/admin/*` URL 路径可访问，不破坏书签、外链与既有路由测试。
- **严守测试与运行契约**：保留 `StorageManager`、`LoginCoverForm`、`AdminWorksBoard`、`AdminGenerationsPage` 默认查询等全部既有测试锚点与语义。
