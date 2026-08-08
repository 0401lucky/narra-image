# Research: operations-gaps

- Query: 审计 Go 化后的构建、部署、运行与数据链路，重点检查容器/Compose、CI、启动脚本、环境变量、依赖、迁移、静态资源、队列、日志监控与测试入口，并识别旧运行时依赖、独立部署缺口、安全和回滚风险。
- Scope: internal / mixed
- Date: 2026-08-07

## Findings

### 1. 当前运行拓扑

项目目前是“Next.js 主应用 + PostgreSQL + Go Worker”的混合架构，并不是 Go 直接对外提供完整后端：

```text
浏览器 / OpenAI 兼容客户端
        │
        ▼
Next.js 16（70 个 route.ts，鉴权、计费、页面、管理后台、API、轮询）
        │  Prisma/pg 写入 GenerationJob
        ▼
PostgreSQL 17 ── GenerationJob 行队列（PENDING → PROCESSING → 终态）
        ▲                              │
        │                              ▼
        └──────────── Go Worker（pgx，渠道调用、心跳、退款、落库）
                                       │
                                       ▼
                            S3/R2、data URL 或上游视频 URL
```

- Next.js 路由、Node 依赖和 Prisma 仍是主运行时。`package.json:7-20,22-59` 保留 Next、Prisma、`pg`、`tsx`；`README.md:21-23` 也明确页面/API 仍由 Next.js 提供。
- 根镜像先构建 Next.js，再构建 Go 二进制，并把完整 `node_modules`、Prisma schema/migrations 和启动脚本带入运行层（`Dockerfile:1-27,29-38,40-60`）。因此即使生成执行已移到 Go，生产容器仍依赖 Node/Prisma 运行时。
- 独立 Worker 入口读取环境、建立 pgx pool 后运行消费循环（`worker/cmd/worker/main.go:15-52`）；主循环启动 HTTP 端点和 `WORKER_CONCURRENCY` 个消费协程（`worker/internal/worker/worker.go:60-101`）。
- Compose 的三服务拓扑是 `db`、`app`、`worker`（`docker-compose.yml:1-94`）；单容器模式由 `scripts/start-prod.mjs` 作为父进程先迁移数据库，再启动内嵌 Worker，最后启动 Next（`scripts/start-prod.mjs:170-239,516-562`）。

队列与数据链路的关键边界如下：

- API 先在事务中创建任务并扣积分，源图持久化成功后才把 `workerManaged` 置为 `true`（`src/lib/generation/external-api.ts:178-257`）。随后 Node 轮询同一行直到成功、失败或超时（`src/lib/generation/external-api.ts:116-157,259-271`）。
- Worker 用 `FOR UPDATE SKIP LOCKED` 原子领取最早的 `PENDING` 任务并写入租约字段（`worker/internal/worker/worker.go:165-256`），每个任务由 `JobTimeout` context 和心跳续租（`worker/internal/worker/worker.go:259-276,317-353`）。
- 进程重启后没有外部队列恢复器；只有仍有 Worker 运行时，循环开头才会扫描过期 `PROCESSING` 任务并退款（`worker/internal/worker/worker.go:130-155,681-727`）。

### 2. Go 化后仍保留的旧运行时和重复实现

1. **Next.js/Prisma 仍是不可省略的生产依赖。**
   - 所有页面、鉴权、OAuth、Turnstile、管理 API 和外部兼容 API 仍在 `src/app`；当前仓库共有 70 个 `route.ts`，没有 Go HTTP Gateway。
   - 生产启动调用 `prisma migrate`、`prisma db push`、`prisma migrate diff`（`scripts/start-prod.mjs:91-116,373-391,491-530`），所以根镜像必须携带 Prisma CLI、Node `pg` 和迁移目录（`Dockerfile:45-56`）。独立 `worker/Dockerfile` 只复制 Go 二进制（`worker/Dockerfile:1-19`），不能独立完成 schema 初始化或升级。
   - 迁移规划也明确“页面、管理后台、OAuth/Turnstile 暂不迁移”（`docs/go-backend-migration-plan.md:30-34,56-60`）；目前应按混合系统运营，而不能按“Go 服务已取代 Node”理解。

2. **提示词同步存在两套运行时实现且没有调度器。**
   - 管理后台按钮直接调用 Node `syncPromptSource`/`syncAllPromptSources`（`src/app/api/admin/prompt-sources/sync/route.ts:1-27`，实现位于 `src/lib/prompts/service.ts`）。
   - Go 版本只是手动命令 `pnpm prompt:sync`（`package.json:20`、`worker/cmd/prompt-sync/main.go:17-72`），并作为二进制复制进镜像（`Dockerfile:37-38,55-56`）。
   - Node 和 Go 各自维护默认来源和解析器（`src/lib/prompts/source-config.ts:1-74`、`worker/internal/worker/prompts.go:60-115`）；没有 cron、systemd、Cloud Scheduler 或 Compose 定时服务。两套解析逻辑会漂移，容器部署也不会自动同步提示词。

3. **Worker 配置与实际行为不一致。**
   - `MaxAttempts` 被读取到配置（`worker/internal/worker/config.go:24-27,63-71`），但消费失败直接 `FAILED`/退款，过期清理明确“不再依赖 attemptCount 自动重试”（`worker/internal/worker/worker.go:285-315,688-690`）。`WORKER_MAX_ATTEMPTS` 因而是误导性的死配置；迁移规划仍把“更清晰的重试策略”列为 TODO（`docs/go-backend-migration-plan.md:23-28`）。
   - Go 只要求 `AUTH_SECRET` 至少 10 位（`worker/internal/worker/config.go:45-47`），Node 生产环境要求至少 32 位（`src/lib/env.ts:46-50`）。独立 Worker 可能对同一份不合规密钥报告健康，而 app 拒绝启动，形成跨运行时策略不一致。
   - `DATABASE_READY_ATTEMPTS`、`DATABASE_READY_DELAY_MS`、`WORKER_COMMAND`、`WORKER_READY_TIMEOUT_MS` 只在启动脚本中存在（`scripts/start-prod.mjs:11-18`），未列入 `.env.example` 或 README；现场调优和故障排查缺少配置契约。

### 3. 构建、部署与拓扑缺口

1. **没有 CI 或统一验证入口。**
   - 仓库没有 `.github`/其他 CI workflow（检索结果为 `NO_GITHUB_DIR`），`package.json` 只有 `pnpm test`、lint、build，未提供 `go test`、`go vet`、Go build 或 Compose smoke 命令（`package.json:7-20`）。README 的交付检查也只有 Node 命令（`README.md:94-100`）。
   - Worker 虽有 6 个 Go 测试文件，但 `/healthz`、`/metrics` 没有测试文件；检索 `handleHealth|handleMetrics|collectMetrics` 未找到 `*_test.go`。
   - `docker-compose.e2e.yml` 只有 db/app/worker 三个服务，没有测试执行器、断言或报告收集（`docker-compose.e2e.yml:1-98`），且 `restart: unless-stopped` 和持久化 `postgres_e2e_data`（`docker-compose.e2e.yml:5,29,65,12-13,97-98`）使测试环境非一次性、非 hermetic。

2. **E2E 不会验证迁移 SQL。**
   - 空库启动走 `prisma db push`，随后把所有迁移标记为 applied（`scripts/start-prod.mjs:516-527`）；只有已有表的库才走 `migrate deploy`（`scripts/start-prod.mjs:528-530`）。因此默认的 E2E 空库路径跳过所有 migration.sql 的真实执行。
   - Git 历史已出现同类事故：`f6c2445` 的提交说明明确“之前视频开发用 db push 未生成迁移文件，生产 migrate deploy 不会同步视频 schema”；`3943e88`、`e382aa4`、`6b78019`、`e6e1e3a`、`4d05c5c` 也分别为 build/start、数据库等待、失败迁移恢复和 Prisma 命令问题增加补丁。这说明迁移链需要单独的升级测试，而不能只依赖启动自愈。

3. **独立 app/worker 没有就绪联动。**
   - Compose 中 app 只依赖数据库健康（`docker-compose.yml:20-34`），显式关闭内嵌 Worker（`docker-compose.yml:46-49`）；worker 也只依赖数据库并单独健康检查（`docker-compose.yml:56-91`）。app 不等待 worker 健康，Worker 崩溃时仍会接受新任务，任务可长期停在 `PENDING`。
   - 单容器模式则相反，父脚本会等待 `/healthz` 成功后才启动 Next（`scripts/start-prod.mjs:539-554`）。`.env.example` 默认 `ENABLE_EMBEDDED_WORKER=true`（`.env.example:44-51`），Compose 又强制 false，若自定义部署同时挂独立 worker 和根镜像而忘记覆盖，会意外启动两组消费者。
   - Worker 在 schema 等待期间不会启动 HTTP 服务（`worker/internal/worker/worker.go:60-127`），平台若只依赖 8081 健康端点，迁移阶段没有可区分的“正在迁移”状态。

4. **镜像可复现性和运行安全基线不足。**
   - 基础镜像使用可变 tag：`node:24-alpine`、`golang:1.25-alpine`、`alpine:3.22`（`Dockerfile:1,29,40`；`worker/Dockerfile:1,12`），未锁 digest；根镜像和 Worker 镜像都没有 `USER`、镜像级 `HEALTHCHECK` 或资源/能力限制（`Dockerfile:40-60`、`worker/Dockerfile:12-19`）。Compose 也没有 `user`、`cap_drop`、`read_only`、CPU/内存、日志轮转或 graceful stop 配置（仅有 `restart` 和部分 healthcheck，`docker-compose.yml:1-94`）。
   - 根运行层复制完整 `node_modules`（包含开发依赖和 Prisma CLI，`Dockerfile:45-56`），构建并运行两个 Go 二进制；Compose 还会再次单独编译 Worker，构建时间、镜像体积和供应链面均被放大。
   - PostgreSQL 密码直接拼接进 `DATABASE_URL`（`docker-compose.yml:32,66`；E2E 同样如此），未 URL 编码。密码包含 `@`、`#`、`?`、`/` 等字符时，Node 与 Go 的 URL 解析可能失败；应在部署检查中覆盖特殊字符。

5. **媒体持久化策略没有统一的生产保证。**
   - 图片没有 S3 时会把完整 base64 放入 `GenerationImage.url` 的 data URL（`src/lib/storage/persist-generated-image.ts:118-158`；Go 侧同样为 `worker/internal/worker/storage.go:74-105`），这会把大对象塞进 PostgreSQL，S3 故障时可能造成数据库膨胀和 API 响应变大。
   - 视频有 S3 时才下载并转存；无 S3 时直接保存上游返回的公开 URL（`worker/internal/worker/video.go:207-229`）。这不是本地持久化：上游 URL 过期、撤销或需要鉴权时，历史视频会失效。Compose 只有 PostgreSQL volume，没有媒体 volume（`docker-compose.yml:12-13,93-94`）。
   - S3 已配置但未提供 `S3_PUBLIC_BASE_URL` 时，代码回退为 endpoint/bucket 拼接 URL（`worker/internal/worker/storage.go:94-98,143-149`；Node `src/lib/storage/persist-generated-image.ts:146-150`），该地址未必可被浏览器公开访问；部署必须验证 CDN/签名/代理策略。
   - 静态 `public/` 资源被烘焙进镜像（`Dockerfile:45-47`），没有独立 CDN/版本化缓存策略。更隐蔽的是 `NEXT_PUBLIC_IMAGE_OPTIMIZER_BYPASS_HOSTS` 在客户端代码中读取（`src/lib/image-url.ts:13-27`），属于 Next build-time 变量；Docker build 阶段只注入 DB/Auth/Provider 占位变量（`Dockerfile:21-27`），`.dockerignore` 又排除了 `.env`（`.dockerignore:1-4`），Compose app 运行时也没有传入该变量（`docker-compose.yml:29-52`）。因此在容器部署中运行时修改该变量不保证生效，自建 CDN/内网解析域名可能仍被 Next Image 代理拒绝。
   - 该配置还与 Worker 的源图安全策略存在跨层差异：Node 允许把自建 CDN URL 写入任务，Go 源图下载器强制解析到公网地址（`worker/internal/worker/storage.go:185-193,321-386`）；图生视频则把同一 URL 直接作为 `input_reference` 交给上游（`worker/internal/worker/video.go:90-96`）。若部署的 S3/CDN 只在内网可达，前台可显示但 Worker 的图生图/图生视频链路会失败，需用真实 DNS/网络做回归。

### 4. 数据库迁移、队列和回滚风险

1. **启动自愈逻辑权限过大，且没有备份/回滚工具。**
   - 空库直接 `db push` 后“全部 resolve”，已有库在 schema diff 一致时也会“把所有迁移标记为 applied”（`scripts/start-prod.mjs:466-472,516-529`）。这能接管历史 Zeabur 数据库，但也会掩盖迁移文件缺失、错误顺序或未实际执行的 DDL。
   - 失败迁移只对一个硬编码版本做手写 DDL 修复（`scripts/start-prod.mjs:7-10,399-464`）；其他失败迁移只打印不可恢复并退出。没有 `pg_dump`/`pg_restore`、备份快照、down migration 或发布前回滚脚本（检索未找到）。历史 migration 包含真正的删列操作（`prisma/migrations/20260427090000_likes_redeem_codes_multi_sources/migration.sql:1-12`），旧二进制/旧 schema 不能假设可逆。
   - 多副本启动都执行同一段 migration/reconcile；虽然 Prisma deploy 有锁，空库 `db push` + resolve 和自定义 repair 仍需在并发发布、半完成迁移和回滚场景做演练。

2. **Go 侧 schema 检查不是兼容性检查。**
   - Worker 只检查 `GenerationJob` 表是否存在（`worker/internal/worker/worker.go:104-127`），没有验证 `workerManaged`、租约列、视频表/枚举或当前 migration 版本。
   - `/healthz` 只执行 `pool.Ping`（`worker/internal/worker/server.go:74-98`），即使关键列缺失、消费 SQL 持续失败，也可能返回 200；`/metrics` 同样是直接 SQL 查询，不是 schema/version gate（`server.go:101-120`）。滚动发布时旧 Worker、新 schema 或反向组合可能被错误判为健康。
   - Go 直接写带引号的 Prisma 表/列（`worker/internal/worker/worker.go:175-218,465-613`），每次 Prisma schema 改动都要求同步 SQL；没有共享生成代码或兼容性契约。
   - 渠道密钥由 Node 用 WebCrypto AES-GCM 加密（`src/lib/providers/provider-secret.ts:21-44`），Go 自己实现相同格式解密（`worker/internal/worker/secret.go:12-41`）。现有 Node 测试只做 Node→Node round-trip（`src/tests/unit/provider-secret.test.ts:6-20`），Go 测试则在 Go 内部自行构造密文（`worker/internal/worker/secret_test.go:11-35`），没有跨语言固定 fixture；AUTH_SECRET、IV/tag 编码或 TextEncoder 差异会在生产中表现为所有渠道任务失败并退款。

3. **队列没有真正的优先级、用户限流和可靠重试。**
   - 当前领取只按 `createdAt` FIFO（`worker/internal/worker/worker.go:175-183`），无优先级或按用户配额；迁移规划仍将这两项列为后续 TODO（`docs/go-backend-migration-plan.md:23-28`）。一个用户或突发 API 流量可占满固定并发槽。
   - 进程收到 SIGTERM 时 context 取消并等待协程退出（`worker/cmd/worker/main.go:26-27`、`worker/internal/worker/worker.go:99-101`）；没有 drain/租约转移。正在上游处理的任务会在后续 Worker 扫描到超时后才退款，期间可能长时间显示 `PROCESSING`。
   - 每个外部 API 请求最多等待 900 秒（`src/lib/generation/external-api.ts:88-93,151-155`）。平台请求超时小于该值时，客户端会先收到 timeout，但任务仍在后台继续；必须验证轮询端点、退款和重复提交行为。

4. **数据库连接和大对象资源没有运行上限契约。**
   - Go pool 上限设为 `Concurrency + 2`（`worker/cmd/worker/main.go:29-35`），Node `pg.Pool` 未显式配置池大小（`prisma/create-prisma-client.ts:10-21`）；多副本叠加时可能耗尽 PostgreSQL 连接。
   - Worker 单任务可读入最多 128 MB 视频（`worker/internal/worker/video.go:15,250-274`），默认并发 2，且 Compose 没有内存限制；应验证低内存实例的 OOM、重启和退款链路。

### 5. 日志、监控与安全暴露

- Worker 只有固定 INFO 级别的 `slog.NewTextHandler`（`worker/cmd/worker/main.go:15-18`），没有 `LOG_LEVEL`、JSON/trace ID、日志轮转或集中收集配置。日志虽带 `jobId/userId`（`worker/internal/worker/worker.go:259-261`），但没有 provider request ID；迁移规划把“记录 provider 请求 ID”列为未完成项（`docs/go-backend-migration-plan.md:46-49`）。
- `/metrics` 是未鉴权的自定义 JSON（`worker/internal/worker/server.go:37-45,101-120`），不是 Prometheus exposition，也没有 exporter、scraper、告警或管理后台接入；默认 `WORKER_HTTP_ADDR=:8081` 绑定所有接口（`worker/internal/worker/config.go:63-71`）。Compose 未发布 8081，但独立平台若照搬端口会暴露队列数量、Worker ID 和错误信息。
- 项目没有 Next.js app 健康/就绪 route（检索 `src/app` 未找到 health/ready/live/metrics），Compose app 也没有 healthcheck；平台只能依赖端口存活，无法区别“迁移完成但 Worker 不可用”或“Node 请求层健康但队列堆积”。
- 应用和 Worker 都以容器默认用户运行；没有只读根文件系统、丢弃 Linux capabilities、网络策略或 S3 最小权限说明。应将 `/healthz`、`/metrics` 限制为内网/loopback，并单独保护指标数据。

### 6. 建议的验证与补全顺序

**P0（发布前必须补）**

1. 固化两种拓扑的单一开关：embedded 或 dedicated 必须显式选择；为 dedicated 模式增加 app/worker readiness 联动、队列无消费者告警和重复 Worker 检测。
2. 把 Prisma migration 改成受控的一次性发布步骤（或独立 migration image/job），生产禁止无条件 `db push`/“全量 resolve”；先做 PostgreSQL 快照，再演练升级、失败恢复、旧版本回滚。
3. 增加 CI：`pnpm lint`、`pnpm test`、`pnpm build`、`cd worker && go vet ./... && go test ./... && go build ./...`，以及两种 Docker build 和 `docker compose config`。
4. 增加真实迁移测试矩阵：空库必须走 migration deploy；从每个历史基线升级到当前 schema；故意制造 failed migration、半完成 DDL、并发启动并验证不丢数据。
5. 生成并校验环境变量契约：补齐 `WORKER_VIDEO_POLL_INTERVAL_MS`、`BUILTIN_PROVIDER_VIDEO_CREDIT_COST`、`BUILTIN_PROVIDER_VIDEO_MODEL` 及启动重试参数；明确 `NEXT_PUBLIC_*` 必须在 Docker build 注入；启动时统一校验 32 位 `AUTH_SECRET`、S3 配置和 URL 编码后的数据库连接串。
6. 加一个跨运行时密钥兼容回归：用 Node 生成的 AES-GCM fixture 由 Go 解密、再反向验证；同时覆盖不同 schema/列版本下 Worker 的启动拒绝，而不是只验证表存在。

**P1（稳定性/可观测性）**

1. 明确视频媒体策略：生产强制 S3/R2 或可验证的长期签名 URL；图片不要把大 base64 长期写入 PostgreSQL；加入 S3 故障、上游 URL 过期和 CDN 不可达测试。
2. 用显式错误分类实现有限重试（网络/429 可重试，参数/鉴权不可重试），移除或重新定义 `WORKER_MAX_ATTEMPTS`；增加可独立运行的 stale-job sweeper 和优雅 drain。
3. 统一 Node/Go 提示词同步实现，选一个调度入口并记录同步版本/来源；为失败同步设置告警。
4. 给 app 和 worker 加版本化 `/readyz`、指标鉴权/内网绑定、Prometheus/日志导出、provider request ID 和队列/失败率告警；为指标查询做大表压测。
5. 镜像锁 digest、非 root、资源/日志限制，并加入容器停止、OOM、数据库断连、S3 断连和上游超时的回归场景。

## Files Found

- `Dockerfile`：Next.js/Go 双阶段构建及混合运行层。
- `worker/Dockerfile`：独立 Go Worker/提示词同步镜像，不含 Prisma/schema。
- `docker-compose.yml`：生产式本地三服务拓扑、环境变量和 Worker healthcheck。
- `docker-compose.e2e.yml`：E2E 数据库/app/worker 容器，但无测试执行器。
- `scripts/start-prod.mjs`：数据库等待、迁移部署/修复、内嵌 Worker/Next supervisor。
- `package.json`、`pnpm-workspace.yaml`：Node 脚本、依赖、pnpm 构建许可。
- `.env.example`、`README.md`：部署变量和人工部署说明。
- `prisma/schema.prisma`、`prisma.config.ts`、`prisma/migrations/*`：Prisma schema、迁移目录和数据关系。
- `prisma/create-prisma-client.ts`：Node 侧 pg pool/Prisma adapter。
- `worker/cmd/worker/main.go`、`worker/internal/worker/config.go`：Worker 启动和环境读取。
- `worker/internal/worker/worker.go`：DB 队列领取、心跳、处理、退款、过期清理。
- `worker/internal/worker/server.go`：`/healthz`、自定义 JSON `/metrics`。
- `worker/internal/worker/storage.go`、`video.go`：S3/data URL/上游视频 URL 存储策略。
- `worker/cmd/prompt-sync/main.go`、`worker/internal/worker/prompts.go`：Go 手动提示词同步。
- `src/app/api/admin/prompt-sources/sync/route.ts`、`src/lib/prompts/*`：Node 管理后台同步实现。
- `src/lib/generation/external-api.ts`：API 任务创建、扣费、交给 Worker、轮询等待。
- `src/lib/storage/persist-generated-image.ts`：Node 图片 S3/data URL 持久化。
- `docs/go-backend-migration-plan.md`：迁移边界、已完成项和未完成 TODO。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：要求在 API/服务/数据库/运行时边界定义契约并验证往返数据。
- 未发现 `.github/workflows`、Zeabur/其他平台部署 manifest、备份/恢复脚本或独立 cron 配置。

## Related specs

- `.trellis/spec/guides/cross-layer-thinking-guide.md:19-49,105-123`：本审计按 Source → Transform → Store → Retrieve 链路核对，并特别检查 API/数据库/Worker 边界的格式、验证和回滚。
- `docs/go-backend-migration-plan.md:11-21,23-54`：作为目标状态和未迁移范围的内部设计依据；其中队列限流、重试、存储服务化、实时推送、provider request ID 仍列为后续工作。

## External references

- 本次未依赖外部网络资料；版本证据来自仓库声明：Next.js `16.2.4`、Prisma `7.7.0`、pnpm `10.32.1`（`package.json:6,25-36,55`），Go module `go 1.24`（`worker/go.mod:1-4`），构建/运行镜像分别使用 Node 24、Go 1.25、PostgreSQL 17 Alpine（`Dockerfile:1,29`、`docker-compose.yml:3`）。

## Caveats / Not Found

- 未连接真实 PostgreSQL、S3、上游模型或 Zeabur 环境；因此没有声称线上迁移、健康检查或 URL 兼容性已经通过，只列出静态代码证据和应执行的验证。
- 未运行会写入 `.next`、Docker layer 或测试缓存的构建命令，以遵守研究代理只写当前 `research/` 目录的限制。
- `.env`、运行日志和未跟踪的本地平台配置未作为证据读取；实际部署可能在平台侧补充环境变量、健康检查或 CI，但仓库内没有可审计定义。
- `worker/internal/worker/storage.go:130-149` 的 `PersistVideo` 在无 S3 时不会被调用，当前视频路径会保留上游公开 URL；风险是持久性/可访问性不保证，而不是必然立即失败。
