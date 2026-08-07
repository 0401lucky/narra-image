# 生成 Worker 跨层契约

## 1. 适用范围与触发条件

- 适用于 `GenerationJob`、`GenerationAttempt`、Node 入队/取消/退款、Go Worker claim/handoff/写回以及 disposable PostgreSQL 验证。
- 修改任务状态、错误码、模型分流、渠道快照、attempt、退款或 migration 时，必须先更新 `contracts/generation/v1/`，再让 Node 与 Go 共同消费同一 fixtures。
- 本规范不授权生产迁移、生产启用 v1、删除旧 Node 生成器或人工退款。

## 2. 签名

### 数据库

- `GenerationJob.contractVersion: Int`：默认 `0`，表示 legacy。
- `GenerationJob.handoffState: GenerationHandoffState?`：legacy 可空；v1 必须非空。
- `GenerationJob.errorCode/nextAttemptAt/refundAppliedAt/cancelRequestedAt`：可空审计字段。
- `GenerationAttempt(jobId, ordinal)`：联合唯一；ordinal 必须等于 claim 后的 `attemptCount`。
- v1 成功写回必须在一个事务内完成：媒体写入、attempt `SUCCEEDED`、job `SUCCEEDED + RESOLVED`。

### 命令

```powershell
pnpm verify:worker-contracts:ts
pnpm verify:worker-contracts:go
pnpm verify:worker-contracts:db
```

每个 wrapper 的全局截止时间必须小于 60 秒，并保留真实退出码。

## 3. 契约

### 运行时环境变量

- `WORKER_CONTRACTS_V1_ENABLED`：默认关闭；只有 disposable 环境或完成发布隔离后才能开启。
- `WORKER_MAX_ATTEMPTS`：限制总 attempt 数，不能只作为配置占位。
- `WORKER_MAX_ACTIVE_PER_USER`：限制单用户活动任务数。
- `WORKER_SHUTDOWN_GRACE_SECONDS`：先停止 claim，再在 grace 内 drain。

### 数据库验证环境变量

- `WORKER_CONTRACTS_POSTGRES_IMAGE`：可选；默认 `postgres:17-alpine`。runner 必须先 `docker image inspect`，并使用 `--pull=never`。
- `WORKER_CONTRACTS_TMPDIR`：可选；指定 runner 自建临时目录的父级。清理时只能删除该父级下、`narra-worker-contracts-prisma-` 前缀的目录。
- `WORKER_CONTRACTS_REQUIRE_DB=1`：DB 测试强制 sentinel，缺失时必须失败，不能 skip。
- `DATABASE_URL/TEST_DATABASE_URL`：只能由 runner 构造为随机名称的 `127.0.0.1` disposable 数据库；禁止回退 `.env`、开发库或生产库。

Prisma 7 命令必须从项目根目录运行以加载 `prisma.config.ts`。runner 应预先注入 disposable `DATABASE_URL`，因此本地 `.env` 不能覆盖连接目标。Go/pgx 消费 Prisma URL 前必须复用 `normalizeDatabaseURL`，把 `schema` 转换为 `search_path`。

## 4. 校验与错误矩阵

- 显式渠道不存在 -> `CHANNEL_NOT_FOUND`，禁止 fallback。
- 显式渠道停用 -> `CHANNEL_INACTIVE`，禁止 fallback。
- 模型不属于渠道快照 -> `MODEL_NOT_SUPPORTED_BY_CHANNEL`，禁止上游调用。
- 密钥无法解密 -> `CHANNEL_SECRET_DECRYPT_FAILED`，提交前终结并按条件退款。
- `NOT_STARTED` 的安全失败且未耗尽 -> `PENDING + nextAttemptAt`，不退款。
- `SUBMITTING/SUBMITTED` 后无法确定结果 -> `FAILED + UNKNOWN + HANDOFF_UNKNOWN`，不重试、不退款。
- 重试耗尽且未 handoff -> 最终失败，并通过 `refundAppliedAt IS NULL` CAS 最多退款一次。
- 缺表、列、枚举、默认值或唯一约束 -> schema probe 不 ready，Worker 不得开始消费。
- DB runner 缺 CLI、daemon、本地镜像或安全目标 -> 退出 `2`，不得自动 pull 或连接其他数据库。

## 5. Good / Base / Bad

- Good：v1 claim、`attemptCount + 1` 和 attempt insert 同事务；成功写回同时校验 worker lease、ordinal 与 `SUBMITTED`。
- Base：legacy job 保持 `contractVersion=0/handoffState=NULL`，新 Worker 走兼容路径。
- Bad：把历史任务默认升级为 v1，或在显式渠道失效后切到其他渠道。
- Bad：对 `HANDOFF_UNKNOWN` 执行普通清理、退款或硬删除 attempts。
- Bad：为通过本地验证自动下载镜像、读取 `.env` 数据库或在宽泛临时目录执行递归删除。

## 6. 必需测试

- Node/Go conformance：同一 fixtures 的状态转换、错误分类、模型分流、媒体字段和密钥解密结果一致。
- Node 单测：入队渠道校验、取消三阶段、等待超时、管理员清理和退款 CAS。
- Go 单测：claim 原子性、handoff、有限重试、租约过期、公平性、停止与成功写回 ordinal。
- Disposable PostgreSQL：legacy snapshot -> additive migration；schema/trigger、attempt 唯一、UNKNOWN 不退款、重复退款、stale ordinal 不写媒体。
- 最终门禁：`tsc --noEmit`、三个 verify wrapper、`go build ./...`、`git diff --check`。

## 7. 错误与正确示例

### 错误

```typescript
// 不得静默下载镜像或回退开发数据库。
docker run postgres:17-alpine;
const databaseUrl = process.env.DATABASE_URL;
```

```go
// Prisma 的 schema 参数会被 pgx 当成服务端配置。
pool, _ := pgxpool.New(ctx, os.Getenv("TEST_DATABASE_URL"))
```

### 正确

```typescript
const image = process.env.WORKER_CONTRACTS_POSTGRES_IMAGE || "postgres:17-alpine";
// 先 inspect 本地镜像；docker run 必须带 --pull=never。
```

```go
databaseURL := normalizeDatabaseURL(os.Getenv("TEST_DATABASE_URL"))
pool, err := pgxpool.New(ctx, databaseURL)
```
