# 设计：后台审核记录与配置

## 边界 / 范围

- 复用 `moderation-engine` 的 `ContentReview` / `ModerationConfig` 与 repository。
- 提供：审核记录浏览与过滤、用户触发聚合 + 一键封禁入口、审核配置管理、词库只读展示。
- 不含：词库在线编辑（MVP 只读；后续可加）、自动封禁（已确认不自动封禁）。

## 页面与路由

### `/admin/moderation`（记录 + 用户聚合）
- 顶部「高风险用户」区：聚合 `ContentReview` 按用户计数（≥1 次），显示 邮箱/昵称、触发次数、最近触发、封禁状态；操作：一键封禁 / 解封（调 `PATCH /api/admin/users/[id]/ban`，排除当前管理员、禁用本人的防护同后端）。
- 下方「审核记录」流：时间倒序分页，每条显示 kind 徽章（敏感词 / AI）、prompt 截断、命中词或 AI 分数、用户；`kind` 过滤（全部/敏感词/AI）。
- 复用 `AdminPagination`、`studio-card` 视觉。

### `/admin/settings/moderation`（配置）
- 表单：整体启用、敏感词开关、AI 开关、`aiBaseUrl`、`aiApiKey`（留空表示不改）、`aiModel`、`aiThreshold`（0–1）。
- 保存 → `PATCH /api/admin/moderation/config`；`aiConfigured` 状态展示（不返回明文 key）。
- 「内置词库」只读折叠区：按类别展示词与计数（来自 `/api/admin/moderation/words`）。

### 导航
- `admin-nav` 增加「内容审核」（/admin/moderation）；settings 增加「内容审核」（/admin/settings/moderation）。

## 后端 API

```
GET  /api/admin/moderation/reviews?page&kind&q
  → { page, pageSize, totalPages, totalCount,
      reviews: [{ id, kind, prompt, hitWords, category, aiScore, aiModel, createdAt,
                  user: { id, email, nickname, banned } }] }
GET  /api/admin/moderation/summary
  → { users: [{ userId, email, nickname, banned, count, lastTriggerAt }] }  // count desc, limit 50
GET  /api/admin/moderation/config        → engine config serialize（无明文 key）
PATCH /api/admin/moderation/config       → 更新配置（key 留空不改），复用 engine updateModerationConfig
GET  /api/admin/moderation/words         → { categories: [{ category, words, count }] }
```

- 全部 `requireAdminRecord`；错误 `jsonError`、成功 `jsonOk`。
- 审核记录查询 join user（`include` 或二次 in 查询）；用户聚合用 `contentReview.groupBy({ by: ["userId"], _count: true, _max: { createdAt: true } })` + user in 查询。

## 契约

- 客户端组件参考 `admin/oauth-provider-manager.tsx` / `admin/turnstile` 的设置表单模式。
- 一键封禁按钮参考 `admin/user-admin-card.tsx` 的 ban 交互（确认弹窗），复用现有 ban API。

## 上线 / 回滚

- 无新增 DB 表（复用 engine 两表）；纯管理 UI + API。
- 回滚：移除导航入口与路由；不影响引擎拦截行为。