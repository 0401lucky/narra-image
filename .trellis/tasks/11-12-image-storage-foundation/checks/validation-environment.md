# 图片存储验证环境

复用并复制此前已审阅的 `isolation_base.py` 与未修改的 `deny_env.cjs`，采用独立 owner kind 和本任务 `.runtime`。只更换源码捕获范围、工具链与调度入口；原有复制依赖/链接审计、dotenv 文件保护、源哈希、真实退出/截止、进程清理和最终绝对路径检查保留。

Node 固定为 24.22.1，Go 使用官方校验过 SHA256 的 1.25 稳定版本，pnpm10.32.1 复用既有安装并复制到每个验证工作区。准备和使用均不改系统 PATH/全局安装。工具链与临时运行工作区不提交。

Node 启动前使用 OS 白名单环境、合成 home/temp、复制依赖和精确公开 `.env.example` 例外；测试进程不预填 AUTH_SECRET/DATABASE_URL，要求 suite 自己声明 fixture。仅 build lane 使用公开合成配置与已验证 Next 双 worker 限制。Prisma 只生成到复制依赖。

Go 使用显式安装路径、独立缓存、GOENV=off/GOTOOLCHAIN=local。Docker 只使用已只读核实的本机 npipe Docker Desktop Linux engine；数据库/E2E wrapper 继续自行固定 endpoint、空 Docker config、owner 资源和本地已安装镜像，不接用户开发/生产服务。

重量级验证由主会话串行调度，每次先更新源码快照并保存源/配置哈希。标准 Node/Go/DB/迁移/E2E 命令有独立截止和真实退出记录。单元测试或前置条件通过不代表数据库、实际容器或真实 R2 验收通过。
