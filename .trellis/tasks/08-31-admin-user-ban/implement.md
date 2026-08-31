# 执行计划：后台用户封禁功能

## 执行清单（有序）

1. **数据库**
   - `prisma/schema.prisma`：`User` 增加 `bannedAt DateTime?`。
   - 新增 migration：`prisma/migrations/<ts>_add_user_ban/migration.sql`（Additive `ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3);`）。
2. **登录拦截** `src/app/api/auth/login/route.ts`
   - select 增补 `bannedAt`；`bannedAt` 非空 → `jsonError("账号已被封禁", 403)`（若为第三方账号路径已先兜底）。
3. **已登录拦截** `src/lib/server/current-user.ts`
   - `getCurrentUserRecord` select 增补 `bannedAt`；非空 → return `null`。
4. **OAuth 拦截** `src/lib/auth/linuxdo-oauth.ts` + `callback/route.ts`
   - `findOrCreateOAuthUser` 老用户两条分支 select 增 `bannedAt`，封禁 → `{ ok: false, reason: "banned" }`。
   - 扩展结果类型 `reason` 为 `"invite_required" | "invite_invalid" | "banned"`；回调路由对 `banned` 转「账号已被封禁」提示。
5. **管理端 API** `src/app/api/admin/users/[id]/ban/route.ts`（PATCH）
6. **管理端 UI**
   - `src/app/admin/users/page.tsx`：select/序列化增 `bannedAt`、`banned`。
   - `src/components/admin/user-admin-card.tsx`：封禁徽章 + 封禁/解封按钮 + 确认弹窗 + 禁止封禁自己。
7. **单元测试**
   - `linuxdo-oauth.test.ts`：老用户路径封禁返回 `banned`（更新 mock select 行）。
   - 参照现有测试是否为路由做单测；策略一致即可。
8. **人工验证**（`pnpm dev`）

## 验证命令

- `pnpm db:migrate`（本地应用迁移，确认 schema/sql 一致）
- `pnpm verify:migrations`（若本地 docker 可用）
- `pnpm test`、`pnpm lint`、`pnpm build`

## Review 门槛

- [ ] 迁移 Additive、可应用、`User.bannedAt` 存在
- [ ] 登录 / OAuth / 已登录三处拦截均生效且有明确文案
- [ ] 后台可封禁/解封、不可封禁自己、状态徽章正确
- [ ] lint + build 通过

## 回滚点

- 功能回滚：撤回 API/UI/拦截改动即可（登录/OAuth/已登录回到原行为）。
- DB 回滚：Additive 列不强制回退；若需回退在新 migration 里 `DROP COLUMN`。