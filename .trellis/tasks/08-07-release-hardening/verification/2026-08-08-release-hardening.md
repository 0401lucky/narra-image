# release-hardening 验证记录

> 日期：2026-08-08 · 分支：main · 执行者：0401lucky（pi）
> 范围：仓库内自动验证；未部署生产、未连接真实库、未删除任何非 disposable 资源。

## 1. 验证矩阵总览

| 命令 | 退出码 | 结果 | 说明 |
|------|--------|------|------|
| `pnpm verify:ci` | 0 | 通过 | 9 个 stage 全部 exit 0 |
| `pnpm verify:migrations` | 0 | 通过 | 空库/baseline/prehistory/failed/pgx 场景 |
| `pnpm verify:e2e` | 0 | 通过 | 6 个拓扑/故障场景 + owner 校验清理 |
| `pnpm verify:worker-contracts:db` | 0 | 通过 | disposable PostgreSQL TS+Go 契约（49.7s） |
| `docker compose config --quiet` | 0 | 通过 | 注入必需变量后校验 |
| `docker compose -f docker-compose.e2e.yml config --quiet` | 0 | 通过 | 同上 |
| `git diff --check` | 0 | 通过 | 无空白错误（仅 LF/CRLF 提示） |

## 2. verify:ci 分阶段耗时与退出码

执行：`node scripts/verify-ci.mjs`（GitHub Actions 调用同一 wrapper，不复制命令清单）。

| Stage | duration_ms | exit_code |
|-------|------------|-----------|
| 发布脚本 Node 单测（node --test） | 1114 | 0 |
| TypeScript 类型检查（tsc --noEmit） | 10190 | 0 |
| ESLint | 35518 | 0 |
| Vitest 全量单测（testTimeout=30s，排除 DB 集成） | 118400 | 0 |
| Worker TypeScript 契约 | 13548 | 0 |
| Worker Go 契约（vet + test） | 15189 | 0 |
| Go 全量测试 | 7750 | 0 |
| Go 全量构建 | 5485 | 0 |
| Next.js 生产构建 | 111550 | 0 |

说明：
- 全量 vitest 进程独立截止 300s（单用例 30s），DB 集成测试由 `verify:worker-contracts:db` 单独覆盖；未嵌套 57s runner。
- 单元测试进程（node --test、go test、worker-contracts 契约）均在各自主截止内给出明确结果。

## 3. verify:migrations 场景矩阵

执行：`node scripts/verify-migrations.mjs`（disposable PostgreSQL，tmpfs 数据目录，owner label 校验清理）。

| 场景 | 断言 | 结果 |
|------|------|------|
| 空库完整迁移 | `migrate deploy` 按完整历史建库，`_prisma_migrations` 计数=14 | 通过 |
| 无历史 legacy baseline | 普通 deploy 必须失败；inspect 生成 digest 报告；显式 apply 后 deploy 成功 | 通过 |
| 缺失 pre-history | 普通 deploy 不得静默补记；inspect/apply 后 deploy 成功 | 通过 |
| 故意失败 migration | 普通 deploy 必须失败且不改写 failed 历史 | 通过 |
| 特殊字符 DATABASE_URL | Go rollback preflight 可解析连接 | 通过 |

清理：`docker container rm --force --volumes` 按 owner label 校验执行；验证后无归属容器/卷残留。

## 4. verify:e2e 场景矩阵

执行：`node scripts/verify-e2e.mjs`。实际构建根镜像（Dockerfile）与独立 Worker 镜像（worker/Dockerfile）并验证两个 Compose 文件；本次复用已构建镜像（`E2E_SKIP_BUILD=1`，镜像为仓库最新代码构建）。

| 场景 | 断言 | 结果 |
|------|------|------|
| embedded | compose up + readyz 200、拓扑锁事件、SIGTERM 优雅退出（exit 0） | 通过 |
| dedicated | app/Worker readyz、2 Worker 副本可运行、无冲突事件 | 通过 |
| 拓扑冲突 | 第二 embedded 非零退出且日志含冲突证据，原实例保持 ready | 通过 |
| schema 缺失/恢复 | 清空 schema 后 app/Worker not_ready，重跑 migrate 后恢复 ready | 通过 |
| DB 断连/恢复 | 停 DB 后 app not_ready、Worker 非零退出，恢复后重建 ready | 通过 |
| 失败传播 | migration 失败 → supervisor 非零退出、日志可诊断 | 通过 |

资源安全：
- 每个场景独立随机 project 名（`narra-e2e-<label>-<hex>`），owner label `com.narra.e2e.owner`。
- PostgreSQL 数据目录 tmpfs；无命名/匿名持久卷；`restart: "no"`。
- 兜底清理 `down --volumes --remove-orphans --rmi local`，并对残留容器按 owner 校验后强删、删除残留网络。
- 验证后 `docker ps`/`docker network ls` 均无 `narra-e2e` 残留（容器 0、网络 0）。

## 5. verify:worker-contracts:db

执行：`node scripts/verify-worker-contracts.mjs db`。prisma migrate（含 contract v1 additive migration）+ TS disposable DB 断言（5 用例）+ Go disposable DB 断言，总耗时 49.7s，退出码 0。

## 6. 过程中修复的回归

- `admin-generations-page.test.tsx`：期望 `where` 未包含 contract v1 FAILED 协调分支与 `AND` 包装（`generation-contracts` 任务引入、测试未同步），已对齐实现。
- `generation-bubble.tsx`：渲染期读取 `sawPendingRef.current`（react-hooks 规则 error），改为 `useState` 惰性捕获。
- `eslint.config.mjs`：新增 `.pi/**` ignore（本地工具目录）。
- `Dockerfile` builder env：`APP_URL=localhost` 触发生产校验（拒绝 loopback），改用 `https://narra-build.invalid` 与随机 AUTH_SECRET；本地以相同 env 复现并验证 `pnpm build` 通过。
- `verify-ci.mjs`：全量 vitest 进程 57s 截止不足（实际 ~118s），独立截止 300s + 单用例 30s；排除 DB 集成测试。
- `postgres-runner.ts`：DB/migration runner 全局截止 55s 在本机偶发不足，调至 150s（R4 允许 DB runner 更长独立截止）。
- `generator-studio-feedback.test.tsx`：高负载下"发送"按钮 disabled 竞态（type 后未等 state flush 即点击），加 waitFor 按钮启用 + 文件级 60s 超时。

## 7. 未覆盖外部证据（按 prd 记录，不阻塞仓库内交付）

- 真实 Zeabur 部署、多副本平台探针、监控采集：需用户授权后补证据。
- 真实历史库 baseline/repair：需用户显式确认（本任务未连接任何非 disposable 数据库）。
