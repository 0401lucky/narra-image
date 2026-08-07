# 测试与验证编排审计补充

## 结论

验证命令必须由 Node 编排器统一执行并设置 55~58 秒全局截止时间；Vitest 的单测超时和 Go 的 `-timeout` 都不能约束整条命令。

## 必须实现的闸门

- 目标测试文件先用 `existsSync` 逐个预检；Vitest 即使列表包含不存在文件也可能退出 0，不能让缺文件假绿。
- TS 契约测试文件使用 `// @vitest-environment node`，数据库测试由 DB runner 设置强制 sentinel；缺数据库必须失败，不得 `describe.skip`。
- Windows 下通过 `%ComSpec% /d /s /c` 执行 pnpm，动态数据库 URL 只放环境变量；用 `taskkill /PID /T /F` 清理超时的子进程树。
- Go vet/test 串行运行；冷缓存可能超过 60 秒，wrapper 应预热/按剩余预算终止，不并行争用缓存。
- DB runner 先检查 Docker CLI、daemon、`postgres:17-alpine` 镜像和资源归属；任何缺失快速退出 2，不自动 pull、不读取 `.env`、不连接开发/生产库。
- 一次性容器使用随机名称、owner label、随机 URL-safe 密码、动态本地端口、无 named volume；清理前核验 label，归属异常退出 6。
- `prisma generate → validate → legacy snapshot/baseline → additive migrate → fixture seed → TS DB 断言 → Go DB 断言` 串行执行。
- 不调用现有 `prisma/seed.ts`；契约 fixture 由 runner 使用显式随机数据库连接写入。

## 现实边界

当前历史 Prisma migration 不能从真正空库完整构建基表；本子任务 runner 使用带 `_prisma_migrations` baseline 的 legacy snapshot，
只验证本任务 additive migration。空库、历史升级和失败 migration 由 `release-hardening` 负责。
