# Research: architecture-inventory

- Query: 盘点 Go 化迁移后的运行时、入口、部署拓扑与跨层任务链路，区分 Go、Next.js 与双轨部分。
- Scope: internal
- Date: 2026-08-07

## Findings

### 总体结论

当前是“Next.js 网关/产品层 + Go Worker 执行层 + PostgreSQL 队列”的混合架构，
不是 Go 后端替换 Next.js。迁移计划明确：第一阶段的生图执行已交给 Worker，
第二阶段的 OpenAI 兼容接口仍由 Next.js 鉴权、限流、解析和格式化；Go HTTP
Gateway 只是后续评估项（`docs/go-backend-migration-plan.md:3-9,23-34`）。

### Go / Next.js / 双轨清单

| 层 | 已确认职责与证据 |
| --- | --- |
| Go | `worker/cmd/worker/main.go:15-53` 启动 pgx Worker；`worker/internal/worker/worker.go:165-256` 用 `FOR UPDATE SKIP LOCKED` 领取 `workerManaged=true` 的任务并把 `PENDING→PROCESSING`；`worker.go:285-314` 分流图片/视频；`worker.go:465-617` 回写 `GenerationImage`/`GeneratedVideo` 与成功状态；`worker.go:626-783` 失败退款和过期清理；`generation.go:48-348`、`video.go:55-229` 调上游并持久化；`storage.go:74-149` 提供 S3/R2 与图片 data URL 兜底；`server.go:37-40,73-120` 暴露 `/healthz`、自定义 JSON `/metrics`。 |
| Next.js | 约 70 个 `src/app/**/route.ts` 仍承载页面/API、鉴权、积分和管理入口；`src/app/api/generate/route.ts:153-190` 创建任务并预扣积分；`scripts/start-prod.mjs:516-530` 负责数据库准备/迁移，`start-prod.mjs:237-239,539-554` 启动 Next；迁移计划把页面、管理后台、OAuth、Turnstile、邀请码列为暂不迁移（`docs/go-backend-migration-plan.md:56-60`）。 |
| 双轨 | 生产可选内嵌或独立 Worker：`start-prod.mjs:13-18,170-176` 默认可内嵌，`docker-compose.yml:20-54` 明确关闭内嵌并另起 `worker` 服务（`docker-compose.yml:56-91`）；Next 与 Go 通过共享 `GenerationJob` 表解耦。外部 `/v1` 仍由 Next 保持 OpenAI 响应契约，Go 只承接执行（`docs/go-backend-migration-plan.md:30-34`）；提示词同步另有 Go 命令入口（`worker/cmd/prompt-sync/main.go:17-72`），与 Next 管理入口形成双轨。 |

### 主要数据流

1. Next 接收请求、鉴权、校验、扣积分并写 `GenerationJob(status=PENDING,
   workerManaged=true)`；源图先上传，再把 URL 写入任务（`src/app/api/generate/route.ts:134-190`）。
2. Go Worker 原子认领任务，写入 `workerId`、租约、心跳和 `attemptCount`
   （`worker/internal/worker/worker.go:172-219,317-353`）。
3. Worker 在处理阶段按生成类型调用图片或视频上游，结果写入 S3/R2（无对象存储时
   图片可退回 data URL），再在同一数据库事务中写结果表并置为 `SUCCEEDED`
   （`generation.go:48-348`、`video.go:55-229`、`worker.go:465-617`）。
4. 上游/存储/回写失败时置 `FAILED` 并退还积分；锁租约过期由 Worker 扫描并退款
   （`worker.go:626-783`）。

### 构建与部署边界

- 根 `Dockerfile:1-27,40-60` 构建 Next 运行层，同时编译 `narra-worker` 和
  `narra-prompt-sync`；独立 `worker/Dockerfile:1-19` 只带 Go 二进制，不带 Prisma
  CLI 或迁移目录。
- Compose 的 app/worker 都只依赖数据库健康（`docker-compose.yml:26-28,62-64`），
  app 不等待 Worker 健康；单容器模式则由 `start-prod.mjs:189-234,539-547` 等待
  `/healthz` 后才启动 Next。
- Worker 启动只等待 `GenerationJob` 表存在（`worker.go:104-127`），而不是验证
  当前迁移版本、租约列、视频表或枚举完整性。

### 已确认的架构缺口（优先级建议）

1. **P0：入口所有权未统一。** `/v1` 仍是 Next 同步等待/格式化，Go 没有对外 Gateway；
   需要明确长期保留的 Next 边界，或设计可回滚的 Go Gateway 切换契约。
2. **P0：Worker 就绪没有纳入 app readiness。** Dedicated Compose 中 app 可在 Worker
   不健康时继续接收任务，可能产生长期 `PENDING`（`docker-compose.yml:20-91`）。
3. **P0：启动迁移会绕过真实 migration 执行。** 空库路径执行 `prisma db push` 后把全部
   迁移标记 applied（`start-prod.mjs:516-526`）；已有库还会在 schema diff 一致时
   `resolveAllMigrationsAsApplied`（`start-prod.mjs:466-472`），需独立、可回滚的迁移发布步骤。
4. **P1：schema gate 过弱。** Worker 只探测表名，关键列缺失时 `/healthz` 仍可能返回成功，
   滚动升级兼容性无法由健康检查保证（`worker.go:104-127`、`server.go:73-98`）。
5. **P1：重试契约漂移。** `MaxAttempts` 被读取（`config.go:25,68`）且领取时只递增
   `attemptCount`（`worker.go:187-192`），过期逻辑明确不自动重试（`worker.go:688-690`）；
   环境变量名称仍会误导运维。
6. **P1：可观测性接口未标准化。** `/metrics` 是未鉴权的自定义 JSON 查询（`server.go:101-188`），
   没有版本化 readiness、Prometheus exposition 或 provider request ID，难以接入统一告警。
7. **P1：提示词同步存在双入口。** Go 仅提供手动 `prompt-sync` 命令（`main.go:17-72`），
   迁移计划仍把管理后台留在 Next（`docs/go-backend-migration-plan.md:56-60`）；需选定单一调度/解析来源，
   防止两套 parser 漂移。

## Files found

- `docs/go-backend-migration-plan.md`：迁移阶段、边界、已落地能力和 Todo。
- `worker/cmd/worker/main.go`：Go Worker 进程入口与 pgx pool。
- `worker/cmd/prompt-sync/main.go`：Go 提示词同步命令入口。
- `worker/internal/worker/worker.go`：队列领取、状态流、心跳、结果回写、退款。
- `worker/internal/worker/generation.go`、`video.go`：图片/视频上游适配。
- `worker/internal/worker/storage.go`：对象存储及 fallback 策略。
- `worker/internal/worker/server.go`：健康检查和指标 HTTP 端点。
- `worker/internal/worker/config.go`：Worker 环境变量与默认值。
- `Dockerfile`、`worker/Dockerfile`：双阶段构建和独立镜像边界。
- `docker-compose.yml`：app、worker、db 三服务拓扑。
- `scripts/start-prod.mjs`：数据库准备、内嵌 Worker supervisor、Next 启动。
- `src/app/**/route.ts`：约 70 个 Next API 路由（`rg --files src/app -g route.ts` 计数）。

## Code patterns

- **共享数据库队列而非 RPC：** Next 写 `GenerationJob`，Go 以租约字段认领；成功/失败
  回写均带 `workerId` 条件（`worker.go:473-484,550-561,651-664`）。
- **两种进程拓扑：** 单容器由 Node supervisor 管理子进程；Compose dedicated 模式由
  Docker 分别重启 app/worker（`start-prod.mjs:119-176,539-562`、`docker-compose.yml:20-91`）。
- **手写 SQL 对 Prisma schema：** Go 直接引用带引号的 Prisma 表/列（`worker.go:175-218`），
  schema 变更必须同步 Go SQL 和启动 gate。

## Related specs

- `.trellis/spec/guides/cross-layer-thinking-guide.md`：要求沿 Source → Transform → Store →
  Retrieve 链路核对跨 API、数据库、Worker 的格式、验证、回滚和所有权契约。
- `docs/go-backend-migration-plan.md:23-54`：本审计采用的迁移目标和未完成项基线。

## External references

- 未使用外部网络资料；版本与拓扑证据均来自仓库文件。

## Caveats / Not Found

- 本文件是静态架构审计；未连接真实 PostgreSQL、上游 API、S3/R2 或生产编排环境，不能据此证明线上就绪/迁移成功。
- 本轮按任务要求只收敛到迁移计划、容器启动、Worker 源码和路由计数；功能逐接口差异、旧 TypeScript provider 实现和 CI 测试结果应由其他研究文件补充。
- 路由计数包含兼容/别名路径，不能直接等同于独立业务 API 数量。
