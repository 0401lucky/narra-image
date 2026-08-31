# 认证体验补全：注册第三方登录/邀请码、账号绑定、用户封禁

## Goal

补齐三块认证体验：
1. 注册页缺少第三方登录入口，导致用户找不到用 LinuxDo 注册的位置。
2. 个人设置缺少第三方账号绑定能力。
3. 后台用户管理缺少封禁能力。

## Requirements

- R1 注册页展示与登录页一致的第三方登录（LinuxDo）入口，点击后携带注册表单中填写的邀请码发起授权；新用户首次绑定消耗邀请码，老用户直接登录。
- R2 个人设置页新增「账号绑定」区域：展示 LinuxDo 绑定状态；未绑定可发起绑定；已绑定可解绑；处理绑定冲突。
- R3 后台用户管理支持封禁/解封用户：封禁立即生效（含已登录用户被拦截登出），数据保留、可解封恢复。
- R4 被封禁用户无法通过邮箱密码登录，也无法通过 LinuxDo OAuth 登录。
- R5 不改变现有视觉体系（marketing auth-form / settings studio-card / admin 卡片风格保持一致）。

## Acceptance Criteria

- [ ] 子任务 01：注册页可见 LinuxDo 第三方登录并可完成注册（含邀请码校验），与登录页视觉一致。
- [ ] 子任务 02：个人设置可见绑定状态并完成绑定/解绑；绑定后可用 LinuxDo 登录；绑定冲突有明确报错。
- [ ] 子任务 03：后台可封禁/解封；被封禁用户登录被拒、已登录用户被登出；解封后恢复。
- [ ] 每个子任务通过 `pnpm lint`、`pnpm test`；数据库变更通过 `pnpm verify:migrations`。

## Notes

- 保持现有注释/命名风格（中文注释、`server-only`、用 `db.user.xxx` 直查）。
- 依赖顺序：子任务 02 依赖 01 所在的 `linuxdo-oauth` / OAuth 回调域（共享文件），建议 01 → 02 → 03；03 独立可并行。
- 数据库变更统一为 Additive 手工 migration.sql（参照 `prisma/migrations/20260807140000_generation_media_storage_meta`），同步更新 `prisma/schema.prisma`。