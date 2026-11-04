# Narra Image

一个面向普通用户的高颜值生图网站。

> 在线站点：[narralucky.c0ffee.space](https://narralucky.c0ffee.space) ｜ 仓库：<https://github.com/0401lucky/narra-image> ｜ 协议：[AGPL-3.0](#开源协议)

核心特性：

- 首页生成器主导，作品流辅助
- 邮箱 + 密码 + 邀请码注册，支持公开邀请码领取页
- LinuxDo OAuth 第三方登录（后台可开关）
- Cloudflare Turnstile 人机验证（覆盖登录 / 注册 / 邀请码兑换）
- 每日签到积分激励，兑换码批量发放积分
- 内置渠道默认扣积分，默认 `5` 积分 / 次
- 新用户默认 `500` 积分
- 多渠道生图：内置渠道 + 用户自填 OpenAI 兼容渠道
- 支持根据 `Base URL + API Key` 拉取兼容渠道公开的模型列表
- 创作台支持 `gpt-image-2` 的 1K / 2K / 4K / 自定义尺寸、质量和输出格式参数
- 作品广场：用户提交、管理员审核、点赞精选
- 管理后台：用户、邀请码、兑换码、生成记录、福利、作品审核 + 系统设置（登录源 / 人机验证 / 生图渠道）
- 基于 `Next.js + Prisma + PostgreSQL`，支持 `Docker` 部署到 `Zeabur`
- 生图任务由独立 `Go Worker` 消费，Next.js 负责提交任务与页面/API
- Go 后端渐进迁移规划见 [`docs/go-backend-migration-plan.md`](docs/go-backend-migration-plan.md)

## 本地开发

1. 安装依赖

```bash
pnpm install
```

2. 复制环境变量

```bash
cp .env.example .env
```

3. 生成 Prisma Client

```bash
pnpm db:generate
```

4. 推送数据库结构

```bash
pnpm db:push
```

5. 初始化邀请码（先在 `.env` 显式设置 `BOOTSTRAP_INVITE_CODE`）

```bash
pnpm db:seed
```

6. 启动开发环境

```bash
pnpm dev
```

## 关键环境变量

发布关键变量以 `contracts/runtime/v1/environment.json` 为事实来源：

- 基础配置：`APP_URL`、`DATABASE_URL`、`AUTH_SECRET`。生产必须显式提供
  非 localhost/loopback 的 HTTP(S) `APP_URL`；`AUTH_SECRET` 至少 32 位且
  不能使用公开占位值。development/test 未设置 `APP_URL` 时默认使用
  `http://localhost:3000`。
- `DATABASE_URL` 必须由部署环境完整注入。用户名或密码包含
  `@ : # ? /` 等字符时必须百分号编码，不能在 Compose 中用
  `POSTGRES_*` 临时拼接。
- 内置渠道：`BUILTIN_PROVIDER_BASE_URL`、`BUILTIN_PROVIDER_API_KEY`、
  `BUILTIN_PROVIDER_MODEL`、`BUILTIN_PROVIDER_NAME`、
  `BUILTIN_PROVIDER_CREDIT_COST`、`BUILTIN_PROVIDER_VIDEO_MODEL`、
  `BUILTIN_PROVIDER_VIDEO_CREDIT_COST`。
- 存储：`S3_ENDPOINT`、`S3_REGION`、`S3_ACCESS_KEY_ID`、
  `S3_SECRET_ACCESS_KEY`、`S3_BUCKET`、`S3_PUBLIC_BASE_URL`、
  `ENABLE_LOCAL_IMAGE_FALLBACK`。
- 内容审核：`MODERATION_ENABLED`（总开关，默认关闭）、
  `MODERATION_SENSITIVE_WORDS_ENABLED`、`MODERATION_AI_ENABLED`、
  `MODERATION_BASE_URL`、`MODERATION_API_KEY`、`MODERATION_MODEL`、
  `MODERATION_THRESHOLD`。命中违规描述时拒绝生成并记录触发事件。
- 外部生成等待：`EXTERNAL_GENERATION_POLL_INTERVAL_MS`、
  `EXTERNAL_GENERATION_WAIT_TIMEOUT_SECONDS`。
- Go 生成网关：`GATEWAY_ENABLED` 默认关闭（关闭时 Next `/v1` 走 legacy 路径）；
  `GATEWAY_WAIT_TIMEOUT_SECONDS`、`GATEWAY_POLL_INTERVAL_MS`、
  `GATEWAY_SIGNATURE_SKEW_SECONDS` 控制 Go 内部网关的等待、轮询与签名时间窗。
- Worker 契约与拓扑：`WORKER_CONTRACTS_V1_ENABLED` 默认关闭；
  `ENABLE_EMBEDDED_WORKER` 决定 supervisor 是否派生 Worker；
  `WORKER_RUNTIME_MODE` 必须显式为 `embedded` 或 `dedicated`。
- Canvas v1：`CANVAS_ENABLED` 默认关闭，app/Worker 必须一致。
  `CANVAS_ASSET_GC_INTERVAL_SECONDS` 默认 60 秒（最少 60，最大 2147483647）；
  `CANVAS_ASSET_GC_BATCH_SIZE` 默认 20（1-100）。每个 Worker 只有一个
  可取消、随进程停止的 GC 调度器，数据库租约约束多副本领取。
  七天无根导入宽限期固定，不受这两个调度参数影响。
- 应用 readiness：`WORKER_INTERNAL_URL`、`WORKER_READINESS_REQUIRED`、
  `WORKER_READINESS_TIMEOUT_MS`。超时表示单次请求 Worker `/readyz`
  的上限，默认 2000ms、允许 100–30000ms。
- embedded supervisor：`WORKER_COMMAND`、`WORKER_READY_TIMEOUT_MS`、
  `WORKER_READY_POLL_INTERVAL_MS`、`DATABASE_READY_ATTEMPTS`、
  `DATABASE_READY_DELAY_MS`。
- Worker 运行：`WORKER_CONCURRENCY`、`WORKER_HTTP_ADDR`、
  `WORKER_POLL_INTERVAL_MS`、`WORKER_JOB_TIMEOUT_SECONDS`、
  `WORKER_MAX_ATTEMPTS`、`WORKER_MAX_ACTIVE_PER_USER`、
  `WORKER_RETRY_BASE_DELAY_MS`、`WORKER_SHUTDOWN_GRACE_SECONDS`、
  `WORKER_SHUTDOWN_HARD_TIMEOUT_SECONDS`、`WORKER_VIDEO_POLL_INTERVAL_MS`。
- 提示词同步：`PROMPT_SYNC_ENABLED` 默认关闭，显式开启后 Worker 定时同步；
  `PROMPT_SYNC_INTERVAL` 为同步间隔秒数（默认 86400，范围 60–604800）。
  手动 CLI `worker/cmd/prompt-sync` 与管理后台同步入口共用同一实现。
- 媒体回填：历史 data URL 图片/视频可用 `worker/cmd/backfill-media`
  转存对象存储（`--dry-run`/`--limit`/`--include-http`），幂等且仅在配置
  S3/R2 后执行。
- 观测：`WORKER_METRICS_WINDOW_MINUTES`、`WORKER_METRICS_TOKEN`、
  `LOG_LEVEL`。`WORKER_METRICS_TOKEN` 设置后至少 16 位。
- `NEXT_PUBLIC_IMAGE_OPTIMIZER_BYPASS_HOSTS` 是构建期变量；修改后必须
  重新构建 Next 镜像，不能只在运行中的容器里覆盖。
- `BOOTSTRAP_ADMIN_EMAIL`: 需要自动提权为管理员的邮箱。
- `BOOTSTRAP_INVITE_CODE`: 初始邀请码。

应用提供两个独立探针：

- `GET /api/healthz` 只表示 Next 进程可响应，不查询数据库或 Worker。
- `GET /api/readyz` 检查环境配置、数据库，并在
  `WORKER_READINESS_REQUIRED=true` 时检查 Worker `/readyz`。成功必须是
  HTTP 200 且 Worker JSON 中 `status` 为 `ready`；失败只向客户端返回稳定
  错误码，不暴露 DSN、SQL、上游正文或密钥。

`CANVAS_ENABLED=true` 时，Next 还会核验实际 Canvas schema 和自身存储能力，
并要求 Worker `/readyz` 的 `capabilities.canvas` 精确返回
`{"version":1,"schema":"ready","storage":"unversioned","gc":"running"}`；
即使 `WORKER_READINESS_REQUIRED=false`，旧版或关闭 Canvas 的 Worker 也不能
让应用就绪。Worker 在 schema/拓扑/存储通过后启动 GC，探针和每次领取前
重新检查能力；死亡的调度器、未知 schema 或存储均不能报告 Canvas 可用。

Canvas 导入必须配置 S3。普通 S3 通过 `GetBucketVersioning` 的原始响应验证无版本状态；
Cloudflare R2 未实现此接口，官方 HTTPS 账户端点（含 `eu`、`fedramp`、`us`）使用
带认证的 `HeadBucket`，仅确切 bucket 的 HTTP 200 且无版本相关响应头时通过。
自定义端点仍按普通 S3 检查；版本已启用、暂停、拒绝访问或未知结果均关闭导入/回收。
R2 探测不接受重定向。配置凭据或收到 403 本身不构成可用证明。GC 只删除
已登记 IMPORT 的原始位置和精确 key，保护已保存快照及所有已提交任务的输入根，
不删除生成作品或旧媒体。删除失败保留库存、物理占用和有界退避；UNKNOWN PUT
即使遇到缺失 key 也保留墓碑及占用以核对迟到写入。Worker `/metrics` 的 `canvas`
计数展示领取、失败、fence 失效及确认回收字节，不把远程失败计为已回收。

部署新镜像后，需在 app 与 Worker 的运行环境中显式设置 `CANVAS_ENABLED=true`，
embedded 部署需重新创建应用容器，内嵌 Worker 会继承同一开关；dedicated 部署需
重新创建应用与独立 Worker 容器。完整 readiness 通过后，创作页显示“对话 / 画布”
切换；管理员后台没有独立的画布开关。

发布顺序是 additive migration → app/Worker 关闭 Canvas → 隔离数据库/模拟存储及
双拓扑门禁 → 显式启用并验证。关闭开关可停止 Canvas 写入/GC；回滚仍须通过
现有 Worker rollback preflight，保留 schema、快照、引用、库存、任务和媒体。
默认关闭或构建成功不代表启用态验收通过，也不授权真实数据库/对象存储操作。

## 提示词库同步

提示词库前台与后台管理由 Next.js 提供，GitHub 提示词抓取也提供 Go 同步命令，适合部署侧一次性任务或定时任务使用：

```bash
pnpm prompt:sync
```

同步单个来源：

```bash
pnpm prompt:sync -- -source awesome-gpt-image
```

Docker 镜像内也包含 `/app/narra-prompt-sync`，可在容器环境里连接同一个 `DATABASE_URL` 执行。

## 测试与构建

```bash
pnpm test
pnpm lint
pnpm build
```

## Docker Compose 部署

生产发布、历史库接管、探针和回滚步骤见
[`docs/production-operations.md`](docs/production-operations.md)。

### 使用预构建镜像更新（推荐）

`main` 的 CI、migration 与 E2E 三项验证全部通过后，发布以下 Linux amd64 镜像：

- `ghcr.io/0401lucky/narra-image-app`：Next.js 与内置 Worker，兼容 Embedded/Zeabur。
- `ghcr.io/0401lucky/narra-image-worker`：独立 Go Worker，供 Dedicated Compose 使用。

Actions 的 `Publish verified images` 摘要提供同一提交的两份 digest 与
`sha-<完整提交号>` 标签。部署时设置配套的 `APP_IMAGE`、`WORKER_IMAGE`，使用
`docker-compose.yml` 加 `docker-compose.images.yml`（Compose v2.24.4+）；不需要在
服务器上编译。`latest` 只便于发现版本，两次拉取不是原子更新，部署应固定同一 SHA
或摘要中的 digest。首次发布可能需要仓库维护者将两个 GHCR 包设为 Public。

具体配置、备份、拉取、停服迁移、启动和回滚命令见
[预构建镜像更新](docs/production-operations.md#预构建镜像与后续更新)。发布镜像不会自动
更新任何生产服务器。

### 从源码构建

```bash
docker compose up --build -d
```

部署到 `Zeabur` 时，推荐提供：

- 一个 `PostgreSQL` 服务
- 应用服务使用仓库根目录的 `Dockerfile`
- 运行前配置好 `DATABASE_URL`、`AUTH_SECRET`、内置渠道相关环境变量
- 如果只部署一个应用服务，保持 `ENABLE_EMBEDDED_WORKER=true`，容器会同时启动 Next.js 和 Go Worker

如果你本地直接用 `docker compose`，默认会同时启动：

- `app`: Narra Image 应用
- `worker`: Go 生图 Worker，消费数据库中的待生成任务
- `db`: PostgreSQL 17

普通容器启动只执行 `prisma migrate deploy` 和只读校验。空库由完整 migration
历史创建；已有表但缺失迁移历史、或存在 failed migration 时会明确失败，不再
自动 `db push`、baseline、resolve 或 repair。需要接管历史库时，先按运维手册
执行只读 inspect，再经过备份、目标身份核对和明确审批执行 apply。
当前生产启动流程不会主动执行 `seed`，避免在低内存环境里因为 `tsx prisma/seed.ts` 触发额外内存峰值。
仅在显式配置 `BOOTSTRAP_INVITE_CODE` 时，注册接口才会创建初始邀请码；管理员引导邮箱同样必须使用有效邀请码注册。

## 关于模型拉取

- 现在支持通过 `Base URL + API Key` 调用 **OpenAI 兼容** 的 `/models` 来拉取模型列表。
- 这对 `OpenAI Images API` 和实现了 OpenAI compatibility 的部分 Gemini / 第三方网关可用。
- 如果某个渠道没有实现 `/models`，或者实现不完整，后台和创作页会提示你手动填写模型名。
- 拉取到的是“渠道公开模型列表”，不保证每一个都能生图；界面会把更像生图模型的 ID 优先排在前面。

## 系统设置

低频但关键的配置统一放在 `/admin/settings`：

- **登录源**：配置 LinuxDo 等第三方 OAuth 登录
- **人机验证**：Cloudflare Turnstile，可独立开关登录 / 注册 / 邀请码兑换 / 图像生成 4 个保护点。配置流程见后台页内提示，凭证申请：<https://developers.cloudflare.com/turnstile/get-started/>
- **生图渠道**：管理多个 OpenAI 兼容 API 渠道，启停、改 key、调价

## 开源协议

本项目采用 **GNU Affero General Public License v3.0** —— 详见 [LICENSE](./LICENSE)。

- ✅ 自由阅读、使用、修改、自部署、二次分发
- ✅ 学术研究、私人项目、内部使用都没问题
- ⚠️ **如果你修改并对外提供网络服务**（不只是分发源码），必须同样以 AGPL-3.0 开源你的修改
- ⚠️ 商用闭源 / SaaS 化部署需另行获取商业授权

需要商业授权或合作意向，请通过 [GitHub Issues](https://github.com/0401lucky/narra-image/issues) 联系。
