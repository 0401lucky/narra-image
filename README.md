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

5. 初始化邀请码

```bash
pnpm db:seed
```

6. 启动开发环境

```bash
pnpm dev
```

## 关键环境变量

- `DATABASE_URL`: PostgreSQL 连接串
- `AUTH_SECRET`: 会话签名与自填渠道加密密钥
- `BUILTIN_PROVIDER_BASE_URL`: 内置 OpenAI 兼容网关地址
- `BUILTIN_PROVIDER_API_KEY`: 内置渠道密钥
- `BUILTIN_PROVIDER_MODEL`: 内置渠道默认模型，默认推荐 `gpt-image-2`
- `BUILTIN_PROVIDER_CREDIT_COST`: 内置渠道每次消耗积分
- `S3_*`: 对象存储配置，可选
- `NEXT_PUBLIC_IMAGE_OPTIMIZER_BYPASS_HOSTS`: 不走 Next Image 优化的图片域名列表，适合自建 CDN 解析到内网/保留地址的情况
- `ENABLE_EMBEDDED_WORKER`: 让单个部署容器同时启动 Next.js 和 Go Worker，Zeabur 单服务部署时建议保持 `true`
- `WORKER_*`: Go 生图 Worker 的并发、轮询间隔、任务超时与最大重试配置
- `BOOTSTRAP_ADMIN_EMAIL`: 需要自动提权为管理员的邮箱
- `BOOTSTRAP_INVITE_CODE`: 初始邀请码

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

容器启动时会自动准备数据库：新空库会先创建当前 schema，旧库会接管迁移历史，然后应用仓库内的新增迁移。
当前生产启动流程不会主动执行 `seed`，避免在低内存环境里因为 `tsx prisma/seed.ts` 触发额外内存峰值。
初始邀请码会在注册接口里自动补入数据库，管理员邮箱也支持首次免邀请码注册。

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
