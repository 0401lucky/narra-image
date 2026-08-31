# 设计：个人资料绑定 LinuxDo 账号

## 边界 / 范围

- 只做 LinuxDo（`oauthProvider = "linuxdo"`）绑定与解绑，不引入多 provider 抽象。
- 不修改 LinuxDo OAuth 的启动路由（`api/auth/oauth/linuxdo/route.ts`）——state/CSRF/邀请码 cookie 逻辑已完备，绑定场景直接复用同一授权 URL。
- 修改 OAuth 回调路由（`callback/route.ts`），按「是否有已登录会话」分流绑定 vs 登录/注册。

## 契约

### 回调路由分流（`api/auth/oauth/linuxdo/callback/route.ts`）

```
GET /api/auth/oauth/linuxdo/callback?code&state
  ├─ 校验 state / 换取 token / fetch 用户（不变）
  ├─ 存在会话（readSession 非空）→ 绑定分支：linkLinuxDoAccount(userId, ldUser)
  │    ├─ 成功 → redirect /settings?linked=linuxdo
  │    └─ 失败 → redirect /settings?error=<code>
  └─ 无会话 → 现有登录/注册分支（findOrCreateOAuthUser）不变
```

### 新库函数 `linkLinuxDoAccount`（放 `src/lib/auth/linuxdo-oauth.ts`）

```ts
type LinkLinuxDoResult =
  | { ok: true }
  | { ok: false; reason: "conflict" | "banned" };

async function linkLinuxDoAccount(input: {
  userId: string;
  ldUser: LinuxDoUser;
}): Promise<LinkLinuxDoResult>
```

- `oauthId = String(ldUser.id)`。
- 目标用户查询（含 `bannedAt`）：若已封禁 → `reason: "banned"`。
- 冲突检查：`user.findFirst({ where: { oauthProvider: "linuxdo", oauthId }, select: { id } })`。
  - 命中且 `id === userId` → 幂等 `{ ok: true }`。
  - 命中且 `id !== userId` → `reason: "conflict"`（不产生脏绑定）。
- 未冲突：`user.update({ where: { id: userId }, data: { oauthProvider: "linuxdo", oauthId, 补充 nickname/avatarUrl(仅空时) } })` → `{ ok: true }`。

### 解绑 `unlinkLinuxDoAccount(userId)`

- 防呆：若目标用户 `passwordHash` 为空（纯 OAuth 注册、无其他登录方式）→ 禁止解绑，返回错误「该账号仅通过 LinuxDo 登录，无法解绑」。
- 允许：`user.update({ data: { oauthProvider: null, oauthId: null } })`。
- 契约：`POST /api/me/oauth/linuxdo/unlink` → `{ ok, error? }`。

### 设置页数据流

- `settings/page.tsx`：`getCurrentUserRecord` 增加 `oauthProvider` 查询字段（复用现有 select 机制），将绑定状态传入 `ProfileForm`。
- `ProfileForm` 新增「账号绑定」卡片：
  - `oauthProvider === "linuxdo"` → 已绑定，显示 LinuxDo 标识 + 解绑按钮（确认弹窗）。
  - 否则 → 「绑定 LinuxDo」按钮，超链接到 `/api/auth/oauth/linuxdo`（工具尚未启用时置灰/隐藏）。
  - 解析 `?error=` 与 `?linked=` query（需在 `settings/page.tsx` 读取 searchParams 传入）。

## 数据流

```
settings 绑定按钮
  └─ /api/auth/oauth/linuxdo  → LinuxDo 授权页
      └─ callback（已有会话）→ linkLinuxDoAccount → /settings?linked=linuxdo
settings 解绑按钮
  └─ POST /api/me/oauth/linuxdo/unlink → 防呆校验 → 置空 OAuth 字段 → 刷新
绑定成功后：LinuxDo 登录走现有 findOrCreateOAuthUser 老用户路径（已有 oauthId 命中）。
```

## 权衡 / 兼容性

- **分流依据用会话而非额外 cookie**：登录页与设置页共用同一授权 URL，避免引入 `intent` 状态 cookie；已登录用户从任何页面发起都走绑定，符合直觉。风险：用户已登录但误在设置页点「绑定」时直接绑定（本意即如此）。
- **解绑防呆**：不校验会造出「无法登录」的孤儿账号；校验后纯 OAuth 账号不能解绑（提示即防线）。
- **不扩展 `findOrCreateOAuthUser`**：绑定路径是独立新函数，老路径（登录/注册）行为零变化，降低回归面。

## 上线 / 回滚

- 无数据库变更；纯应用层。
- 回滚：撤销 callback 分流改动与 lib 函数即可，老用户不受影响（绑定是增量能力）。