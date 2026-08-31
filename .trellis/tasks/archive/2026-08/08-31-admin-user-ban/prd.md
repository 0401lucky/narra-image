# 后台用户管理封禁功能

## Goal

后台用户管理目前只有积分调整、角色切换、删除用户，缺少「封禁」这一轻量处置手段。新增封禁/解封：封禁立即生效（含已登录用户），数据保留、可解封恢复。

## Requirements

- R1 数据模型：`User` 增加 `bannedAt DateTime?`（Additive migration），非空即封禁，记录封禁时间；解封置回 null。
- R2 后台 UI（/admin/users 的 `UserAdminCard`）：
  - 显示封禁状态徽章；
  - 提供「封禁 / 解封」操作按钮 + 确认弹窗（与现有删除确认交互一致）；
  - 禁止封禁自己（与现有角色/删除的 `id === admin.id` 防护一致）。
- R3 后端 API：封禁/解封端点（新增独立 route 或扩展现有 `[id]` route 的属组），带 `{ banned: boolean }`，校验目标存在、非本人、字段合法。
- R4 拦截点（封禁立即生效）：
  - 邮箱密码登录：封禁账号拒绝并返回明确错误（如「账号已被封禁」）。
  - LinuxDo OAuth 回调：已绑定封禁账号拒绝登录；新注册路径的封禁用户同样拒绝。
  - 已登录用户：`getCurrentUserRecord` / `requireCurrentUserRecord` 对封禁用户按未登录处理（401 / 跳登录），不必等待 token 过期。
- R5 解封后该用户恢复登录与全部使用。

## Acceptance Criteria

- [ ] 迁移可应用：`User.bannedAt` 字段存在；`pnpm verify:migrations` 通过。
- [ ] /admin/users 用户卡片显示封禁状态，可封禁/解封，无法封禁自己。
- [ ] 被封禁用户邮箱密码登录返回「账号已被封禁」类错误。
- [ ] 被封禁用户 LinuxDo 登录被拒。
- [ ] 已登录用户被后台封禁后，下一次受保护请求被拦截（等效登出）。
- [ ] 解封后登录与使用恢复正常。
- [ ] `pnpm lint`、`pnpm test` 通过。

## Notes

- 中复杂任务：需 `design.md` + `implement.md`。
- 封禁语义已与用户确认：立即生效（含已登录），数据保留、可解封。
- 拦截点依赖「每次请求都查库」的现状（`current-user.ts` 每次 `findUnique`），此路径必须保证封禁用户被识别。