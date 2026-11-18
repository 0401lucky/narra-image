# 阶段一技术设计：底层样式止血、动效体系与通用 UI 原语

## 1. 组件与文件边界

遵循 `.trellis/spec/frontend/component-guidelines.md`（命名导出、`type XxxProps`、`cn()`、装饰图标 `aria-hidden`、中文 `aria-label`、按钮显式 `type="button"`）：

- `src/app/globals.css`
  - 将 `.admin-console` 下的 `.studio-card`、`table`、`thead`、`input/select/textarea` 默认样式包裹进 `@layer components { ... }`，确保组件级 Tailwind 工具类（`@layer utilities`）始终拥有更高优先级。
  - 定义 `--admin-canvas`、`--admin-surface`、`--admin-surface-subtle`、`--admin-border`、`--admin-border-strong`、`--admin-accent`、`--admin-ink-credit`（`#b54722`）。
  - 新增 `.admin-card-interactive`：承载平滑 `transform` + `border-color` + `box-shadow` 悬停微交互。
- `src/components/admin/ui/`
  - `admin-modal.tsx`：导出 `AdminModal` 与 `AdminConfirmDialog`。使用 `AnimatePresence` + `motion.div`（遮罩 `opacity` 0.16s，面板 `opacity + scale(0.96 -> 1) + y(8 -> 0)` 0.2s `[0.22, 1, 0.36, 1]`），挂载期间锁定 `document.body.style.overflow = "hidden"` 并监听 `Escape`。
  - `admin-drawer.tsx`：导出 `AdminDrawer`。右侧固定面板 `x: "100%" -> 0` 弹簧缓动，供后续阶段复用。
  - `admin-toast.tsx`：导出 `AdminToastProvider` 与 `useAdminToast()`。维护最多 4 条堆叠消息，支持 `success | error | warning | info` 变体与自动消失定时器清理。
  - `admin-switch.tsx`：导出 `AdminSwitch`。标准 `button[role="switch"][aria-checked]`，带 `motion` 拨珠弹簧位移。
  - `admin-tabs.tsx`：导出 `AdminTabs`（链接型或受控按钮型均可），使用唯一 `layoutId` 渲染平滑滑动底板。
  - `admin-page-header.tsx`：导出 `AdminPageHeader`，统一渲染 `eyebrow`、`<h1>`、`description` 与右侧 `actions` 插槽。
  - `admin-command-palette.tsx`：导出 `AdminCommandPalette`，注册全局 `keydown`（`(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"`），内置全部 18 个后台路由索引与上下方向键选择回车跳转。
- `src/components/admin/admin-frame.tsx` & `admin-nav.tsx` & `settings-sub-nav.tsx`
  - 提取纯函数 `resolveAdminBreadcrumb(pathname)`（放入 `src/components/admin/admin-routes.ts` 单一事实来源，同时供给 `AdminNav`、`AdminFrame` 与 `AdminCommandPalette`）。
  - 桌面侧栏支持 `isCollapsed`（`w-64` ↔ `w-[4.5rem]`），顶部原死 `+` 块替换为侧栏折叠按钮，新增 `⌘K` 搜索触发条，底部常驻管理员卡片与 `LogoutButton`。
  - 全部 18 个 `src/app/admin/**/page.tsx` 头部统一改用 `<AdminPageHeader>`，并将 `/admin/settings/turnstile/page.tsx` 容器由 `max-w-3xl` 统一至 `max-w-7xl`（表单内部卡片可用 `max-w-4xl` 控制阅读行宽，确保 `SettingsSubNav` 宽度不跳动）。
- `src/app/admin/loading.tsx`
  - 渲染符合新 Bento 布局的页头 + 指标卡 + 表格骨架屏（复用 `<Skeleton>`）。

## 2. 兼容性保障

- `PromptModal`（`src/components/works/prompt-modal.tsx`）被前台与后台共同引用：升级为 `createPortal` + `Esc` 关闭 + `motion` 轻缓动时，保留原有标题“完整提示词”、复制按钮文案“复制提示词”与 `prompt-modal-copy.test.tsx` 断言完全一致。
- `StorageManager` 与 `LoginCoverForm` 保持原有表单 label、`data-testid` 和按钮可访问名称不变。
