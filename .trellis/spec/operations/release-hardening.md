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
- 完整历史可应用不代表 Prisma 声明无漂移；baseline/deploy 后保留 `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` 零差异门禁。若失败，先在 disposable 库输出实际 diff，按数据库规范化表达式核对 `dbgenerated` 和映射约束，不能仅凭静态 SQL 比较推测原因。图片默认值回归见 [Image Storage](./image-storage.md)。
- 已有表但缺历史的库只能走显式 `scripts/migrations/baseline.mjs`（默认 dry-run、连续前缀、digest 绑定）。
- failed migration 只能走显式 `scripts/migrations/repair.mjs`（allowlist + checksum 核对）。
- 缺失前置迁移走 `scripts/migrations/prehistory.mjs`；`20260423000000_initial_schema` 是 synthetic foundation，禁止修改已发布 migration SQL/checksum。
- `listLocalMigrations` 与Prisma迁移记录使用原SQL文件字节checksum；shared Image/Canvas声明链的全部路径以 `text eol=lf` 固定检出，含已发布Canvas基座。函数body的CRLF规范化不替代原字节核对。未发布迁移的EOF/换行修正须同步声明hash、保留原通过/失败范围，并重新运行当前迁移/数据库/CI及最终拓扑门禁。
- 所有自动 migration 测试只用 runner 自建随机 localhost PostgreSQL（tmpfs、owner label、`--pull=never`），拒绝回退 `.env`/开发/生产库。
- shared PostgreSQL helper 与 standalone worker DB runner 使用 `scripts/lib/local-docker-safety.mjs` 的 `LocalDockerSession`：只读解析 context 后只接受 local unix/npipe endpoint，随后每条 Docker 命令固定 `--host`。本地镜像检查通过后才建空 Docker config，容器操作不得继承用户 auth/proxy/context；删除需同时核对原 ID、精确名称和 owner label，不传 `--volumes`。
- worker/canvas DB runner 使用 `createDisposablePrismaWorkspace` 的显式隔离 Prisma config 与 `disposableTestEnvironment` 的 deny-env preload；仅注入 URL 不等于阻止读取本地凭证。旧 `verify:migrations` 的 `buildDatabaseEnvironment` 仍继承调用者环境，执行它必须额外使用已审计外层隔离/deny-env，不能宣称所有旧 wrapper 已自主隔离。

## 4. Health 与 Readiness 语义

- Worker `/healthz`：纯 liveness，不因 DB/schema 暂时不可用伪装进程崩溃。
- Worker `/readyz`：检查 DB 连接、`CheckSchemaContract`、拓扑锁、消费循环、draining；失败返回稳定错误码 + 503。
- Next `/api/healthz` 与 `/api/readyz` 分离；readyz 检查 DB、运行配置，生成能力启用时检查 Worker readyz。
- schema 缺失、DB 断连、Worker 崩溃、migration 失败、draining 一律不得返回 ready。
- 外部响应不得泄露 DSN/SQL/密钥/原始 DB 错误；详细原因进结构化日志。

## 5. 环境变量单一契约

- `contracts/runtime/v1/environment.json` 是唯一事实源：定义 owner、允许读取路径、类型、默认值、生产约束、secret、build/runtime 属性。
- manifest 覆盖的变量必须由各自唯一 loader 读取（Node `src/lib/env.ts`、Go `worker/internal/worker/config.go`）；owner 外直接读 `process.env`/`os.Getenv` 会令静态审计失败。
- 生产 `AUTH_SECRET` 至少 32 位并拒绝公开占位值；生产 `APP_URL` 必须显式且非 loopback。
- Compose 注入完整且已编码的 `DATABASE_URL`，禁止 YAML 拼接连接串。

## 6. 指标、日志与安全

- `/metrics` 只在内网/令牌可见；embedded Worker HTTP 默认 loopback，dedicated Worker 端口仅容器网络可见（`expose`，不发布公网）。
- 指标保留 JSON 并带 `schema_version`；provider request ID、job ID、attempt、error code、duration 进结构化日志，不做高基数标签。
- Node/Go/supervisor 共用 redactor：DSN 密码/查询参数、Authorization/API Key、上游响应正文、媒体签名 URL 一律脱敏。

## 7. 验证入口

```powershell
pnpm verify:ci            # Prisma generate + tsc + lint + vitest + worker 契约 + go + next build
pnpm verify:migrations    # 空库/baseline/prehistory/failed/pgx 场景
pnpm verify:e2e           # embedded/dedicated/冲突/schema/DB 断连/失败传播
pnpm verify:worker-contracts:db
docker compose config --quiet
docker compose -f docker-compose.e2e.yml config --quiet
```

- 每个单元测试进程约 57s 独立截止；全量 vitest 进程独立 300s（单用例 30s）；migration/DB runner 与 E2E 使用各自更长独立截止，禁止嵌套进 60s 父截止。
- GitHub Actions 的验证阶段只调用仓库内 wrapper（`.github/workflows/verify.yml`），不复制场景命令；安装依赖及明确的基础镜像准备仍在独立 prerequisite 步骤完成。
- `verify:ci` 显式生成 Prisma Client 后才做 tsc；只有最后生产 build stage 注入合成 APP_URL/DB/auth/provider 环境，不能污染默认环境测试。安装依赖或后续 `pnpm build` 不能代替 typecheck 前的生成前置。
- shared disposable PostgreSQL 的 ready probe 显式连接容器内 TCP 127.0.0.1:5432；默认 Unix socket 可能命中 init 临时服务，并在第一次 CREATE DATABASE 时遇到 shutting down。保留原20s ready/1s probe、owner与清理约束，不用盲目sleep增加时限。
- `verify` 的 GHCR publisher 只在原仓库 main push 且三项验证成功后运行；固定SHA/内容digest、最小token权限、Public校验和镜像版Compose更新契约见 [Image Publishing](./image-publishing.md)。发布不代表生产部署。
- E2E 资源随机命名、带 `com.narra.e2e.owner` label、PostgreSQL tmpfs。`scripts/lib/e2e-safety.mjs` 先验证本地 unix/npipe Docker endpoint 并固定连接，再检查所有本地基础镜像；缺失返回 2，不能拉取或回退其他数据库。
- E2E 与 DB runner 复用 `local-docker-safety.mjs` 的 endpoint、OS-only env 和 owner-marked scratch 校验。`LocalDockerSession.pin(probe)` 前仅允许 context 读取；`prepare()` 后才允许容器命令；scratch/config 的 resolved path、owner 和空配置必须在使用及清理时核对。验证缺镜像的安全退出不等于验证成功创建/清理容器。
- CI 在 wrapper 外显式准备 PostgreSQL17、Node24.22.1、Go1.25、Alpine3.22 四个 E2E 基础镜像；本地显式准备需用户授权。wrapper 只使用已核验的本地镜像/ID，保留 `--pull=false`/`--pull=never`，不能因缓存缺失自动联网拉镜像。
- E2E 网络保持 owner-labelled `--internal` 且不发布 app/embedded 端口；Docker29 的 internal bridge 可能保留请求的 HostConfig port binding 却不分配实际 host port。不要改成外部网络绕过：`checkedCompose exec` 执行固定 `canvas-object-store.mjs app-http`，目的地固定容器内 `127.0.0.1:3000`，会话 cookie/请求体仅走有界 stdin、不进入 argv/日志。
- fixture HTTP 以固定模式区分就绪/Canvas 与图片迁移所需的 API、媒体/optimizer/封面路径；仅允许明确的路径/方法/查询形状。图片模式的发布地址为本轮 internal 网络的 `http://app:3000` 或 `http://embedded:3000`，以实际 canonical GET 校验退休前读者；不放宽生产 SSRF。禁止任意 host/编码路径/重定向。envelope256KiB、正文128KiB、响应1MiB，读取和 HTTP 各有10秒截止；这只是测试通道，不是生产反向代理或新 API。
- fixture 复用共享请求头时用 `Headers.set` 做大小写不敏感覆盖；对象展开同时带 `content-type`/`Content-Type` 会组合成 `application/json, application/json`，应修 fixture，不能放宽生产 JSON Content-Type 校验。图片 fixture 先经生产容器/CRC 校验，不能用任意字节冒充原图。
- 本地经典 Docker builder 使用已核验 base ID、`--pull=false` 和 `--force-rm`；`.dockerignore` 排除嵌套 dotenv/package 凭证、assistant metadata、node_modules/build 输出与无关子仓库。应用 builder 设 `NEXT_TELEMETRY_DISABLED=1`，不为隐藏工具弃用提示而改变生产 module-type。
- 本机依赖/构建环境故障的 task-only 缓存复用必须核实 Node/pnpm、全部lock输入、基础层和运行环境，并保留原完整 build/type/scenario 门禁。若为避免重复复制而重建 runner 的生成依赖，完整目录路径/type/权限/内容及字面symlink必须与实际成功builder逐项一致，不可排除cache或直接沿用旧Prisma Client；报告明确原Dockerfile与验证变体的边界。EOF、WSL退出和明确V8 heap exhaustion保留各自证据，不互相推断原因。
- task-only 依赖缓存的镜像与本地marker共享生命周期：清理核实精确image ID、owner label、唯一tag、无使用容器后非force移除；Docker29可记录同一owned repository与同一image摘要的RepoDigest，不能据此接受其他repository/digest。移除后核对tag不存在，并在核实resolved路径及原字节后将marker归档为 `.before`，保留SHA；陈旧marker的预检失败保留原退出码，不以全局prune或未知镜像删除修复。
- 全局桌面服务恢复与测试凭证隔离是两个环境：启动本机已安装Docker Desktop使用其原Windows profile和隐藏窗口，不能继承测试合成APPDATA/USERPROFILE；运行测试继续空Docker配置、合成HOME及deny-env。长期后台子进程不可持有捕获管道导致父截止失效；恢复清理只按原daemon和本轮精确owner/ID，不能清空用户资源或覆盖原失败回执。
- Compose 必须使用 runner 创建的空 `--env-file` 和隔离 Docker config；只保留经路径/文件校验的 Compose plugin 信息，不继承本地 auth、proxy、context 或 `.env`。所有启动禁用 pull 和隐式 build。
- E2E 图片场景可创建本轮随机、owner/project-labelled 的 LOCAL named volume：只接受 local driver、空 options，并检查 Name/CreatedAt/labels 和实际 `/data/images` 挂载。清理先移除核实容器，再检查全 daemon 无任何挂载并重核该卷身份，使用精确名字非 force 删除；不接受用户卷。其他 container/network/image 仍逐个核对 ID/labels/创建记录。禁止 `down --volumes`、`--rmi local`、prune、任意调用者镜像删除及无限清理截止。
- 默认 `verify:e2e` 含 11 项 legacy/Canvas/图片场景，总截止40分钟，图片单场景10分钟，清理独立120秒。两种图片拓扑必须实际生成/上传/导入、登记/迁移、读取验证、失败退休再恢复、重建同卷读取，并拒绝错卷/无对应能力的 Worker；测试源码白名单须包含新增的 `docker-compose.image-history.e2e.yml`。
- Canvas 历史纳管的拓扑测试真实停止服务并等待原 GC lease 到期，再用本轮固定名称的同卷 standalone CLI 完成复制。应用尚未恢复时 canonical reader proof 必须阻止源退休；重启后恢复同 job 并交给新执行器。不得修改数据库租约时间或弱化 guard 来让 live scheduler 下的纳管通过。

## 8. 回滚安全

- 回滚代码前必须运行 `pnpm rollback:preflight`（调用 `CheckRollbackSafety`）；存在活动 contract v1 或未决 handoff 时不得启动旧 Worker/finalizer。
- 图片清单升级后，preflight 还在同一只读 REPEATABLE READ 快照中检查 ledger、业务绑定和新 GC/history 标记，并复用完整实际 Image/Canvas catalogue 校验。partial schema 不能假报 legacy-safe；已存在受管理 image schema（当前 storage revision 3）/ Canvas storage revision 3 就拒绝旧 Worker，即使计数为零。完全没有新标记的历史库才保留原 v1/handoff 检查逻辑。
- 图片管理 readiness 的 storage/reader/executor revision 当前均为 3，并要求 `maintenance=running`，与原 version/schema/provider/locationId 一同精确校验。清理默认停用，升级 schema 不自动启用破坏性策略；旧无读保护进程须 drain，再启用新执行器/LOCAL。maintenance loop 的就绪不依赖 Next 媒体路由，避免 embedded 启动循环。显式迁移源退休的 published reader GET 仅属于 CLI 运维动作。
- `/app/narra-image-history` 在两个镜像内均可执行，默认只读，显式 apply/源绑定/目标/退休的运维协议见 `docs/image-storage.md` 与 [Image Storage](./image-storage.md#9-历史登记复制和读取投影revision-3)。代码/镜像准备与隔离验证不代表已对生产 R2 执行操作。
- 回滚报告补充 `active_image_history_jobs`、`unresolved_image_history_items`、`unresolved_image_observations`、`active_image_history_holds`。部分 history/provenance 标记必须触发 catalogue 验证，不能在没有 ImageObject 时忽略已观察而未决的历史数据；输出保留固定错误码，不泄露连接配置、文件路径或 SQL。
- 回滚报告 JSON 保持 `schema_version=1` 并追加图片/Canvas 修订、managed/local/active reservation/unresolved object 计数；错误不得打印原始 SQL、DSN 或本地路径。测试需要 current/legacy/partial 三类真实数据库夹具，不能只 mock 计数。
- 回滚保留 additive schema；平台探针在回滚后不得把 readiness 重新指向纯 liveness。
- 任何非 disposable 数据库 baseline/repair、volume 删除或生产配置变更需用户另行明确确认。
