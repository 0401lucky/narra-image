# Narra Image

一个面向普通用户的高颜值生图网站。

核心特性：

- 首页生成器主导，作品流辅助
- 邮箱 + 密码 + 邀请码注册
- 内置渠道默认扣积分，默认 `5` 积分 / 次
- 新用户默认 `500` 积分
- 支持高级用户保存自填 OpenAI 兼容渠道
- 支持根据 `Base URL + API Key` 拉取兼容渠道公开的模型列表
- 创作台支持 `gpt-image-2` 的 1K / 2K / 4K / 自定义尺寸、质量和输出格式参数
- 管理后台可管理邀请码、用户积分、生成记录和首页精选
- 基于 `Next.js + Prisma + PostgreSQL`，支持 `Docker` 部署到 `Zeabur`

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
- `BOOTSTRAP_ADMIN_EMAIL`: 需要自动提权为管理员的邮箱
- `BOOTSTRAP_INVITE_CODE`: 初始邀请码

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

如果你本地直接用 `docker compose`，默认会同时启动：

- `app`: Narra Image 应用
- `db`: PostgreSQL 17

容器启动时会自动准备数据库：新空库会先创建当前 schema，旧库会接管迁移历史，然后应用仓库内的新增迁移。
当前生产启动流程不会主动执行 `seed`，避免在低内存环境里因为 `tsx prisma/seed.ts` 触发额外内存峰值。
初始邀请码会在注册接口里自动补入数据库，管理员邮箱也支持首次免邀请码注册。

## 关于模型拉取

- 现在支持通过 `Base URL + API Key` 调用 **OpenAI 兼容** 的 `/models` 来拉取模型列表。
- 这对 `OpenAI Images API` 和实现了 OpenAI compatibility 的部分 Gemini / 第三方网关可用。
- 如果某个渠道没有实现 `/models`，或者实现不完整，后台和创作页会提示你手动填写模型名。
- 拉取到的是“渠道公开模型列表”，不保证每一个都能生图；界面会把更像生图模型的 ID 优先排在前面。
