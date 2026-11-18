# 阶段一：后台底层样式止血、动效体系与通用 UI 原语建设

## Goal

一次性根治管理后台（`/admin`）的 CSS 层叠冲突、多卡毛玻璃滚动掉帧、受困弹窗与交互反馈混乱问题，建立统一的「Warm Editorial Operations Studio」后台 UI 原语库、可折叠分组导航壳层、精确面包屑、`⌘K` 快捷指令面板与路由加载骨架屏，为阶段二和阶段三提供稳固、高颜值的交互底座。

## Background & Confirmed Facts

- **CSS 层叠与 GPU 缺陷**：`src/app/globals.css:203-224,348-354` 将 `.admin-console .studio-card` 与表单控件写在未分层 CSS 中，压制了 Tailwind v4 `@layer utilities`（导致空状态 `border-dashed`、`rounded-*` 与搜索框 `border-transparent` 失效），并对所有卡片施加 `backdrop-filter: blur(20px)` 与非可点 `:hover` 上浮特效。
- **积分可读性缺陷**：`src/components/admin/admin-actions.tsx:573,1414` 使用 `#f1b99a`（`--accent-soft`）配浅色背景，对比度仅 1.65:1。
- **壳层与路由缺陷**：`src/app/admin/` 缺少 `loading.tsx`；`src/components/admin/admin-frame.tsx:31-61,84-86,230-239,287` 存在双 `<h1>` 堆叠、桌面侧栏死 `+` 装饰块、漏配 `/admin/moderation` 与 `/admin/settings/*` 二级面包屑、`/admin/api` 标题误标为“自填渠道与密钥”，以及无效的 `transition-all`。
- **弹窗与反馈割裂**：`src/components/admin/cleanup-failed-button.tsx:44-67` 未用 `createPortal` 导致弹窗被父级 `backdrop-filter` 锁在窄横幅内；多处删除/停用混用 `window.confirm/alert`；管理员提权无确认（`src/components/admin/user-admin-card.tsx:160-181`）；签到保存与积分更新无成功反馈；多处开关按钮正反语义混用且静默吞掉 `!response.ok` 错误。

## Requirements

- **R1（CSS `@layer` 归位与高性能 Bento 视觉令牌）**：将 `src/app/globals.css` 中 `.admin-console` 的卡片、表格与输入框默认规则移入 `@layer components`，恢复 Tailwind 工具类覆盖能力；移除普通 `.studio-card` 的 `backdrop-filter` 与默认 `:hover` 上浮，新增显式 `.admin-card-interactive` 类供导航卡使用；定义高对比度积分与语义令牌（对比度 ≥ 4.5:1）。
- **R2（通用后台 UI 原语库 `src/components/admin/ui/`）**：实现命名导出且符合项目规范的 `AdminModal` / `AdminConfirmDialog`（`createPortal`、`motion` 进退场、`Esc` 关闭、滚动锁定、`role="dialog"`、`preventOutsideClose`）、`AdminDrawer`（右侧滑出抽屉）、`AdminToastProvider` + `useAdminToast()`、`AdminSwitch`（`role="switch"`）、`AdminTabs` / `AdminSegmentedControl`（`motion` `layoutId` 滑块）、`AdminPageHeader`（唯一语义 `<h1>`）与 `AdminCommandPalette`（`⌘K` / `Ctrl+K` 快捷跳转）。
- **R3（可折叠分组导航壳层与路由加载反馈）**：重构 `AdminFrame` 与 `AdminNav`，按「运营中枢 / 内容与风控 / 用户与增长 / 模型与基建」分组展示导航（保留全部既有 `/admin/*` URL），支持桌面侧栏展开（`256px`）/ 窄轨图标模式（`72px`）折叠切换与持久化、底部管理员信息与登出入口、顶栏 `⌘K` 触发器；补齐全部 18 个路由的精确面包屑并消除顶栏重复 `<h1>`；统一 `/admin/settings/*` 容器宽度为 `max-w-7xl`；新增 `src/app/admin/loading.tsx` Bento 骨架屏。
- **R4（全后台破损弹窗、`confirm/alert` 与静默错误清零）**：使用新原语替换 `CleanupFailedButton`、`UserAdminCard`（含新增角色变更二次确认）、`AdminWorksBoard`、`ModerationReviewsBoard`、`GenerationAdminList`、`GenerationAdminCard`、`PromptModal`、`InviteBatchDelete`、`InviteBatchCopy`、`InviteDeleteBtn`、`InviteTableActions`、`RedeemBatchDelete`、`RedeemBatchCopy`、`ChannelManager`、`ApiAdminPanel`、`CheckInBenefitForm`、`ShowcaseAutoApproveToggle` 中的原生 `confirm/alert`、非 Portal 弹窗与开关歧义，并补齐所有写请求的成功/失败 Toast 反馈。

## Acceptance Criteria

- [ ] **AC1（R1）**：`.admin-console` 内 `border-dashed`、`rounded-*` 与自定义输入框工具类正常生效；列表卡片无 `backdrop-filter` 且非链接卡片悬停不上浮；积分文字对比度 ≥ 4.5:1。
- [ ] **AC2（R2/R4）**：`src/components/admin/` 下不再存在任何 `confirm(` 或 `alert(` 调用；`CleanupFailedButton` 等全部弹窗均通过 `createPortal` 挂载至 `document.body`，具备进退场动画且支持 `Esc` 关闭；角色变更具备二次确认；签到、积分、渠道、邀请码等写操作均有明确成功/错误反馈。
- [ ] **AC3（R3）**：每个后台页面仅渲染 1 个 `<h1>`；访问 `/admin/moderation`、`/admin/api` 及全部 `/admin/settings/*` 时顶栏面包屑准确；桌面侧栏支持折叠/展开与 `⌘K` / `Ctrl+K` 搜索跳转；`src/app/admin/loading.tsx` 可正常渲染骨架屏。
- [ ] **AC4（回归与单测）**：新增后台 UI 原语与壳层单测通过，既有全部单测、`pnpm lint`、`npx tsc --noEmit` 零错误通过。

## Out of Scope

- 新增后端聚合/分页 API、用户 360° 抽屉数据接口、作品批量审核与视频作品接入（属阶段二 `11-18-admin-core-operations`）。
- 生成流水排障抽屉、渠道测速与码表检索分页扩展（属阶段三 `11-18-admin-diagnostics-and-tooling`）。
- 任何前台页面样式改动或数据库 Schema 迁移。
