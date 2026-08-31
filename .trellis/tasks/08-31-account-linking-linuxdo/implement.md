# 执行计划：个人资料绑定 LinuxDo 账号

## 前置

- 依赖子任务 01 已合入（`linuxdo-oauth` 域稳定），或并行开发注意避免同一文件冲突。

## 执行清单（有序）

1. **新增绑定/解绑库函数** `src/lib/auth/linuxdo-oauth.ts`
   - `linkLinuxDoAccount({ userId, ldUser })`：封禁检查、冲突检查、幂等、绑定 update。
   - `unlinkLinuxDoAccount(userId)`：纯 OAuth 账号防呆 + 置空字段。
   - 扩展 `LinuxDoUser`/select 不变；绑定 update 需 `bannedAt` 字段存在于查询（封禁任务字段合入后生效；若并行，先不依赖该字段，仅查询现有字段）。
2. **回调路由分流** `src/app/api/auth/oauth/linuxdo/callback/route.ts`
   - token 换取后 `readSession()` 判分支；绑定分支调 `linkLinuxDoAccount` 并 `redirect /settings?linked=linuxdo` 或 `?error=`。
   - 绑定失败原因转可读文案（conflict → 「该 LinuxDo 账号已绑定其他 Narra 账号」）。
3. **解绑 API** `src/app/api/me/oauth/linuxdo/unlink/route.ts`（POST，`requireCurrentUserRecord`）
4. **设置页接线**
   - `src/lib/server/current-user.ts`：`getCurrentUserRecord` select 增补 `oauthProvider`（若封禁字段依赖未就绪，仅增补现有字段）。
   - `src/app/settings/page.tsx`：读取 `searchParams`（`error`/`linked`），透传到 `ProfileForm`。
   - `src/components/settings/profile-form.tsx`：新增「账号绑定」卡片（未绑定按钮 / 已绑定展示 + 解绑确认弹窗 / 错误提示）。
5. **单元测试** `src/tests/unit/linuxdo-oauth.test.ts`
   - `linkLinuxDoAccount`：成功绑定、幂等、冲突、封禁拒绝（若字段可用）。
   - `unlinkLinuxDoAccount`：纯 OAuth 防呆、正常解绑。
6. **人工验证**（本地 `pnpm dev`）

## 验证命令

- `pnpm test`（含新增单测）
- `pnpm lint`
- `pnpm build`（类型 + 编译）
- 本地人工：登录 → /settings 绑定 LinuxDo → 授权回调回 /settings 显示已绑定 → 退出 → LinuxDo 登录直达 /create → 再解绑（确认弹窗）→ 验证纯 OAuth 账号防呆

## Review 门槛

- [ ] 绑定/解绑逻辑有单测且全绿
- [ ] 回调分流不回归登录/注册路径（现有 OAuth 单测通过）
- [ ] 冲突/防呆均有用户可见错误文案
- [ ] `pnpm lint && pnpm build` 通过

## 回滚点

- 纯应用层改动的单文件 revert：`linuxdo-oauth.ts`、`callback/route.ts`、`profile-form.tsx`、`settings/page.tsx`、`current-user.ts`、unlink route。