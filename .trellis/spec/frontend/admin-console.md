# Admin Console UI & API Contracts

> 管理后台（`/admin/*` 与 `/api/admin/*`）的视觉层叠、组件原语、只读排障边界与接口脱敏契约。

---

## 1. Scope / Trigger

- **适用范围**：`src/app/admin/**`、`src/components/admin/**`、`src/app/api/admin/**`、`src/lib/server/admin-overview.ts` 以及 `src/app/globals.css` 中的 `.admin-console` 样式层。
- **触发条件**：新增后台页面/弹窗/抽屉/Tab、修改后台导航与面包屑、新增或变更 `/api/admin/*` 接口、处理生成任务后台排障或作品批量审核时必须遵守本规范。

---

## 2. Signatures

### 2.1 Admin UI Primitives (`src/components/admin/`)

- 路由与导航真源：`src/components/admin/constants.ts`
  - `ADMIN_NAV_GROUPS`、`ADMIN_SETTINGS_LINKS`、`ADMIN_COMMAND_ITEMS`
  - `resolveAdminBreadcrumb(pathname: string): AdminBreadcrumb`
  - `isAdminNavItemActive(pathname: string, href: string): boolean`
- 统一交互原语（`src/components/admin/ui/*`）：
  - `AdminPageHeader({ eyebrow, title, description?, icon?, badge?, actions? })` — 全站后台唯一的 `<h1>` 出口（顶栏面包屑使用非标题语义节点，避免双 `<h1>`）。
  - `AdminModal` / `AdminConfirmDialog` — `createPortal(..., document.body)` + `role="dialog"` + `aria-modal="true"` + `Escape` 关闭与滚动锁；后台严禁使用 `window.confirm` / `window.alert`。
  - `AdminDrawer({ open, onClose, title, eyebrow?, description?, width?, footer?, children })` — 右侧滑出详情与排障抽屉（`width: "md" | "lg" | "xl"`）。
  - `AdminTabs` / `AdminLinkTabs` — 基于 `motion.div` `layoutId` 的分段滑块导航。
  - `AdminSwitch` — 标准 `role="switch"` + `aria-checked` 开关。
  - `useAdminToast()` — 返回 `{ toast, success, error, warning, info, dismiss }`，Provider 外调用时退化为空操作以兼容独立单测渲染。

### 2.2 Cross-Layer Admin APIs

- `GET /api/admin/system-status` → `{ data: { summary: AdminShellSummary } }`
- `GET /api/admin/users/[id]` → `{ data: { user: UserDetailPayload } }`
- `POST /api/admin/works/batch-review` → 入参 `adminWorkBatchReviewSchema`（`action`, `items: Array<{ id, mediaType: "image" | "video" }>`, `reviewNote?`），返回 `{ data: { updatedCount, updatedIds, skippedCount, skippedIds } }`
- `GET /api/admin/generations/[id]` → **严格只读**单任务排障与 `GenerationAttempt` 轨迹查询（严禁暴露写方法）
- `GET /api/admin/redeem-codes/batches/[id]` → `{ data: { codes, redemptions } }`

---

## 3. Contracts

### 3.1 敏感字段脱敏契约（Redaction Allowlist）

- `GET /api/admin/users/[id]` 必须使用显式 Prisma `select` 白名单，**严禁**查询或返回 `User.passwordHash`、`ApiKey.keyHash`、`SavedProviderConfig.apiKeyEncrypted`。
- `GET /api/admin/generations/[id]` 必须使用显式 Prisma `select` 白名单，**严禁**查询或返回 `GenerationJob.providerApiKeyEncrypted` 与 `ProviderChannel.apiKeyEncrypted`。
- **Worker v1 协调保护契约**：对于 `contractVersion >= 1` 且 `handoffState === "UNKNOWN"`（或 `errorCode === "HANDOFF_UNKNOWN"`）的任务，后台只允许通过 `GenerationDiagnosticDrawer` 提供只读证据展示、复制排障摘要与跳转 `/admin/users?q=<email>` 人工补偿入口，严禁在后台新增强制退款、状态改写或物理删除绕过接口。

### 3.2 CSS 层叠与动效性能契约（Tailwind CSS v4）

- `.admin-console` 下的元素级默认规则（`table`、`thead`、`input`、`select`、`textarea`）必须包裹在 `@layer components` 中，确保组件上的 Tailwind 工具类（如 `bg-transparent`、`rounded-full`、`border-dashed`）不会被未分层选择器覆盖。
- 禁止在列表普通卡片 `.admin-console .studio-card` 上挂载 `backdrop-filter: blur(...)` 或默认 `:hover { transform: translateY(...) }`；仅可点击导航卡显式添加 `.admin-card-interactive`，仅顶栏/模态框/抽屉/Toast 等少量浮层使用 `.admin-floating-surface`。
- 积分与强调数值统一使用 `--admin-ink-credit: #b54722`（浅底对比度 ≥ 4.5:1）配合 `font-mono tabular-nums`。

### 3.3 部分模块 Mock 兼容契约（Vitest Guardrails）

- `src/components/admin/ui/*` 与共享弹窗组件只允许 `import { motion } from "motion/react"` 并使用 `motion.div`，**禁止**静态导入 `AnimatePresence`（既有单测如 `admin-work-image-refresh.test.tsx` 仅部分 mock `{ motion: { div } }`）。
- 后台页面组件（如 `AdminWorksPage`、`AdminInvitesPage`、`AdminRedeemCodesPage`、`AdminApiPage`）的 `props?: { searchParams?: Promise<...> }` 应设为可选，且服务端筛选条优先采用 `<form action="/admin/..." method="get">` + `AdminLinkTabs`，避免在仅 mock `{ redirect, notFound }` 的隐私回归测试中因调用 `useRouter()` 报错。

---

## 4. Validation & Error Matrix

| 条件 | 行为 / 状态码 |
|------|---------------|
| 非管理员请求 `/api/admin/system-status` | `403` + `{ error }` |
| 非管理员请求其他 `/api/admin/*` 路由 | `400` + `{ error }`（由 `requireAdminRecord()` 抛出） |
| `GET /api/admin/users/[id]` 或 `GET /api/admin/generations/[id]` 目标不存在 | `404` + `{ error: "用户不存在" \| "生成任务不存在" }` |
| `POST /api/admin/works/batch-review` 含状态不匹配或已不存在的条目 | 合法条目正常更新并刷新 `revalidateTag("featured-works", "max")`，非法条目归入 `skippedIds` 返回 `200` |
| `/admin/generations` 未传 `status/type/source/mode` 扩展筛选参数 | `visibleWhere` 保持原始结构不变（隐藏普通 `FAILED`，保留 `HANDOFF_UNKNOWN`） |

---

## 5. Good / Base / Bad Cases

- **Good**：`GenerationDiagnosticDrawer` 打开 `HANDOFF_UNKNOWN` 任务时展示 `attempts` 列表中的 `providerRequestId`，引导管理员核对上游账单后点击链接跳往用户页手动补分。
- **Base**：`AdminWorksBoard` 不传 `activeStatus` 时回退展示全部三个分区（`PENDING` / `TAKEDOWN_PENDING` / `FEATURED`），传入 `activeStatus` 时仅渲染当前队列并支持多选批量审核。
- **Bad**：在 `src/components/admin/` 中调用 `window.confirm()`、在 `GET /api/admin/generations/[id]` 中直接 `findUnique({ where: { id } })` 未加 `select` 导致泄漏 `providerApiKeyEncrypted`、或在 `globals.css` 顶层无 `@layer` 覆盖 `.admin-console input`。

---

## 6. Tests Required

- `src/tests/unit/admin-ui-foundation.test.tsx`：验证 18 个后台路由的面包屑解析、`AdminModal` Portal / `Escape` 关闭、`AdminToastProvider` 与 `⌘K` 命令面板。
- `src/tests/unit/admin-core-operations.test.ts`：断言 `GET /api/admin/users/[id]` 的 `select` 不含 `passwordHash` / `keyHash`；断言 `POST /api/admin/works/batch-review` 支持图文+视频混合处理与 `skippedIds` 容错。
- `src/tests/unit/admin-diagnostics-and-tooling.test.ts`：断言 `GET /api/admin/generations/[id]` 的 `select` 不含 `providerApiKeyEncrypted` / `apiKeyEncrypted`；断言多维筛选与 `admin-generations-page.test.tsx` 默认查询同时成立。

---

## 7. Wrong vs Correct

#### Wrong

```tsx
// 1. 静态导入 AnimatePresence 破坏部分 mock 单测
import { AnimatePresence, motion } from "motion/react";

// 2. 无 select 全表返回导致加密密钥下发至前端
const job = await db.generationJob.findUnique({ where: { id } });
```

#### Correct

```tsx
// 1. 仅使用 motion.div 保证动效与部分 mock 单测兼容
import { motion } from "motion/react";

// 2. 显式白名单 select 物理隔离敏感哈希与加密密钥
const job = await db.generationJob.findUnique({
  where: { id },
  select: { id: true, status: true, errorCode: true, errorMessage: true /* ...allowlist */ },
});
```
