# 设计：后台用户封禁功能

## 边界 / 范围

- 封禁语义（已与用户确认）：立即生效（含已登录用户被拦截登出）、数据保留、可解封恢复。
- 只做永久封禁 + 手动解封，不做封禁时长/到期自动解封（MVP）。
- 封禁是「软处置」，与「删除用户」并存；封禁不删除任何数据。
- 不改 Go Worker / gateway 侧（用户认证由 Next 把关，见 memory #14；网关信任 envelope）。

## 数据模型

`prisma/schema.prisma` 的 `User` 增加：

```prisma
bannedAt DateTime?
```

Additive migration（`prisma/migrations/YYYYMMDDHHMMSS_add_user_ban/migration.sql`）：

```sql
-- Additive: 用户封禁时间戳（可空；非空即封禁，解封置回 NULL）
ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3);
```

## 契约

### 管理端封禁/解封 API

```
PATCH /api/admin/users/[id]/ban   body: { banned: boolean }
  403 无管理员权限（requireAdminRecord）
  400 id === 本人（不能封禁自己）
  404 用户不存在
  400 参数非法
  200 { user: { id, banned: boolean } }
  实现：bannedAt = banned ? new Date() : null
```

### 拦截矩阵

| 入口 | 实现 | 行为 |
|---|---|---|
| 邮箱密码登录（`api/auth/login`） | select 增 `bannedAt`；非空则 `jsonError("账号已被封禁", 403)` | 拒绝登录 |
| LinuxDo 老用户登录（`findOrCreateOAuthUser`） | 两条老用户分支 select 增 `bannedAt`，封禁则返回 `reason: "banned"`；回调路由转提示 `?error=账号已被封禁` | 拒绝登录 |
| 已登录用户任意受保护请求 | `getCurrentUserRecord` select 增 `bannedAt`；非空 → return `null`（视为未登录） | 该请求被视为未登录（401/redirect /login） |
| LinuxDo 绑定路径（子任务 02） | `linkLinuxDoAccount` 查询含 `bannedAt`，封禁 → `reason: "banned"` | 拒绝绑定 |

- `getCurrentUserRecord` 返回 null 的连锁效果：`requireCurrentUserRecord`/`requireAdminRecord` 直接抛「请先登录」；各页面 redirect /login。JWT 仍在 cookie 但每次请求查库判定，等效登出，无需等 14 天过期；也不主动清 cookie（保持简单）。

### 管理端 UI

- `admin/users/page.tsx`：查询 select 增 `bannedAt`；`serializedUsers` 输出 `banned: boolean`、`bannedAt: string | null`。
- `UserAdminCard`：新增封禁状态徽章（rose 配色「已封禁」）+「封禁 / 解封」按钮 + 确认弹窗（复用删除确认交互骨架）；`id === admin.id` 时不渲染操作按钮。
- 封禁中用户的「设为管理员」等操作仍可用（封禁与角色解耦，MVP 从简）。

## 数据流

```
管理员点击封禁 → 确认弹窗 → PATCH /api/admin/users/{id}/ban { banned: true }
  → db.user.update({ bannedAt: new Date() }) → router.refresh() → 卡片显示「已封禁」
被封禁用户：
  - 未登录：登录/OAuth 被拒，看到「账号已被封禁」
  - 已登录：下一次任何请求 getCurrentUserRecord 返回 null → 等效登出
解封：PATCH .../ban { banned: false } → bannedAt = null → 用户恢复登录
```

## 权衡 / 兼容性

- **用 `bannedAt` 而非 enum `status`**：与现有可空列风格一致（mediaStorage 等），Additive 迁移不动历史行；future 需求（封禁原因/时长）可再加列。
- **拦截集中在 `current-user.ts` 与 `login`/`linuxdo-oauth`**：所有受保护 API 已统一走 `requireCurrentUserRecord`/`getCurrentUserRecord`（已 grep 确认），单点拦截覆盖全站；这是「立即生效」的关键前提。
- **不反向触发会话清除**：只读判定，避免在 `cache()`/server 上下文中动 cookie 的副作用；功能上等效登出。
- **不禁止后台对封禁用户改积分/角色**：管理动作不受影响，简化实现。

## 上线 / 回滚

- DB：Additive migration 可安全应用，历史行 `bannedAt = NULL`（未封禁）。
- 回滚：先下线 API/UI/拦截，再考虑迁移回退（或保留列）；功能回滚为零风险。