# C3 历史图片迁移复核与验证

状态：C1/C2/C3全范围复核、当前完整CI（168套/2150项）、全部DB/迁移及默认11场景E2E通过，950产品输入与当前成功回执一致，独立资源清理通过。两笔工作提交 `1368518dfe0e2b3d9a78789f022b4e0859240ff6` / `67b0edfd777629bd1dcd37117a1d0e892a115c9e` 已完成，本任务及相关C1/C2/父任务按序归档；journal第9次记录位于 `.trellis/workspace/0401lucky/journal-1.md`，未push。历史失败、旧765657及浏览器/Linux CLI的适用输入边界保留于下文。

## 执行边界

- 主会话 `/root` 独占 C1 `checks/isolated.py` 与 `checks/.runtime/storage-4e37900e/app` 的冻结、lint、类型检查、测试、数据库与容器执行。
- `/root/c3_check` 仅进行源码/规范复核、静态检查和源文件修复，不运行 pnpm、Go 或 Docker，不读取真实 `.env`，不 stage/commit/push。
- 本次 `/root/storage_final_check` 读取前轮全范围复核、父/子 PRD/design、相关规范、最终源码与实际回执，只更新此验证记录；主会话继续独占执行器、冻结快照、spec/task 元数据和资源清理。未重跑重型门禁或修改已验证的产品源码。
- C1/C2 的既有通过回执是前置依赖；新 C3 修复必须获得当前快照的独立回执。schema capture 不等于业务 DB 测试，两种定向拓扑也不能替代完整默认 E2E。

## 发现与修复

| 编号 | 文件/路径 | 问题与修复 | 验证状态 |
| --- | --- | --- | --- |
| C3-F1 | `worker/internal/worker/image_history.go`、`image_history_progress_test.go` | 只读进度忽略已扫描但仍被其他执行者领取的未完成项；`HasMore` 增加 `completedItems < totalItems`，覆盖未完成领取、分页、阻塞、空/完成任务。 | 当前完整 CI 的 Go 全量测试通过，见 `162157-ci-bounded-88eb1c`。 |
| C3-F2 | `20261115180000_image_history/migration.sql`、`image-history-db.test.ts` | 复用既有物理对象时曾跳过精确公开 URL 校验，任意第三方参考 URL 可被错误别名化。数据所有者将校验提前到新建/复用公共分支，只接受已有同资产精确 alias 或明确源位置的完整公开地址。 | 数据所有者已修复；当前 full/additive 真实 DB 回归通过，见 `160229-canvas-db-be1df8`。 |
| C3-F3 | 同上 | 显式退休任务在切换后、退休请求前仍为 RUNNING，但 `completedItems` 提前计满，CLI 可能在无法抢占原有效租约时误报完成。完成计数与状态刷新统一排除该窗口。 | 数据所有者已修复；异 token 不可领取、未完成计数及请求后的完成数在当前 full/additive DB 均通过。 |
| C3-F4 | `src/lib/storage/image-input-aliases.ts`、生成入队、登录封面及 Go gateway | token 读者接受规范化 host/default-port 或新的当前站点基址，但输入/封面根只按精确 alias 关联，可能漏保留。新业务事务在引用 epoch 内重新验证 AVAILABLE/READY，并登记实际接受的 URL 字符串；历史输入不改写，GET 不写 alias。Go gateway 在 epoch 后用同一事务再次读取现有 job，避免并发 replay 验证或登记替换输入。 | Node helper 21 例、实际生成 POST 7 例及 Go 单测随完整 CI 通过；真实 JOB_INPUT/SITE_COVER 竞争随 full/additive 通过；gateway 实际 alias/永久根/并发回放在 `162835-gateway-db-629223` 通过。 |
| C3-F5 | 历史 SQL、`image-history-db.test.ts` | 超 2048 字节的原 URL 仅保留摘要，曾允许进入可读/复制路径却不能建立原 URL 根/alias。数据所有者在新建与复用对象的可读判定、COPY 与 hold 解除处阻断，保留真实字节计量和原始永久 URL 事实。 | 新建/复用回归在当前 full/additive DB 均通过。 |
| C3-F6 | `MyWorksBoard`、`AdminWorksBoard`、`useFeaturedGallery` 及对应测试 | 已挂载列表/大图缓存了旧 S3 URL；收到同 ID、同 availability 的新 token URL 仍继续使用旧源。按 ID 窄合并媒体 URL/可用性，已打开大图读取当前行，首页仅保存有界媒体覆盖值，保持游标、分页、选择、提示词和点赞数据。 | 当前完整 CI 的 lint、类型及全部 2146 单测通过，见 `162157-ci-bounded-88eb1c`。 |
| C3-F7 | `docs/image-storage.md` | 源退休重试说明错误地称复用旧物理 token。改为复用物理记录、再次领取使用新删除 token，旧 token 拒绝。 | 静态文案修复完成。 |
| C3-F8 | `contracts/media/v1/schema.json`、Node/Go schema decoder 与对应单测/DB 回归 | 独立 CLI 和 managed image gate 原先只核对 image 函数，Canvas 关闭时旧 GC/root 协议漂移可漏检。主会话扩展媒体 catalogue 到全部依赖 Canvas 字段/索引/约束/函数/trigger、`CanvasGcLease` 和 4 个有序 enum，迁移链加入原 Canvas 迁移；decoder 接受对象形 enum 定义。 | 当前 SQL `124595...` 捕获 media 820 / Canvas 201；真实 DB 函数/枚举漂移回归随 full/additive 通过，Node/Go 来源驱动完整定义比较随当前完整 CI 通过。 |
| C3-F9 | `worker/internal/worker/backfill.go`、`backfill_db_test.go` 与 Worker DB suite | 历史纳管保留 NULL 原 metadata，旧 backfill 因只筛 `mediaStorage IS NULL` 会再次抓取并 PUT 后才发现已绑定。图片扫描增加 `mediaAssetId IS NULL`，下载前及 PUT 前重新核对 owner、原 URL 和 NULL metadata/association；视频条件保持原义。 | `162720-worker-db-6747d6` 真实 DB 通过，覆盖绑定后的 NULL 行、陈旧扫描、抓取后绑定、原 URL 变化、两种 write flag/dry-run 和零新 PUT。非 managed 在途 IO 无 ledger grant，历史 apply 仍必须先 drain 旧写者/backfill，不能宣称支持两者并发。 |
| C3-F10 | Worker `legacy-schema.sql`、`gateway_image_inputs_db_test.go` 与旧 Node 读路径夹具 | 最小 Worker baseline 声称已应用 Conversation 迁移却缺表，新 epoch trigger 无法安装；新 gateway 并发 winner 夹具漏必填 providerMode；旧 Node 测试未建新增只读 alias 查询边界。 | 从原发布 DDL 恢复完整 Conversation/default/index/两条 FK，补 `BUILT_IN`；Node 严格空 alias 查询与显式环境夹具随完整 CI 通过，Worker/gateway DB 后续分别通过。未跳过生产 trigger 或改旧迁移/checksum。 |
| C3-F11 | `scripts/fixtures/image-history-runtime.mjs`、`scripts/verify-e2e.mjs`、`image-history-e2e-safety.test.ts` | 真正运行到 Canvas 退休时，夹具仍保留默认关闭的维护策略，却等待退休请求成功。既有 SQL 明确拒绝为 `IMAGE_POLICY_DISABLED`，CLI 的持久 blocker 只保存通用 `IMAGE_STORAGE_UNAVAILABLE`，原场景日志又未输出保留原码的 CLI progress。 | 夹具先用真实 CLI 断言已完成公开读证明但因策略关闭被拒绝、源未删且无重复 PUT，再通过 `image_update_storage_policy` 和当前 expectedVersion 显式启用维护，保持 quota/schedule 清理关闭并恢复同一 job。存储事实比较允许正常 EXCLUDED 扫描记账，完成回放仍全量相等；日志只输出有界状态/安全码，不带绑定、URL、key 或错误原文。新增 4 项回归随 `180804-ci-bounded-12d932` 的 2150 项全量通过；公开 envelope 经 F12 修正后，两种拓扑的实际拒绝与恢复由 `765657` 完成验证，生产 SQL/Go 不变。 |
| C3-F12 | 同上；对照 `worker/cmd/image-history/main.go:37` | F11 消费者和测试共同把内部 `ImageHistoryApplyReport` 当成 flat CLI JSON；实际公开 `historyCommandResult` 将其放在 `progress`，因而已通过 CI 的 helper 在真实命令上找不到 `items`，诊断也丢失进度。 | helper 严格验证顶层 `schemaVersion/dryRun/code/status`，仅从 `progress.items` 找策略拒绝；诊断取顶层 code 与嵌套进度，测试使用真实公开外壳，不添加错误 flat 形状的兼容 fallback。`183728-test-d0c4e5` 两套 57 项、`183838-types-aec1c4`、`183856-lint-ed3d80` 及当前默认 11 场景 `765657` 全部通过；仅三份夹具/诊断/测试文件变化，产品 SQL/Go/应用逻辑未变。 |

## 已收到的实际回执

以下保留原快照边界，不代表之后所有源码已经验证。

| 回执 | 实际结果 | 适用边界 |
| --- | --- | --- |
| `20261115T150935-history-catalog-b04c61` | 追加迁移可执行，media 636 / Canvas 201 个 catalogue 对象可捕获。 | SQL `04eea8ce2b67ffb8dffa2fa28a876cde3c6763b645be8665cb500d37e1b3062d`；后续 SQL 已改变，需要新采集。 |
| `20261115T152911-history-linux-tests-d0ed0c` | 主会话报告通过，6.475 秒；编译并运行 `./cmd/image-history` Linux 测试二进制，覆盖默认初始化/扫描零 transient 文件变更、递归 inotify、取消及 flag/manifest 用例；只读源码挂载、network-none 与 owner 清理已核验。 | 15:24 冻结快照；二进制 SHA256 `8f7e4e530271ce3263eb569fbb2184a52e594ef1baafb09b835baa8780fb61b7`。不包含之后的 Node/UI/SQL 修复，也不代表 Linux 上执行了 `worker/internal` reader IO 测试；后者由 Go CI 与实际拓扑分别举证。 |
| 15:24 第三轮 Canvas DB 诊断 | 主会话报告 C3 当时 19 个用例及 Canvas/Image storage 通过，Image retention 仍有 10 个跨 suite 状态隔离失败。 | 整个 wrapper 未通过；数据所有者正在修正自己的竞争夹具清理/隔离，不能拼接成完整通过。 |
| `20261115T154245-test-90593d` | 7 个定向套件共 128 例，125 例通过，3 例失败；input alias 21、生成安全原 5、admin 3、my works 5 通过。 | 新 gallery 测试缺少 parser 明确输出的 `availability: available` 预期已修复；两例 Canvas 多输入成功路径返回 500 仍在诊断。 |
| `20261115T155443-test-eb0645` | 主会话确认最新实际生成 POST 安全 7 例及 input alias 21 例通过；两例 Canvas 仍在 preflight 返回 `IMAGE_INTERNAL_ERROR`，未进入 job/debit 事务。 | 已加入仅测试使用的 response/raw-query 诊断；不能把通过子集视为完整 Node 门禁。 |
| `20261115T160229-canvas-db-be1df8` | 主会话报告 full 与 additive 均 4 套件、87/87 测试通过（含 27 个 C3），wrapper exit 0，62.733 秒。 | SQL SHA256 `12459548628adecd2f1cde186c0485ebe52d3dd5e44eb5f1b44abafe7ae1eecd`、media 820 / Canvas 201，包含完整 Canvas 依赖 schema gate；后续无 SQL 改动。Worker/gateway DB 和最终 E2E 仍需各自回执。 |
| `20261115T160642-test-5e4013` | 两例 Canvas 失败的根因已定位：Vitest 并发 lazy import 让第二次查询绕过 `db` mock，触及隔离配置下的真实 Prisma client；不是输入契约失败。 | 已在测试的 repository 构造边界显式注入 fake queryer，保留真实 SQL/decoder 和传入的 transaction client，删除全部临时诊断；原断言保留并分别验证 2/5 个 URL 查询。后续 `161439` 全量单测阶段已验证全部 Canvas generate 通过。 |
| `20261115T161439-ci-bounded-96ca66` | TypeScript 与 lint 通过；168 套件共 2146 例中 2136 通过、10 失败。全部 Canvas generate 测试及新 UI/repository 回归通过。 | 失败仅为 `canvas-run-lookup` 缺只读 alias 查询夹具（9 例）与 `persist-generated-image` 无 alias-miss DB 夹具（1 例）。已补严格读 mock，保留原隐私/无写入/无退款/实际下载断言；待最终 CI 重跑。 |
| `20261115T161843-worker-db-e6fca1` | Worker DB wrapper 在 C3 migration 遇到 baseline 夹具缺少 `Conversation`，exit 3，尚未进入 Worker/gateway 回归。 | 夹具已补原 `20260505000000_add_conversation` 完整 DDL、title 默认值、user index、User cascade 与 GenerationJob SET NULL FK；生产 SQL `124595...` 和原 baseline checksum 不变。静态复核同时补新 gateway race 夹具的必填 providerMode。 |
| `20261115T162157-ci-bounded-88eb1c` | 完整 CI 10 个 stage 全部通过，exit 0，205.274 秒：TypeScript、lint、168 套件 / 2146 单测、Worker TS/Go 契约、Go 全量测试及构建、完整 Next 构建（27.4 秒）。 | 主会话冻结核对 `sourceChanges: none`；随后仅新增 Conversation baseline DDL 与 gateway race providerMode 夹具修正，无生产代码变化，相关夹具由下一轮真实 DB 门禁验证。 |
| `20261115T162720-worker-db-6747d6` | Worker DB wrapper exit 0，12.234 秒，完整 TS/Go 真实 DB 通过，包含新的 backfill 与 rollback 未决事实回归。 | 使用最新 Conversation baseline 夹具及 media 820 schema；gateway DB 由独立 runner 继续验证。生产代码与已通过 CI 的快照一致。 |
| `20261115T162835-gateway-db-629223` | Gateway DB wrapper exit 0，10.644 秒，包含实际规范 token 输入 alias、永久根、事务回滚和并发 replay 回归。 | 使用修正必填 providerMode 的并发夹具，生产代码继续保持冻结；迁移/E2E 门禁尚未由此替代。 |
| `20261115T163001-migrations-e83e1d` | 主会话报告 migrations 全部通过，46.237 秒，包含 Prisma schema diff、完整迁移与 rollback 校验。 | 与已通过 CI/DB 相同的生产源码，尚需实际部署 E2E。 |
| `20261115T163143-history-integrated-e2e-6b9ac0` | exit 2，1.05 秒；synthetic HOME 缺 Compose plugin，止于预检，未执行场景。 | 主会话将本机已安装 plugin 按 SHA256 `18b6393f8006a07aba46ed0ea27e880389e8cb8741581d9b0f97c978c1529501` 复制到 owned home；`compose-plugin-preparation.json` 记录来源、目标和未复制 auth/config。 |
| `20261115T163427-history-integrated-e2e-08cc94` | exit 1，29.71 秒；Compose/全部 4 个本地基础镜像预检通过，legacy Docker builder 在 `COPY . .` 报 parent snapshot 不存在，未运行部署场景。 | reviewer 已只读核对 stdout/stderr 与 receipt；`sourceChanges: []`、`snapshotModifications: []`。属于本机 builder/cache 状态，不能算作产品场景通过或失败。 |
| `20261115T163710-history-integrated-e2e-fa8901` | exit 1，97.725 秒；两项 owned image build 仅追加 `--no-cache` 后重新构建，固定 lockfile 安装在下载 684/686 个依赖后因 registry TLS `ECONNRESET` 失败，未运行部署场景。 | reviewer 核对 wrapper 保留原 Dockerfile、全部构建步骤/11 场景及原 Worker 验证；未 prune，`sourceChanges: []`、`snapshotModifications: []`。这是依赖下载错误，尚无应用运行失败证据。 |
| `20261115T164442-history-integrated-e2e-2982da` | exit 2，123.122 秒；只读 inspector 验证固定 C2 依赖镜像的 Node/三份当前依赖输入后，task-local Dockerfile 仅替换 deps-stage FROM，原 frozen install 重新执行成功，Prisma 生成及完整 Next 构建启动；Docker build 随后报 `unexpected EOF`。 | 实际场景未执行。清理 ownership re-inspect 又超时 124，尚未证明 inspector 已删除；已将确切 ID 交主会话复核。`dependency-reuse-<owner>.json` 保存来源/生成 Dockerfile hashes 与输入；`sourceChanges: []`、`snapshotModifications: []`。不将 EOF 无证归因于 OOM 或应用代码。 |
| `dependency-inspector-recovery-2982da.json` | 16:49:40 UTC，主会话确认 daemon 为原 ID，并重新核验确切 inspector ID、owner、exit 0、no-network/read-only/no-mount 后以非 force 命令删除。 | reviewer 已读取恢复回执；原 `2982da` 失败清理回执保持不变。后续 task-local 构建辅助器采用既有 C2 资源限制方法（完整 pnpm build、CIRCLE_NODE_TOTAL=2、old-space 1536 MiB、semi-space 4 MiB、每 RUN 3 GiB/2 CPU），不据此断言先前 EOF 的原因。 |
| `20261115T165136-history-integrated-e2e-d6bc5f` | exit 1，104.957 秒；deps-stage frozen install 成功，独立 builder base 的 Corepack 下载固定 pnpm 10.32.1 时遭 TLS `ECONNRESET`，还未进入 Next/Prisma 构建。 | inspector owner 复核及删除通过；`sourceChanges: []`、`snapshotModifications: []`。资源限制未因这次工具链下载失败得到构建成功证明，实际场景仍待执行。 |
| `20261115T165921-history-integrated-e2e-4fd0e1` | wrapper exit 2，132.562 秒；离线 Corepack、frozen install 与 Prisma 生成通过，完整 Next 构建期间 Docker 再次 `unexpected EOF`；build stage exit 1，112.268 秒。 | 实际场景未执行；inspector owner re-inspect 超时 124，清理在原回执中未完成。`sourceChanges: []`、`snapshotModifications: []`；不能从 EOF 推断容器 OOM。后续清理有独立恢复回执。 |
| `dependency-inspector-recovery-4fd0e1.json` | 17:03:53 UTC，原 daemon `cfd4f668…` 恢复；主会话核对确切 inspector ID、owner、原 exit 0、network-none/read-only/no-mount 后删除。 | reviewer 已读取恢复回执，`removed: true`、`originalFailureUnchanged: true`；不改写原构建/清理失败结果。 |
| `20261115T170509-history-integrated-e2e-bc3e98` | wrapper exit 2，142.279 秒；1 CPU / 2 GiB 试验仍在完整 Next 构建时失败，build stage exit 1，124.214 秒；清理 re-inspect 超时 124，镜像定位出现 Docker Desktop WSL 错误。 | 实际场景未执行；`sourceChanges: []`、`snapshotModifications: []`。主会话的 backend 日志显示整个 WSL engine 退出，guest exit `0xc00000fd`，没有容器 OOM 证据；不归因于产品代码。清理恢复另行记录。 |
| `desktop-native-recovery-bc3e98.json`、`dependency-inspector-recovery-bc3e98.json` | 主会话只停止任务创建的恢复进程树，以 native Windows profile 隐藏启动本机已安装 Desktop；17:18:27 UTC 重新核对原 daemon 和确切 inspector 后删除，并证明尝试的 app tag 不存在。 | reviewer 已读取两份恢复回执：无继承 caller secrets、无 settings 改动；原 inspector exit 0、network-none/read-only/no-mount 均保留，`removed: true`、`attemptedAppImageAbsent: true`。原失败回执不变。 |
| `20261115T170859-go-vet-c34f6b` | exit 0，1.589 秒，当前 Go vet 通过。 | `sourceChanges: []`、`snapshotModifications: []`；产品输入与最终浏览器快照完全一致。 |
| `20261115T170916-build-56192a` | exit 0，26.109 秒，当前完整原生 Next 构建通过。 | `sourceChanges: []`、`snapshotModifications: []`；产品输入与最终浏览器快照完全一致，浏览器回归直接使用这个 BUILD_ID，中途没有刷新冻结副本。 |
| `20261115T171857-retention-http-4b17cb` | exit 0，124.632 秒，真实浏览器六项检查通过；主会话目视复核 5 张截图。实际计量从 350 降到 280 字节，删除 70 字节；关闭浏览器后 Worker 继续完成，重启/replay 不再释放额度，媒体返回 410。 | reviewer 读取 `checks.json`：401/403、原生取消/确认、相同任务重载、Worker 重启、物理文件不存在、succeeded 状态/原提示词/credits 保留、owner 卡片/详情占位与下载禁用均通过；390px 无横向溢出。`sourceChanges: []`、`snapshotModifications: []`。该回归不替代 embedded/dedicated 部署链。 |
| `20261115T172214-history-integrated-e2e-39888f` | exit 1，126.812 秒；继承已验证 deps 后，Prisma 生成和完整 Next 编译成功（21.1 秒），TypeScript worker 在任务设置的 768 MiB heap 上限报明确 V8 heap OOM / SIGABRT。 | inspector 重新核验及删除成功，尝试的 app tag 不存在；`sourceChanges: []`、`snapshotModifications: []`。这是该次任务构建 heap 上限的直接证据，不能反推此前 WSL 退出原因。实际场景仍未执行。 |
| `20261115T172709-history-integrated-e2e-6dd675` | wrapper exit 2，282.453 秒；1536 MiB heap / 3 GiB 容器下完整 Prisma、Next 编译/类型检查/静态生成和 Go build 均通过，runner 第 45/55 步 `COPY --from=builder /app/node_modules ./node_modules` 时 Docker `unexpected EOF`；build stage exit 1，253.963 秒。 | 实际场景未执行；inspector `207280…30654` owner re-inspect 与确切 tag `narra-e2e-app:26046dcb8ee08212` 定位均超时 124，原回执中清理未完成，后续恢复见下一行。`sourceChanges: []`、`snapshotModifications: []`；完整编译成功不能替代可启动镜像或部署场景回执。 |
| `dependency-inspector-recovery-6dd675.json` | 17:34:49 UTC，主会话重新核对原 daemon `cfd4f668…`、确切 inspector ID/owner 和 exit 0 后删除，证明尝试的 app tag 不存在。 | reviewer 已读取恢复回执；network-none/read-only/no-mount、`removed: true`、`attemptedAppImageAbsent: true`、`originalFailureUnchanged: true`。未改写原 EOF/清理失败回执。 |
| `20261115T173806-history-integrated-e2e-d587e5` | exit 124，1065.205 秒，`timedOut: false`；生成 Dockerfile 的完整 app/Worker 构建成功，builder/runner 的 55,432 项依赖逐项相同。真实 embedded、dedicated、conflict、schema、dbdown、propagate、canvas-embedded、canvas-dedicated、canvas-mismatch 九项完成。 | `image-embedded` 在 `CANVAS_IMPORT checkpoint resume` 超时，未运行 `image-dedicated`；只读诊断显示源/目标仍 READY、退休为空。源码复核发现默认 disabled policy 的夹具遗漏，见 C3-F11；不能把九项通过拼成完整 E2E。`sourceChanges: []`、`snapshotModifications: []`，所有容器/网络/volume/镜像清理通过；`d587e5-runtime-summary.json` 保留九项时长及目录证明，原失败回执不变。 |
| `20261115T180101-history-linux-tests-24717a` | exit 0，5.107 秒；当前 Go/contract 快照的完整 `./cmd/image-history` Linux 测试二进制通过，包括递归 inotify、默认初始化/预览零写、取消与 flag/manifest 回归。 | 二进制 SHA256 `2f5d2f0e77356a64929ec29a31ee93007e011bc6c4b4d5ae6b8ac1f0b48b374b`；准确的测试容器清理通过，`sourceChanges: []`、`snapshotModifications: []`。不声称运行了 `worker/internal` Linux 单测；后续 C3-F11 只修改 JS 夹具/诊断/单测，无 Go/contract 变化，无需为此重跑该门禁。 |
| `20261115T180804-ci-bounded-12d932` | exit 0，200.452 秒，当次完整 CI 10 个 stage 全部通过：TypeScript、lint、168 套件 / 2150 单测、Worker TS/Go 契约、Go 全量测试/构建、完整 Next build（27.342 秒）。 | 包含 C3-F11 三份夹具/诊断/测试文件及 4 项新回归，尚未包含 F12 公开 envelope 修正；`sourceChanges: []`、`snapshotModifications: []`。到最终 E2E 的非 task 差异仅为 `docs/image-storage.md` 和这三份 F12 文件，应用逻辑、SQL、Go 与共享契约不变。最终三份文件由下面的 57 项、全局 types/lint 及完整 E2E 补齐，不把旧全量 CI 的字节范围扩大。 |
| `20261115T181219-history-integrated-e2e-2640e9` | exit 2，2.387 秒；此前无 tag 的旧依赖镜像 `98ca…` 已随上一轮最终镜像清理的悬空祖先移除，在依赖预检失败，尚未 build 或运行任何场景。 | `sourceChanges: []`、`snapshotModifications: []`；不能视作产品回归，也不能继承上一轮九项作为本轮结果。后续改由任务拥有并保留 tag 的缓存镜像支撑验证，最终单独核验 owner/tag/ID 后清理。 |
| `20261115T181723-history-integrated-e2e-2fd7ef` | exit 2，951.844 秒；app/Worker build 分别 294.007/39.041 秒成功，builder/runner 的 55,432 项同为 SHA256 `e2bc35132248073275cadf6b7b1df9bc79a5786e12093e437266c567d6e09578`。前九项真实 legacy/Canvas 场景通过；`image-embedded` 在策略拒绝断言处失败，`image-dedicated` 未执行。 | 实际 CLI 进度日志为 null/空 items，失败文本为 `Published-reader recovery must still respect the disabled policy`，对应 F12 的公开 envelope 错读。stderr 另保留一次 Go 子进程 `out of memory allocating heap arena map`，不把此诊断当作 envelope 断言失败的根因。`sourceChanges: []`、`snapshotModifications: []`；owned E2E 容器/网络/图片卷/app 与 Worker 镜像清理成功，task dependency cache 按设计保留独立 tag。 |
| `20261115T183728-test-d0c4e5` | exit 0，0.963 秒；`image-history-e2e-safety` 与 `canvas-e2e-runner` 两套 57/57 通过。 | 验证 F12 的真实公开外壳、拒绝条件和安全有界诊断；source/snapshot drift 为空，非 task 输入与最终 `765657` 完全一致。不是重新执行全部 2150 项的回执。 |
| `20261115T183838-types-aec1c4` | exit 0，3.179 秒；全项目 `tsc --noEmit` 通过。 | source/snapshot drift 为空，非 task 输入与最终 `765657` 完全一致。 |
| `20261115T183856-lint-ed3d80` | exit 0，13.721 秒；全项目 `eslint .` 通过。 | source/snapshot drift 为空，非 task 输入与最终 `765657` 完全一致；不为 warnings 修改生产配置。 |
| `20261115T184003-history-integrated-e2e-580614` | exit 1，152.976 秒；完整 Next 构建后捕获 55,432 项 builder 依赖清单，随后 app 的 Go stage 在 `go mod download` 读取 `proxy.golang.org` 的 AWS SDK v1.40.0 module 时返回 EOF，app build exit 1、148.997 秒。 | 未完成可启动镜像或任何部署场景；inspector 清理成功，尝试的 app tag 不存在。source/snapshot drift 为空，非 task 输入与 `765657` 一致。后续 task-only helper 仅把两个原 Dockerfile 的 module 下载改为至多三次，并保留完整 Go build 与原场景；不改依赖/锁文件/生产 Dockerfile，不改写此失败。 |
| `20261115T184531-history-integrated-e2e-765657` | exit 0，1278.531 秒；当前生成 Dockerfile 的 app/Worker build 分别 305.882/68.399 秒成功，builder/runner 55,432 项逐项一致、SHA256 `24a9f2ffd34268575e0916d2ce4a34196c02c0c83c4744ef6da0d49f37e083cd`。完整默认 11 场景均实际 PASS，包含 embedded/dedicated 图片历史迁移、故障退休/恢复、同卷重建和真实旧 C2 Worker 拒绝。 | reviewer 已独立核对 stdout、stderr、receipt、当前/frozen helper 及关键输入 hash；`sourceChanges: []`、`snapshotModifications: []`、`inheritedCallerConfiguration: false`。所有 owned E2E 容器、网络、两份图片卷及 app/Worker 镜像清理成功；task dependency cache 的独立清理见下一行。该回执完成本地部署验收，构建边界仍为有记录的生成 Dockerfile 与完整依赖树等值验证。 |
| `final-resource-audit-20261116-617547e9.json` | 主会话在原 daemon `cfd4f668-c4c9-40ef-b114-b07c4c944b18` 核验 `765657` owner 的容器/网络/卷/镜像均无残留；dependency cache 的唯一 tag、确切 image ID/owner 和无使用容器重新核对后，以非 force 精确 tag 删除，tag 已不存在。 | reviewer 已读取实际回执；第一次 audit 因预期空 RepoDigests 被 guard 拒绝且未删除，后续仅接受与确切 owned cache image 相同的本地 RepoDigest。原失败回执未改写，未接触生产资源。 |

`checks/gates.json` 由主会话绑定通过门禁的回执 SHA256，并列出各次产品输入与最终浏览器快照的逐文件差异；reviewer 已只读核对最初 9 份绑定及本次 13 份最终 code/DB/build/browser/CLI/E2E 回执的 exit、duration 和空 drift。`162157` 完整 CI 到最终浏览器之间只有 Conversation baseline 与 gateway providerMode 两个测试夹具变化，分别由后续真实 DB 验证；Canvas DB 后的变更仅为测试夹具，其中 `Legacy.imageId` 类型从 UUID 模板拓宽为 string，不改变 SQL 或运行时行为。早期 Linux CLI 后的 `main_test.go` 与 schema 依赖变化已由 `180101` 的当前快照复验补齐。浏览器之后的 C3-F11/F12 JS 夹具、诊断与单测由 `180804` 全量 CI、最终 57 项、types/lint 和 `765657` 完整 E2E 分别验证；不改写旧浏览器/CI 回执适用范围。

`39888f`、`6dd675` 的 task-local 构建辅助器复用固定依赖镜像 `sha256:98ca7d18539a8cce505f7b5ef22a5c3dea18d0e4a20e8efaf26e4af36d36527b`：只读、无网络、无挂载 inspector 核对 Linux amd64 / Node v24.22.1、当前三份依赖输入的字节 hash、`/app` 仅包含这三份文件和 node_modules，以及 Corepack 缓存仅含 pnpm 10.32.1。生成 Dockerfile 使用 `FROM deps AS builder`，保留原始 frozen install、当前源码 COPY、完整 `prisma generate && next build` 和 runner 从新 builder 复制 node_modules；runner 也取得已核验 Corepack 缓存，builder/runner 用离线版本检查，未修改产品 Dockerfile。`39888f` 后将任务 build heap 调到 1536 MiB、容器上限调到 3 GiB，继续保留 CPU0 / 1 CPU、Rayon/Tokio 各 1、UV 2 及原默认 11 场景。

`6dd675` 后的辅助器进一步改为 `FROM deps AS runner`，在全部原始运行时文件 COPY 之后，以相同 synthetic DATABASE_URL 和离线 Corepack 重新执行当前 Prisma generate。完整 builder 成功后才捕获整个 node_modules 的名称、类型、file SHA/size、mode、uid/gid 和字面 symlink target；1 MiB buffer 流式哈希、包含根和隐藏项、不跟随 symlink、不排除任何项、拒绝特殊文件。runner 必须逐项完全匹配来自 builder 的清单并输出相同 digest/count，才可继续完成镜像。同时预检固定依赖镜像与实际 node base 的 RootFS 前缀、精确 ENV、WorkingDir/User/Entrypoint/Cmd/Shell，拒绝继承构建用 DB/auth/app/provider ENV。`d587e5` 实际 builder/runner 均输出 55,432 项、SHA256 `45c1bacc3504f4b526053033baca9e335b8165acc1c38167ec2115f9b69795b7`；app image 完整 build 为 320.422 秒，随后的独立 Worker image 也构建成功。原 frozen install、完整生产 build、默认 11 场景与真实旧 Worker 证明均保留；该轮图片拓扑未完成，现由 `765657` 补齐。该方式是有记录的生成 Dockerfile 与依赖目录等值验证，不能称为未改写 Dockerfile 的构建，也不能用构建成功替代场景通过。

`2640e9` 后从同一固定 node base、当前三份输入和原 Dockerfile deps 前缀重新执行完整 frozen install，产生带 task owner label/tag 的依赖缓存。`history-dependency-cache.json` 记录 workspace、owner、tag、实际 image ID、base ID、输入 hash 和 deps Dockerfile hash；复用须匹配这些事实并继续全部运行配置/目录证明，最终验证结束才按确切 owner/tag/ID 删除。当前 `181723…2fd7ef` 使用 image `sha256:7f2fb189b4194a1187daaaa7428c369de01518ea9b3b367c4ee3979684b7b32f`、owner `ab64fa18-bbd0-4b38-91db-3faf7db4dafc`；它的原始 unused-tag/build/inspect 日志及成功缓存回执保留。后补的辅助器对未来 bootstrap 在 build 前独占写 attempt 回执，且复用时核对 deps 前缀 hash；这两项记录加固不改变当前已完成的 bootstrap。新的依赖树仅与同一次成功 builder 比较，不要求不同 frozen install 的目录元数据 hash 相同。若 build 后 inspection 失败，必须保留未证实清理项等待确切身份复核，不能删除未知镜像或当作已清理。

部署验证继续使用 `20261115T135500-previous-worker-linux-4133d8` 的真实 C2 Worker（二进制 SHA256 `f16bec7352122be5b921392313fa0b34db83d01f201bee926e0d2fe9a04a784d`），核验原 revision 2、两种拓扑的实际拒绝及 attempts/计量不变；不能用伪造 revision 响应或只跑定向场景替代。

## 最终源码与部署证据复核

最终 E2E receipt SHA256 为 `f54ca5d611a00dcb90d2b46aaffe577776a53434f0fe3dafa91844e0e8aa5bfb`。主会话对当前完整 non-`.trellis` 输入集合核验 950 文件，无 added/missing/changed，`productInputsSha256=765f4633d66a7607bef9faa023b759cb4978e68e83fbee5b4bc0d12c27cc6885`。本次 reviewer 独立比较十份关键输入的当前工作区、frozen app、receipt sourceBefore/sourceAfter，均一致；其中 `cached-dependencies.mjs=576fd42c2302aaa23c20efadb3a8f52863d58fc456bec54ee700913ee78fc9ec`、`integrated-e2e.mjs=48fa650c85952b8d329b23e41fecdff87c3f5776e973462b995f3a3ec51568d6`，F12 三份文件及 SQL/契约/两份产品 Dockerfile 也匹配。后续 task/spec/verification 修改属于记录同步，不把 receipt 中 1030 份当时文件统称为当前字节已完全不变。

当前 `integrated-e2e.mjs` 调用真实 `main()`，未传缩减的 scenarioLabels；默认清单仍为 embedded、dedicated、conflict、schema、dbdown、propagate、canvas-embedded、canvas-dedicated、canvas-mismatch、image-embedded、image-dedicated。stdout 逐项 11 个 PASS 和最后 `All 11 selected legacy, Canvas and image-history scenarios passed` 均存在，不继承任何早期九项结果。它只追加真实 prior-Worker verifier 和审计后的 task build helper，原场景/断言没有被替换。

两个 image-history 场景独立完成相同的完整流程：真实 API/Worker 在 legacy S3 与 managed LOCAL 模式生成，普通参考图上传、Canvas 上传重放/保存，四份明确源 binding 和三份 history job；默认 dry-run 的 DB/PUT/DELETE/卷内容不变，默认迁移保留三份源，显式 Canvas 退休一份源。应用停止、GC 自然 drain 后先取得 `IMAGE_READER_INCOMPATIBLE`；恢复公开读者后真实 CLI 返回 `IMAGE_POLICY_DISABLED`、readerVerified=true、无新 PUT/DELETE。经带 expectedVersion 的正式策略入口显式启用维护后恢复同一 job，quota/schedule 仍关闭。源删除故障保持 12 份 × 70 B = 840 B 及 Canvas 逻辑额度，重试成功只减源 70 B 为 770 B，逻辑资产 AVAILABLE、saved root 和账户计量保留；unknown/video 对象与第三方业务行不被接管或删除。

两个场景的实际迁移/冻结输入、原 Canvas tuple、原生成 URL 与登录封面配置都保持来源事实；浏览器 DTO、历史 proxy、Canvas resolve 和真实登录 HTML 使用当前 token 副本。每种拓扑均核对八个 LOCAL 文件的完整长度/hash 与卷 marker，force-recreate 的 runtime 容器 ID 全部改变后再次读取同一字节，额度不变；卷身份分别为 `8e8b68d8-8ff7-484c-9d44-9ac42d14ba20` 与 `105227f5-ea86-4cc3-b90a-200c26f41b24`。真实 Next optimizer、匿名 GET/HEAD/304 和鉴权下载均通过。迁移未新增 provider 调用，全场景三次模拟 provider 请求仅来自实际生成/编辑。

stdout 另有两份真实 C2 二进制拒绝证明：embedded 为 `TOPOLOGY_CONFLICT`，dedicated 为 `IMAGE_SCHEMA_INCOMPATIBLE`；原 reader revision 2、当前 3，inventory/attempts 不变。错卷 Worker、Canvas 关闭下的 generic Worker capability 缺失及新 schema rollback 拒绝也实际通过。启动就绪先于 Next，不依赖公开退休 GET，未形成 readiness 循环。

最终 task 构建 helper 保留原 frozen install、完整 Prisma/Next 与全部 Go binaries build。生成 app Dockerfile SHA256 为 `60dfef5b49769c53c14d0eb5a43c6fc4119811ffb810f8893eea84df0cbe12a6`，生成 Worker Dockerfile 为 `0e673519bd24dc44df525acbe343f8e7993f524ade547a68cfd4dae4f878fa88`；module 下载最多三次且仍受原 stage/global deadline，未换 GOPROXY、lockfile、依赖或跳过构建。完整 builder 后再核验 runner 全部 55,432 项，包含根、隐藏文件、路径/type、权限、uid/gid、file 内容/大小及字面 symlink；两份实际相同 `24a9f2ff…` digest 与可启动镜像/完整场景退出一起证明本机验证变体通过。此结论不声称未改写生产 Dockerfile 的原样镜像构建。

当前 operations image-storage §9 已同步真实公开 CLI envelope/codes/status/退出码，frontend quality-guidelines 已加入从真实序列化边界构造测试夹具的规则；相关 media、Canvas、发布、公开 DTO 和 UI 状态规范与产品契约一致。除前轮已经修复且记录的 F1–F12 外，本次没有发现新的未修复产品缺陷。

## 最终门禁与验收对应

| 验收 | 必须保留的证据 | 当前结论 |
| --- | --- | --- |
| H-A1 / 父 A7、A9 | 混合 S3、Canvas、普通参考、NULL、第三方、视频分类；重复与并发登记只计量一次；完整/additive DB。 | 通过：full/additive 各 87 项（含 27 项 C3）、Node/Go 契约和 `765657` 两种真实拓扑的分类/重复/排除证明。 |
| H-A2 / 父 A5、A7 | 永久未绑定输入、saved/run/result、精选/封面及 token URL 新输入竞争；原 tuple/快照不变。 | 通过：CI、full/additive 和 gateway 真实竞争；`765657` 验证旧冻结输入、tuple、保存根、封面及应用内 canonical/proxy 读取。 |
| H-A3 / 父 A7 | CLI 从初始化到退出零写 dry-run；实际 LOCAL/S3 校验、grant/PUT/ACK 断点与相同目标恢复，未知仍计量。 | 通过：当前 Linux CLI 全套复验、Go/DB 断点/UNKNOWN 回归；`765657` 两种拓扑的零写盘点、同 job 恢复与完成 replay，无第二份 PUT/计账。 |
| H-A4 / 父 A4、A6、A7 | 真实超额登记、COPY 准入、双份量、读回后切换、统一退休失败/恢复/重放、Canvas 逻辑额度保留。 | 通过：DB/Go 的真实超额/准入/目标校验；`765657` 默认保留源、双份 840 B、故障仍计量、确认退休后 770 B 与逻辑资产/账户/根保留。 |
| H-A5 / 父 A1、A8 | embedded/dedicated 实际生成/上传/Canvas/迁移/重建同卷读取；真实 C2 Worker 与错卷拒绝、readiness 无循环。 | 通过：完整默认 E2E 两份 image-history result=passed，真实旧 Worker、错卷/generic 能力/rollback 拒绝和八个文件重建后字节不变。 |
| H-A6 / 父 A1–A10 | 当前快照 lint/tsc/全量单测/Go、Worker/Canvas/gateway DB、migrations/Prisma 零差异、完整默认11场景 E2E；已清理 UI/隐私与 v0/v1 计费回归。 | 通过：`180804` 完整十阶段 CI 加 F12 两套 57 项及最终全局 types/lint，全部 DB/migrations/Go vet/build/browser/Linux CLI，`765657` 完整 11 场景及独立最终资源清理。最终应用/SQL/Go/共享契约与适用代码门禁一致；父 A1–A10 正式汇总由主会话更新。 |

Lint：通过（`183856-lint-ed3d80`）。TypeCheck：通过（`183838-types-aec1c4`）。Tests：通过（完整 CI 168 套/2150 项 + 最终两套/57 项、Go/契约、真实 DB 与 Linux CLI，各自范围如上）。Build/E2E：通过（原生完整构建与 `765657` 记录的本机生成 Dockerfile 变体/全部 11 场景）。本次复核没有已确认而未修复的产品问题；C3 可由主会话关闭元数据并完成父任务收尾。

未执行任何真实 R2、生产数据库、生产迁移/删源或部署。实际站外原 R2 链接不属于删源后的兼容承诺。

## 2026-11-16 交付补验（当前最终结论）

本节记录最后交付修正后的当前快照。上文 `765657` 及 `productInputsSha256=765f4633…` 对应修正前的 950 份输入，其成功结果和全部早期失败回执保持原样。当前 950 份输入由 `20261116T023915-ci-bounded-c5b0f5` 和新的完整 E2E `20261116T025107-history-integrated-e2e-f78bd8` 共同验证，摘要为 `da14302ceb1264c4baa15caeb0e802568456fc038ab4308e6c325d23e61efac2`。

与 `765657` 的实际差异恰好五个文件：`.gitattributes`、C1 `20261112100000_canvas_image_storage/migration.sql`、两份 media/Canvas `schema.json` 及 `featured-gallery.test.tsx`。修改分别是 checkout 属性、一个 SQL 文件末尾空行、两处对应 migration-chain SHA 和既有测试的异步等待；应用/Worker 逻辑、完整 SQL 函数体、catalogue 对象及 UI 行为未改变。最终 E2E 使用这些新字节重新执行默认 11 场景，旧成功回执继续用于其原快照范围。

### 交付检查中的修复

| 编号 | 问题与修复 | 独立复核 |
| --- | --- | --- |
| C3-F13 | `.gitattributes` 原先仅固定两份 C1 migration 的 LF，C2/C3 与原 Canvas 依赖未固定；本机 `core.autocrlf=true`。TS/Go schema 单测会将 CRLF 转为 LF，但 `migration-safety.mjs:listLocalMigrations` 对原始 Buffer 计算部署 checksum，单测通过不能证明新 Windows checkout 的原始字节稳定。实施者增加三条精确规则，固定全部五份共享链 migration 为 `text eol=lf`。 | `git check-attr` 五路径均为 text:set/eol:lf；只读 `git -c core.autocrlf=true cat-file --filters --path=<各路径>` 使用已知 LF HEAD blob，五路径输出与 HEAD 原始字节相同。未固定的 SQL 控制路径实际产生 883 对 CRLF，转换回 LF 后等于原 blob。未写临时 index、Git object 或 checkout 文件。原发布 Canvas SQL 的 working/HEAD 均保持 SHA256 `1247ec0bb7985a465028e4e05abb0b0ffa6ce80e964d57b37351c2943c3513f4`；只增加属性，没有修改发布 SQL。 |
| C3-F14 | 未发布 C1 Canvas migration 在 `git --no-index --check` 中暴露 EOF 多余空行。实施者只删除最后一个 `0A`，22174→22173 字节；主会话在两份共享 schema chain 中各替换一次相应 SHA。 | 新 SQL 精确等于 `.before` 去掉末尾一字节，完整 13 个函数定义及其他所有字节相同；新 SHA256 `6f6d8fef83291f2888f5f5a47a2213c8131f027ffd8a7116b5549263d2513b3c`。media/canvas JSON 与 `.before` 的原始差异均仅一次旧 SHA→新 SHA 替换，当前 SHA 分别为 `a76efef8aa1542019d9429940f7d26786d48da252d39c258d473ba03b36308bd`、`a198a0aa87bf1d868ee897d4f7dcf946bb4ae632da3b456787454eb83ab1592b`。每份五条 chain 均匹配实际 SQL 原始 SHA；820/201 catalogue 对象完整不变。C2/C3 SQL 与保存的原字节完全相同。 |
| C3-F15 | 首轮资源有界 CI 通过类型/lint 后，旧 gallery clipboard fallback 用例在状态文本出现后立即检查焦点，未等待被动 effect 完成。实施者仅将已有 focus/selectionStart/selectionEnd 三个断言包进 awaited `waitFor`。 | 真实 hook 即使 clipboard 缺失也 await Promise，随后提交 manual feedback；`GalleryCard` 的 passive effect 再 focus/select。DOM 状态出现不等于 effect 已完成。新文件 SHA256 `4cfd35386e6fc774d368b243e33712fe7063cdf1c549b4b3ea4e52e2a4c64827`，其余原始字节、CRLF、完整提示词、denied/absent mocks 与全部断言保持原样。hook/card 生产文件与 `765657`、失败 CI 和当前字节完全相同；没有生产焦点行为修正。 |

EOL 前字节保存在 `receipts/before-delivery-eol-20261116-f8411648/`；测试前字节保存在 `receipts/before-focus-sync-20261116-c444ad5d/`，后者与失败 `6e651f` 及旧 `765657` 的测试 SHA `3dbd54f50d03b4ad417d25b834c1531fc2ec498786ceb0b960eb0fe6379aeeba` 一致。reviewer 只进行静态/回执检查与本文件补录，源修改、schema manifests、隔离执行和资源操作由主会话及其明确所有权的实施者完成。

### 新字节的实际门禁

| 回执 | 实际结果与边界 |
| --- | --- |
| `20261116T021641-ci-bounded-802b4e` | exit 134、16.675 秒；脚本测试/Prisma/类型通过，ESLint 在 7.670 秒以明确 `Zone Allocation failed - process out of memory` 退出，未报告 lint rule violation。后续 stages 未执行；原失败保留。 |
| `20261116T022306-ci-bounded-6e651f` | exit 1、179.520 秒；类型/lint 通过，167 套/2149 项通过，唯一失败为旧 gallery fallback 的即时焦点断言；没有 OOM/timeout，后续 Go/contracts/build 未执行。原失败与旧测试字节保留。 |
| `20261116T023830-test-128545` | exit 0、8.219 秒；修正后的实际 gallery 套件 24/24 通过。 |
| `20261116T023915-ci-bounded-c5b0f5` | exit 0、222.859 秒，完整十阶段全部通过：脚本回归、Prisma、全局 TypeScript/lint、168 套/2150 项、Worker TS/Go 契约、Go 全量测试/构建、完整 Next build（29.216 秒）。receipt SHA256 `301253188c5354c84f6ee7f42af1a1a7e2d0ab57d933c48f6ed1b667a56ca21f`。 |
| `20261116T024314-history-catalog-bbe283` | exit 0、9.315 秒；从实际新数据库捕获 media 820 / Canvas 201 项，reviewer 将完整数组与当前 manifest 逐项比较相等。capture SHA 为 `e8983c905bd04acd02272b31f21efb528de29daeff087347ca73108bff8e5b7b` / `b408e4af9b1bbbbf6aaa44887faa40b18e51449d36ecfe75654814c6894a6c19`。 |
| `20261116T024338-canvas-db-a4e74b` | exit 0、70.154 秒；full/additive 各四套、87/87 项，包括 27 项 C3，验证当前 raw checksum、schema、真实状态机及竞争。 |
| `20261116T024526-worker-db-4e4b18` | exit 0、11.966 秒；当前 TS 六项和 Go disposable DB wrapper 完整通过。receipt SHA256 `cddec45b90e6d76d9918266279c2211c44fc1fbc5ec71491e906e06938e70b07`。 |
| `20261116T024608-gateway-db-eea182` | exit 0、12.219 秒；当前 TS 六项和 Go gateway 真实 DB 完整通过。receipt SHA256 `e27d8a2f0d6ace290d31a73f7d13b1876a06d4550062efcc7874db73306abe31`。 |
| `20261116T024637-migrations-061d91` | exit 0、50.509 秒；完整 deploy/baseline/Prisma 零差异与 rollback 场景通过。receipt SHA256 `064cd967810cb401591af6c8e8c48c536f7ffdc16dd5e3fc540fea06c607210c`。 |
| `20261116T024744-history-integrated-e2e-5865be` | exit 2、2.448 秒；被已退休 cache tag 的残留 record 阻断，尚未 build 或执行任何场景。主会话核实旧删除回执后，将确切旧 record 以原字节归档为 `history-dependency-cache-retired-20261116-027e9df8.json.before`；没有改源码或继承早期场景结果。 |
| `20261116T025107-history-integrated-e2e-f78bd8` | exit 0、1600.576 秒；全部默认 11 场景实际通过，包含两个 history 拓扑及真实旧 Worker。receipt SHA256 `cdf1d0fff9836396feb175148702ade0745fb90c0d5ddb6288743c9453154e2a`，sourceChanges/snapshotModifications 均为空，未继承 caller 配置。 |

两个刷新 CI 的 384 MiB old-space / 4 MiB semi-space 上限仅作用于 task-local 外层 CI 与默认 ESLint，完整保留 deny-env；既有 TypeScript/build 1536 MiB、Vitest 512 MiB/两 worker 及十阶段/断言/截止不变。实际成功来自 `c5b0f5`，不能将两个失败 CI 合并成成功；该覆盖在后续 DB/catalog/migrations/E2E 前恢复，生产配置和 helper 源码均未变。上述新回执的 source/snapshot drift 全部为空。

### 新完整 E2E、源边界与清理

`f78bd8` 从当前三份 package/lock 输入执行新的原始 frozen install，登记 task cache owner `b551ce24-859d-4c16-8b67-d2cdda83427d`、image `sha256:049c6f5b898d0e93065aecea08c6b82e203e8ee142cecf0d545332b59431aed0`。app/Worker 构建分别 364.209/107.474 秒成功；生成 app Dockerfile SHA256 为 `b840b2586c1f0be423fcb7c3edea66bc88ce3c69930579cf8daada61645f4828`，Worker 变体仍为 `0e673519bd24dc44df525acbe343f8e7993f524ade547a68cfd4dae4f878fa88`。原产品 Dockerfile、原 install/完整生产 build、至多三次 Go module 下载和全部 binaries build 保留；builder/runner 的全部 55,432 项逐项相等，同为 SHA256 `2ec77b87d24425b94c5f7d8a2e4be988a042178c5115a266a5f78c39fe6e540d`。构建结论仍为已记录的 task Dockerfile 变体及依赖树等值验证。

reviewer 从 stdout 独立核对恰好全部默认 11 个 PASS 与最终 all-11 结果。两个 history result 均 passed：四份 binding、三份 job、三源保留/一源退休、八份 LOCAL 文件、770 B；原 tuple/冻结输入、dry-run 零写、实际 optimizer、容器重建后相同字节均通过。两个拓扑均真实经历 reader 离线拒绝→公开 reader 通过后策略 disabled 拒绝→显式 CAS 启用→同 job 恢复→源删除失败仍计量→成功重试仅释放源 70 B，Canvas 逻辑资产/根/账户量保持。卷 ID 为 `97167bde-6642-46ca-bbe2-1406d3b0d6fd` 与 `c0e71cc0-22ba-4625-bf03-6c968f14cdee`。原 C2 `f16bec…` 二进制分别以 TOPOLOGY_CONFLICT / IMAGE_SCHEMA_INCOMPATIBLE 拒绝，两次 inventory/attempts 不变；错卷/generic capability/rollback 拒绝仍执行。

`final-current-source-audit-20261116-b43e9d43.json`（SHA256 `7e7b4d764182750a42aa1238a4d5d11ead516448d50ec24e242c18004b3053cf`）确认当前完整 non-`.trellis` 文件集合、950 份原始 hash 与新 CI/E2E 相同，无 added/missing/changed；记录 index 为空、HEAD `a8c2bc9b3d65fc6970fc895f109aec9728b10290`。reviewer 另将这 950 份当前/frozen 文件逐个与两个实际回执比较一致，并核对上述五份与旧 `765657` 的差异。task/spec/verification 的后续补录独立于此产品输入集合。旧浏览器 `4b17cb` 继续对应其原字节的 UI/runtime/SQL body 行为证据，当前 metadata/checksum/测试差异已由新 DB/CI 和完整新 E2E 验证；未将旧浏览器标成新字节执行。

`final-resource-audit-20261116-6565af27.json`（SHA256 `8ee74bbdb3d1a36c394da2887503b60324f92530bce3c0580cb61a678d831091`）在相同 daemon `cfd4f668-c4c9-40ef-b114-b07c4c944b18` 核验新 E2E owner `6b3ebd8c-fddf-479e-bb1a-ea31d68526e0` 的容器/网络/卷/镜像均为空。独立 cache 的确切 ID、唯一 tag、相同 owned RepoDigest 和无使用容器经过两次核对后，非 force 移除；原 marker 归档为 `history-dependency-cache-final-20261116-6eb71f2d.json.before`，SHA256 `9f1eace2da281428826ec0315e044dad87b64649da261a7a29222118e7593e7e` 原样保留，marker 不存在。reviewer 已读取审计、核对其 hash/命令结果及归档实际字节；没有生产资源操作。

最后规范复核包括 `release-hardening.md` 的 task cache 镜像/marker 生命周期规则：精确 ID/owner/唯一 tag/无使用者，RepoDigest 仅允许同一 owned repository 和同一 image 摘要；非 force 删除并验证 tag 不存在后，以原 SHA 和核实路径归档 marker，失败保留原回执。该规则与本次实际清理、陈旧 marker 失败及归档证明一致。reviewer 同时核对最新 `checks/gates.json` 的 23 份通过回执的实际 hash/exit/duration/空 drift，八份当前 delivery gate 的输入差异均为空；`previousFinalIntegration` 保留旧成功及其源码/清理/CI 边界。

当前最终 Lint、TypeCheck、全量 Tests/Go、Build、全部 DB/migrations、默认 11 场景 E2E、源字节与 owned 资源清理均通过。C1/C2/C3 全范围门禁与 H-A1–H-A6 的结论通过；已确认的产品/交付问题全部修复，无未解决产品发现。父 A1–A10 汇总、其他任务 gates/checklists、commit plan 与归档仍由主会话收尾，本补录没有 stage/commit/push 或重跑重型测试。

## 用户确认后的工作提交（2026-11-16）

用户已回复“没问题”，一次批准父commit-plan的两笔工作提交、C3/C2/C1/父任务归档和journal收尾，不push。Root再次核对351个候选及六个GHCR排除文件与readiness审计原SHA相同；功能暂存的272个路径、cached空白和各Git blob均核对通过，共享migration原字节保持。功能提交为 `1368518dfe0e2b3d9a78789f022b4e0859240ff6`，实际提交范围与清单完全一致。首次提交因本机作者未配置而退出128、未创建commit；重试只沿用最近八笔Git/Trellis一致的0401lucky身份到本轮进程，没有改全局/仓库Git配置。当前提交任务记录，之后按获批顺序归档/journal；本段是Git收尾记录，不改变前述验证输入边界。

## 已完成的工作提交与归档（2026-11-16）

两笔工作提交依次为 `1368518dfe0e2b3d9a78789f022b4e0859240ff6`（272个功能/spec路径）和 `67b0edfd777629bd1dcd37117a1d0e892a115c9e`（79个任务记录路径），实际范围均与用户一次批准的清单一致。本任务已通过native `task.py archive`移动到 `.trellis/tasks/archive/2026-11/11-12-image-history-migration`，status为completed，quality gate保持passed；归档Git提交只暂存本任务原路径删除及新路径文件。journal由父任务统一记录，两笔工作提交先于全部归档/journal提交，未push，六份既有GHCR文件字节保留。

最终session第9次记录已写入 `.trellis/workspace/0401lucky/journal-1.md`，关联两笔工作提交；本任务commit-plan收尾状态completed，原验证回执/源码边界未变化。
