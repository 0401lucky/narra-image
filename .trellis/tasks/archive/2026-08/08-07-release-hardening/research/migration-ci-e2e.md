# Migration、CI 与 E2E 审计

## 结论

当前生产启动把正常升级、历史库接管和失败迁移修复混在同一路径中；空库通过 `db push` 建表后再批量标记 migrations，无法证明迁移 SQL 可从零执行。仓库也没有统一 CI 或真正的一次性 E2E runner。实施时必须先把普通发布收敛为只执行 `migrate deploy`，再建立隔离的 baseline/repair 运维入口和可重复验证矩阵。

## 已确认事实

- 空 schema 会执行 `prisma db push`，随后把全部迁移标记为 applied（`scripts/start-prod.mjs:309-341,393-396,516-527`）。
- `migrate deploy` 遇到 P3005 时会自动 resolve 基线；若 schema diff 相同，还会自动把全部迁移标记为 applied（`scripts/start-prod.mjs:466-507`）。
- 启动脚本还包含针对单个历史失败迁移的手写 DDL 修复（`scripts/start-prod.mjs:399-464`）。这些行为会让普通启动拥有接管和修库权限。
- `package.json:7-20` 只有 lint/test/build 和 Worker 契约 wrapper，没有 `verify:ci`、`verify:migrations`、`verify:e2e`。
- 仓库没有 `.github/workflows`；`docker-compose.e2e.yml` 没有测试执行器，且使用持久化 volume 与 restart 策略。
- `vitest.config.ts:4-13` 没有统一超时；基线记录显示全量测试的两个创作台交互用例在默认 5 秒下超时，提高到 15 秒后通过。
- Worker 契约任务已经提供可复用的 57 秒进程树截止、固定目标校验、安全退出码和 disposable PostgreSQL runner（`scripts/verify-worker-contracts.mjs`；`08-07-worker-contracts/verification/2026-08-07-worker-contracts.md`）。

## 推荐迁移模型

1. 普通启动只允许：等待数据库 → `prisma migrate deploy` → schema/readiness 检查。禁止自动 `db push`、`migrate resolve` 和手写 repair。
2. 历史库接管使用显式 baseline 命令：先只读检查 schema、迁移表和 diff，生成报告；只有明确 sentinel/确认参数时才执行精确的 `migrate resolve --applied`。
3. 失败迁移使用显式 repair 命令：默认只报告 failed migration 和建议动作，不在普通启动中执行 DDL。
4. 所有自动化迁移测试只连接 runner 自建的随机 localhost PostgreSQL；拒绝 `.env`、开发库和生产库回退，也不自动下载镜像。

## 推荐验证入口

- `pnpm verify:ci`：类型检查、lint、稳定化 Vitest、Worker 契约 TS/Go、Go vet/build、Next 生产构建。单元测试命令的外层截止小于 60 秒，构建使用独立超时和日志。
- `pnpm verify:migrations`：覆盖空库执行完整 migrations、历史 schema 显式 baseline 后升级、故意失败 migration 保持失败且不会被普通启动自动 resolve。
- `pnpm verify:e2e`：覆盖 embedded/dedicated 启动、readyz、拓扑互斥、停止和恢复；使用随机资源与归属标签。

## 固定场景

- 空库：只运行 `migrate deploy`，全部 migration SQL 实际执行，最终 schema probe ready。
- 历史库：没有 `_prisma_migrations` 时普通启动明确失败；baseline dry-run 给出精确列表；显式 baseline 后 deploy 成功。
- 失败 migration：普通启动保持非零退出；不得自动改写 DDL 或标记 applied。
- 特殊字符：数据库用户名/密码含 `@:#?/` 时，Node、Prisma 与 Go 都连接同一随机数据库。
- 假绿防护：缺 Docker CLI/daemon、本地镜像、固定测试目标或安全 sentinel 时返回可区分的非零退出码。

## 范围边界

- 本任务不运行生产 migration，不接触真实 Zeabur 数据库，不删除 volume。
- 镜像 digest、非 root、只读根文件系统和完整供应链加固可在本任务保留兼容配置后另立任务，不阻塞本次迁移/就绪闭环。
