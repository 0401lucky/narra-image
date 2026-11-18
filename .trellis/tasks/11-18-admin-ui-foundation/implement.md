# 阶段一执行清单：底层样式止血、动效体系与通用 UI 原语

## 1. 实施步骤（Ordered Checklist）

- [x] **Step 1：CSS 层叠修复与视觉令牌重构**
  - 更新 `src/app/globals.css`：将 `.admin-console` 默认组件规则移入 `@layer components`，去掉普通卡片 `backdrop-filter` 与默认悬停上浮，补充 `.admin-card-interactive` 与 `--admin-ink-credit`。
- [x] **Step 2：建立 `src/components/admin/constants.ts` 与 `src/components/admin/ui/*` 原语库**
  - 编写路由/分组/面包屑常量表 `constants.ts`。
  - 实现 `admin-modal.tsx`、`admin-drawer.tsx`、`admin-toast-provider.tsx`、`admin-switch.tsx`、`admin-tabs.tsx`、`admin-page-header.tsx`、`admin-command-palette.tsx`。
- [x] **Step 3：升级后台壳层、导航与 `loading.tsx`**
  - 重构 `AdminFrame`（挂载 `AdminToastProvider` 与 `AdminCommandPalette`、可折叠侧栏、非 `<h1>` 多级面包屑）、`AdminNav`（四分组 + `layoutId` 指示器 + 折叠态 Tooltip）、`SettingsSubNav`（`layoutId` 滑块）。
  - 新增 `src/app/admin/loading.tsx`。
  - 统一 18 个后台页面的 `<AdminPageHeader>` 与 `/admin/settings/turnstile` 外层宽度。
- [x] **Step 4：清零原生 `confirm/alert`、破损弹窗与静默错误**
  - 升级 `CleanupFailedButton`、`UserAdminCard`（含角色切换二次确认）、`AdminWorksBoard`、`ModerationReviewsBoard`、`PromptModal`、`InviteBatchDelete`、`InviteBatchCopy`、`InviteDeleteBtn`、`InviteTableActions`、`RedeemBatchDelete`、`RedeemBatchCopy`、`ChannelManager`、`ApiAdminPanel`、`CheckInBenefitForm`、`ShowcaseAutoApproveToggle`。
- [x] **Step 5：编写单测并执行质量门禁**
  - 新增 `src/tests/unit/admin-ui-foundation.test.tsx` 覆盖面包屑映射（含 `/admin/moderation` 与全部 `/admin/settings/*`）、`AdminModal` Portal/`Esc` 关闭、`AdminToastProvider` 与 `⌘K` 面板。

## 2. 验证命令

```powershell
pnpm lint
npx tsc --noEmit
pnpm test
git diff --check
```

## 3. 回滚与风控点

- 检查 `src/tests/unit/prompt-modal-copy.test.tsx`、`storage-manager.test.tsx`、`login-cover-form-projection.test.tsx`、`admin-work-image-refresh.test.tsx` 在测试环境中（jsdom `document.body` Portal 与 `motion/react`）全部绿灯通过。
