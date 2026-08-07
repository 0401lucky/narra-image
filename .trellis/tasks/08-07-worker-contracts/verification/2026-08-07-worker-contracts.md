# Worker Contracts 验证记录

验证日期：2026-08-07  
基线：`main@6e29a91` 加当前工作区改动  
环境：Windows、Docker Desktop、本地已有 `postgres:16-alpine`

## 结果

- `pnpm exec tsc --noEmit`：通过。
- `pnpm verify:worker-contracts:ts`：通过，固定 5 文件、27 项。
- 扩展 Vitest：通过，7 文件、31 项。
- `pnpm verify:worker-contracts:go`：通过。
- `go -C worker vet ./...`：通过。
- `go -C worker test -count=1 -timeout=50s ./internal/worker/...`：通过。
- `go -C worker build ./...`：通过。
- `pnpm verify:worker-contracts:db`：通过。
- Disposable DB TypeScript 断言：5/5 通过。
- Disposable DB Go 断言：5/5 通过。
- `git diff --check`：通过。

## Disposable PostgreSQL 边界

- 未下载 `postgres:17-alpine`；使用 Docker 中已有的 `postgres:16-alpine`。
- 通过 `WORKER_CONTRACTS_POSTGRES_IMAGE=postgres:16-alpine` 显式覆盖，runner 默认仍为 `postgres:17-alpine`。
- `WORKER_CONTRACTS_TMPDIR=D:\tmp`，没有在 C 盘保留 runner 临时文件。
- runner 使用随机容器名、随机数据库名、动态 localhost 端口、owner label、`--pull=never` 和无 named volume 容器。
- additive migration `20260807130000_generation_worker_contract_v1` 从 legacy snapshot 成功部署。
- 验证结束后容器和 D 盘临时目录均已清理。

## 调试记录

1. 首次运行发现 Prisma 7 在隔离 cwd 下无法加载 `prisma.config.ts`，migration 因缺少 datasource URL 失败。
2. runner 改为在项目根目录运行 Prisma 命令，并预先注入 disposable `DATABASE_URL`；本地 `.env` 不能覆盖该值。
3. 第二次运行发现 pgx 不接受 Prisma URL 的 `schema=public` 参数；Go DB 测试改为复用 `normalizeDatabaseURL`。
4. 第三次运行完整通过；没有连接开发或生产数据库。

## 未覆盖范围

- 未运行生产 migration、生产数据库、真实上游渠道、S3/R2 或 Zeabur 验证。
- 未启用生产 `WORKER_CONTRACTS_V1_ENABLED`。
- 未删除旧 Node 生成器或修改公开 Go 网关。
