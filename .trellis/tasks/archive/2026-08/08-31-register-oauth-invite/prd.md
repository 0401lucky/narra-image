# 注册页补充第三方登录与邀请码输入

## Goal

注册页当前完全没有第三方登录入口（`auth-form.tsx` 里 `hasOAuth` 被限制为 `mode === "login"`，且 `register/page.tsx` 没传 `oauthProviders`），导致用户找不到用 LinuxDo 注册的位置。补上与登录页一致的第三方登录入口。

## Requirements

- R1 注册页渲染启用的第三方登录提供商（LinuxDo），「或使用第三方登录」分隔线与按钮样式与登录页一致。
- R2 第三方登录按钮在注册模式下读取注册表单「邀请码」输入框的当前值，随 OAuth 授权链接传递；注册页已有邀请码输入框，因此不需要登录页那种折叠邀请码输入。
- R3 邀请码携带行为符合现有 OAuth 语义：新用户首次绑定必须消耗有效邀请码；已绑定 LinuxDo 的老用户直接登录、忽略邀请码。
- R4 保留现有注册表单（邮箱/邀请码/密码）与邀请码输入框，不影响普通邮箱注册流程。
- R5 文案与错误提示沿用现有 `linuxdo-oauth` 的约定（"首次使用 LinuxDo 登录需要填写邀请码" 等）。

## Acceptance Criteria

- [ ] 访问 /register 可见「或使用第三方登录」分隔线与 LinuxDo 按钮，视觉与登录页一致。
- [ ] 注册页填写邀请码后点击 LinuxDo 按钮，授权 URL / 回调链路携带该邀请码。
- [ ] 未登录 LinuxDo 新用户完整走通：授权 → 创建账号 → 消耗邀请码 → 进入 /create。
- [ ] 已绑定 LinuxDo 的用户在注册页第三方登录：直接登录，不消耗邀请码。
- [ ] 不填邀请码点击第三方按钮，新用户收到「首次使用 LinuxDo 登录需要填写邀请码」提示。
- [ ] 普通邮箱注册流程与邀请码校验行为不变。
- [ ] `pnpm lint`、`pnpm test`（含 auth-form 相关单测更新）通过。

## Notes

- 本源为轻量任务：改动集中在 `src/components/marketing/auth-form.tsx`、`src/app/register/page.tsx` 及单测。
- 实现细节（第三方按钮如何取到受控/非受控邀请码值）见设计说明。