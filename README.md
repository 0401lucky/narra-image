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
