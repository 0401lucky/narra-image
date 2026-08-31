# 个人资料绑定 LinuxDo 账号

## Goal

个人设置页只有昵称/头像/邮箱，没有任何第三方账号绑定能力。新增 LinuxDo 账号绑定：绑定后可用 LinuxDo 直接登录该账号；当前账号若本就是 LinuxDo 注册（`oauthProvider = "linuxdo"`）则显示为已绑定。

## Requirements

- R1 个人设置（/settings）新增「账号绑定」卡片，展示 LinuxDo 绑定状态。
  - 未绑定：显示「绑定 LinuxDo」按钮，点击发起 OAuth 授权。
  - 已绑定：显示 LinuxDo 用户名（及头像可见时显示），提供「解绑」按钮（带确认弹窗，可纳入 MVP 或作为可选）。
- R2 后端新增以「已登录态」绑定 OAuth 的流程：
  - OAuth 回调时若检测到当前已登录会话 → 把 linuxdo 的 `oauthId` 绑定到当前用户，而不是创建新账号 / 登录其他账号。
  - 若该 LinuxDo 已被其他 narra 账号绑定 → 返回明确错误，不产生脏绑定。
  - 若当前账号已绑定该 LinuxDo → 幂等成功。
- R3 绑定成功后，该账号即获得 LinuxDo 登录能力（走现有第三方向登录路径）。
- R4 绑定流程复用现有 LinuxDo OAuth 的 state/CSRF 防护（`linuxdo_oauth_state` cookie）。

## Acceptance Criteria

- [ ] /settings 出现「账号绑定」卡片，正确区分未绑定 / 已绑定（含 LinuxDo 注册账号）。
- [ ] 未绑定用户：点击「绑定 LinuxDo」→ LinuxDo 授权 → 回调后绑定成功并显示 LinuxDo 身份；创建的账号数量不变（不新增用户）。
- [ ] 已登录用户的 OAuth 回调走绑定路径而非登录/创建新用户。
- [ ] 该 LinuxDo 已被其他账号绑定时返回明确错误，表中无重复绑定数据。
- [ ] 解绑（若实现）：确认后解除，LinuxDo 不再能登录该账号。
- [ ] 登录页 / 注册页 OAuth 流程不回归；`pnpm test` 全绿（新增/更新 linuxdo-oauth 与相关单测）。

## Notes

- 中复杂任务：需 `design.md` + `implement.md`。
- 核心设计取舍：OAuth 回调路由如何区分「未登录 → 创建/登录」与「已登录 → 绑定」两条路径。