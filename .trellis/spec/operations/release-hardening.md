# 发布、迁移与可观测部署契约

## 1. 适用范围与触发条件

- 适用于 Zeabur embedded 与 dedicated Compose 两种拓扑的启动编排、Prisma 发布入口、app/Worker 探针、指标/日志暴露、环境变量单一契约，以及 CI/E2E 验证入口。
- 修改 `scripts/start-prod.mjs`、`scripts/migrate-deploy.mjs`、`scripts/migrations/**`、`scripts/verify-*.mjs`、Dockerfile、两个 Compose 文件、healthz/readyz 路由、runtime environment manifest 或 `.github/workflows/verify.yml` 时，必须先读本规范。
- 本规范不授权生产部署、连接真实库、删除 volume 或启用生产 contract v1。

## 2. 发布拓扑与启动顺序

- embedded（Zeabur 主路径）启动顺序：数据库可连接 → `migrate deploy` → Worker liveness 可达 → Worker ready → Next 启动。
- dedicated：一次性 migration 成功 → Worker ready → app ready；app 不得在无可用 Worker 时报告 ready。
- `ENABLE_EMBEDDED_WORKER` 决定 app 是否派生 Worker；Worker 运行模式 `embedded|dedicated` 由 `WORKER_RUNTIME_MODE` 显式声明。
- PostgreSQL advisory lock 互斥：embedded 持 exclusive、dedicated 持 shared；冲突以 `TOPOLOGY_CONFLICT` 非零退出，多个 dedicated Worker 合法。
- 锁连接丢失：立即撤销 ready、停止 claim、有界 drain 后非零退出；禁止同进程静默重获锁继续消费。
- SIGTERM：先令 readyz 失败、停止 claim，再按 grace drain；hard-stop 上限后强制终止，禁止无限等待。

## 3. Migration 安全契约

- 普通生产启动只执行 `prisma migrate deploy` + 只读状态检查；禁止自动 `db push`、`migrate resolve`、手写 DDL repair 或"全部标记已应用"。
- 空库必须通过完整 migration 历史建库。
- 已有表但缺历史的库只能走显式 `scripts/migrations/baseline.mjs`（默认 dry-run、连续前缀、digest 绑定）。
- failed migration 只能走显式 `scripts/migrations/repair.mjs`（allowlist + checksum 核对）。
- 缺失前置迁移走 `scripts/migrations/prehistory.mjs`；`20260423000000_initial_schema` 是 synthetic foundation，禁止修改已发布 migration SQL/checksum。
- 所有自动 migration 测试只用 runner 自建随机 localhost PostgreSQL（tmpfs、owner label、`--pull=never`），拒绝回退 `.env`/开发/生产库。

## 4. Health 与 Readiness 语义

- Worker `/healthz`：纯 liveness，不因 DB/schema 暂时不可用伪装进程崩溃。
- Worker `/readyz`：检查 DB 连接、`CheckSchemaContract`、拓扑锁、消费循环、draining；失败返回稳定错误码 + 503。
- Next `/api/healthz` 与 `/api/readyz` 分离；readyz 检查 DB、运行配置，生成能力启用时检查 Worker readyz。
- schema 缺失、DB 断连、Worker 崩溃、migration 失败、draining 一律不得返回 ready。
- 外部响应不得泄露 DSN/SQL/密钥/原始 DB 错误；详细原因进结构化日志。

## 5. 环境变量单一契约

- `contracts/runtime/v1/runtime-environment-contract.json` 是唯一事实源：定义 owner、允许读取路径、类型、默认值、生产约束、secret、build/runtime 属性。
- manifest 覆盖的变量必须由各自唯一 loader 读取（Node `src/lib/env.ts`、Go `worker/internal/worker/config.go`）；owner 外直接读 `process.env`/`os.Getenv` 会令静态审计失败。
- 生产 `AUTH_SECRET` 至少 32 位并拒绝公开占位值；生产 `APP_URL` 必须显式且非 loopback。
- Compose 注入完整且已编码的 `DATABASE_URL`，禁止 YAML 拼接连接串。

## 6. 指标、日志与安全

- `/metrics` 只在内网/令牌可见；embedded Worker HTTP 默认 loopback，dedicated Worker 端口仅容器网络可见（`expose`，不发布公网）。
- 指标保留 JSON 并带 `schema_version`；provider request ID、job ID、attempt、error code、duration 进结构化日志，不做高基数标签。
- Node/Go/supervisor 共用 redactor：DSN 密码/查询参数、Authorization/API Key、上游响应正文、媒体签名 URL 一律脱敏。

## 7. 验证入口

```powershell
pnpm verify:ci            # tsc + lint + vitest + worker 契约 + go + next build
pnpm verify:migrations    # 空库/baseline/prehistory/failed/pgx 场景
pnpm verify:e2e           # embedded/dedicated/冲突/schema/DB 断连/失败传播
pnpm verify:worker-contracts:db
docker compose config --quiet
docker compose -f docker-compose.e2e.yml config --quiet
```

- 每个单元测试进程约 57s 独立截止；全量 vitest 进程独立 300s（单用例 30s）；migration/DB runner 与 E2E 使用各自更长独立截止，禁止嵌套进 60s 父截止。
- GitHub Actions 只调用仓库内 wrapper（`.github/workflows/verify.yml`），不复制命令清单。
- E2E 资源随机命名、带 `com.narra.e2e.owner` label、PostgreSQL tmpfs；兜底清理 `down --volumes` 只作用于 owner 校验通过的 runner 自建资源。

## 8. 回滚安全

- 回滚代码前必须运行 `pnpm rollback:preflight`（调用 `CheckRollbackSafety`）；存在活动 contract v1 或未决 handoff 时不得启动旧 Worker/finalizer。
- 回滚保留 additive schema；平台探针在回滚后不得把 readiness 重新指向纯 liveness。
- 任何非 disposable 数据库 baseline/repair、volume 删除或生产配置变更需用户另行明确确认。
