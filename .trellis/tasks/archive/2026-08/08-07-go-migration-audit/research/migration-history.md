# Research: migration-history

- Query: 从 Git 历史和当前文档核对 Go 化迁移的实际阶段、发布边界、回归修复和未闭环项，避免把“已提交”误判为“已完成”。
- Scope: internal
- Date: 2026-08-07

## Findings

### 1. 迁移是连续叠加的 Worker 化，不是后端整体替换

Git 历史显示 Go 运行时在 2026-05-30 才首次进入主线（`a104dde`），该提交新增约 2,365 行 Worker/配置/存储代码，并同时改动 Next API、Prisma schema、Docker 和 E2E Compose。随后：

- `5a7d516`（2026-05-31）把外部 OpenAI 兼容生图的模型调用改成创建 `workerManaged` 任务并由 Node 轮询；外层鉴权、限流、参数解析和响应仍在 Next。
- `97c6bfb`（2026-05-31）只新增 Worker `/healthz` 与 `/metrics` 端点。
- `493f172`（2026-06-01）把 Worker 二进制复制进根镜像，并由 `scripts/start-prod.mjs` 作为第二个子进程托管；这增加了单容器部署路径，但没有移除 Node/Prisma。
- `ce75d2b`（2026-06-01）仅补充单容器部署文档和开关说明。

当前迁移文档仍明确写出“第二阶段正在推进”，并将 Go 的边界限定为任务消费/模型调用，Next 继续负责用户请求和页面/API（`docs/go-backend-migration-plan.md:3-9,30-34,56-60`）。因此历史证据支持“部分迁移/混合架构”，不支持“Go 后端已替换 Next”。

### 2. 视频功能是在迁移基础上当天追加，未形成独立发布闸门

2026-06-01 的提交序列在 Worker 化后紧接着加入视频字段、视频客户端、轮询、落库和作品广场（`a369bee`、`f3636c7`、`6a5276d`、`af5d5cd`、`38e9ef5`、`4e2394e`）。视频 schema 迁移直到同日的 `f6c2445` 才补上；该提交说明直接指出此前视频开发使用 `db push`，生产 `migrate deploy` 不会同步视频 schema。随后 `1d209aa`、`32732d6`、`8c88145` 又连续修复上游响应、视频存储和图生视频超时。

这条时间线表明：功能代码、迁移 SQL、部署行为和上游兼容性曾不同步落地；每次修复都需要单独验证，不能以“Worker 目录存在”作为视频迁移完成标准。

### 3. 启动脚本的数据库自愈来自历史事故，属于兼容补丁而非可审计迁移流程

在 Go 迁移之前，启动脚本已经因 Zeabur/Prisma 数据库状态问题连续补丁：

- `bbd5b6e`（2026-04-28）首次加入空库检测、`db push` 和 baseline `migrate resolve`。
- `e382aa4`（2026-04-24）将 `db push` 从镜像构建移到启动阶段，因为 Zeabur 构建时没有数据库。
- `ee88209`（2026-05-10）将数据库重试从 60 次扩为 180 次，并增加瞬时错误匹配。
- `4d05c5c`（2026-05-23）修正不支持的 Prisma 参数。
- `6b78019`（2026-05-23）加入一个特定失败迁移的硬编码 DDL 修复。

当前 `scripts/start-prod.mjs` 仍沿用这条路线：空库走 `db push` 后批量 `migrate resolve`，已有库在失败时尝试 baseline/特定 repair。历史上这些提交解决了真实部署故障，但也说明启动脚本同时承担 schema 初始化、迁移、修复和进程编排；它不能等同于一个独立、可回滚、可审计的迁移发布作业。

### 4. 迁移 TODO 在最近提交中没有对应实现提交

`docs/go-backend-migration-plan.md:23-54` 仍把以下项目列为后续工作：队列优先级/用户限流、错误分类重试、耗时分段、图片存储服务化、SSE/WebSocket、provider request ID、把鉴权/积分/API Key 下沉 Go。按 `git log --all -- worker` 和相关路径检索，2026-06-09 的最后一条 Worker 专项提交是 `3f52b1d`（图片编辑 MIME 修复）；其后到当前 `main`（`6e29a91`）主要是 UI、安全和业务补丁，没有这些 TODO 的实现提交。因而应把它们标为“文档确认未完成”，而不是“可能已在另一分支完成”。

仓库分支列表中也没有独立的 Go 网关或迁移完成分支；现有分支主要是 UI/管理/视频功能分支。未发现 `.github/workflows`、Zeabur manifest、定时任务或备份脚本，故无法从仓库历史证明线上已经采用某个外部发布闸门。

### 5. 文档对部署拓扑的描述存在双轨，需要在计划中先定模式

README 同时推荐两种互斥运行方式：Zeabur 单服务将 `ENABLE_EMBEDDED_WORKER=true`（`README.md:108-123`），本地 Compose 则启动独立 `app`、`worker`、`db`（`README.md:102-119`）。Compose 明确把 app 的 `ENABLE_EMBEDDED_WORKER` 设为 `false`，而 `.env.example` 默认值是 `true`。这不是单纯的文档差异，而是两个不同的进程监督、健康检查、扩缩容和故障恢复模型；后续迁移计划必须先声明目标拓扑，再分别定义验证和回滚点。

## Files Found

- `docs/go-backend-migration-plan.md`：迁移阶段声明、已落地能力、TODO 和暂不迁移边界。
- `README.md`：Next/Go 混合架构、Zeabur 单容器建议、Compose 三服务说明和人工发布步骤。
- `a104dde`：首次 Go Worker 管道及队列 schema 的引入提交。
- `5a7d516`：外部 OpenAI 兼容生图切换为 Worker 管道的提交。
- `97c6bfb`：Worker 健康/指标端点提交。
- `493f172`、`ce75d2b`：嵌入式 Worker 与单容器部署提交。
- `a369bee` 至 `4e2394e`：视频 schema、Worker 和前端工作区连续提交。
- `f6c2445`、`1d209aa`、`32732d6`、`8c88145`：视频迁移/上游/存储/超时修复提交。
- `bbd5b6e`、`e382aa4`、`ee88209`、`4d05c5c`、`6b78019`：Zeabur/Prisma 启动自愈历史提交。
- `Dockerfile`、`worker/Dockerfile`、`docker-compose.yml`、`docker-compose.e2e.yml`、`scripts/start-prod.mjs`：当前双拓扑和启动行为。

## Code patterns

- `docs/go-backend-migration-plan.md:3-9` 将当前状态定义为“第二阶段正在推进”，明确 Next 仍保留外层 API。
- `README.md:21-23` 将产品描述为 `Next.js + Prisma + PostgreSQL`，仅把生图任务消费交给独立 Go Worker。
- `README.md:108-123` 以 `ENABLE_EMBEDDED_WORKER` 区分单容器 Zeabur 与 Compose 三服务。
- `package.json:7-20` 仍以 Node/Prisma 脚本为主，Go 只有手动 `prompt:sync` 入口。
- `worker/internal/worker/config.go:45-80` 显示 Worker 仍是独立配置/进程，且与 Node 的生产密钥策略需要跨运行时对齐。

## Related specs

- `.trellis/spec/guides/cross-layer-thinking-guide.md:19-49,105-123`：要求以 Source → Transform → Store → Retrieve 方式检查跨层契约，并验证迁移/回滚边界。
- `.trellis/workflow.md` Phase 1.2/1.5：研究结论须持久化，复杂任务需在实施前完成设计、执行计划和验收标准。

## External references

- 未使用外部网络资料；所有时间线和状态来自本仓库 Git commit、文件内容和分支元数据。

## Caveats / Not Found

- Git 历史只能证明仓库内的变更，不能证明 Zeabur 线上实际采用的镜像、环境变量、健康检查或发布顺序。
- 没有访问真实 PostgreSQL、对象存储、模型渠道或生产日志；“未完成”结论限于仓库没有实现/证据，不排除平台侧存在未纳入版本控制的补偿配置。
- 本研究未修改产品源码、规格文件或 Git 历史，仅新增本任务 `research/` 文件。
