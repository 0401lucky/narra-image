# 图片存储父任务集成验收

状态：C1/C2/C3的功能、工具、文档及当前最终字节快照完整隔离验收通过。两笔获批工作提交 `1368518dfe0e2b3d9a78789f022b4e0859240ff6` 和 `67b0edfd777629bd1dcd37117a1d0e892a115c9e` 已完成，实际272/79个路径与清单一致；三个子任务及父任务按序归档，journal第9次记录已写入 `.trellis/workspace/0401lucky/journal-1.md`。质量门禁passed，所有父A1–A10及C3 H-A1–H-A6闭合；未push或执行生产操作。

## 验证边界

用户批准的交付是图片代码、迁移工具、操作文档和隔离验证。所有数据库为本轮临时 PostgreSQL；对象服务为固定图片夹具，LOCAL 文件在核实归属的临时目录或卷内。未连接真实 R2 或生产数据库，未执行生产迁移、源删除或部署。Git工作提交及归档/journal依据随后一次明确确认执行；未push。

C1/C2 的验证记录保留各自历史输入；最终 C3 门禁负责覆盖新修订的受影响路径。失败命令保留原退出码，不拼接部分测试冒充整次成功。详细回执及 SHA 见各子任务 `verification.md` 和 `checks/gates.json`；原始日志、二进制和截图存于 gitignored `.runtime`。

## 已取得的集成证据

以下保留各子任务及原最终快照的实际结果；表格最后八项为当前最终快照的成功门禁与独立审计，旧回执不改写成新输入。

| 证据 | 结果 |
| --- | --- |
| C1 `20261115T043438-local-http-c508dd` | 无 S3 配置下真实 Next/Go 图片生成、普通上传、Canvas 导入、读取/下载/优化器、重启读取；4 个 LOCAL 文件 / 280 字节。 |
| C1 `20261112T101648-local-crossprocess-ea4860` | Linux 两容器跨进程、重建后读取同一持久目录的原字节。 |
| C2 `20261115T132509-retention-http-f8a633` | 真实管理员浏览器预览/取消/确认、关闭浏览器后执行、Worker 重启恢复、重放不重复释放；删除 70 字节且任务/提示词/计费保留；六项交互检查及五张截图已复核。 |
| C3 `20261115T162157-ci-bounded-88eb1c` | 原完整十阶段 CI 通过，含 lint、全局类型、168 套 / 2146 项、Worker TS/Go 契约、Go 全量测试/构建、完整 Next 生产构建。 |
| C3 `20261115T180804-ci-bounded-12d932` | 修复迁移部署夹具的策略前置后，完整十阶段CI再次通过；168套/2150项。之后三份部署夹具/单测修正公开CLI外壳，由下面的57项回归、全局types/lint及最终11场景单独验证。 |
| C3 `20261115T160229-canvas-db-be1df8` | 完整和增量历史各四套 / 87 项通过，含 27 项历史迁移回归；额度/引用/清理/迁移竞争使用真实数据库。 |
| C3 `20261115T162720-worker-db-6747d6`、`20261115T162835-gateway-db-629223` | 当前真实 Worker/Gateway DB 通过，含 backfill 排除、回滚未决事实、精确输入别名、永久根及并发重放。 |
| C3 `20261115T163001-migrations-e83e1d` | 完整迁移、回滚预检、Prisma schema 零差异通过。 |
| C3 `20261115T170859-go-vet-c34f6b`、`20261115T170916-build-56192a` | 最终 Go vet 与完整原生 Next 生产构建通过。 |
| C3 `20261115T171857-retention-http-4b17cb` | 最终源码真实 Next/Go/PostgreSQL/Chrome 回归通过，六项检查、五张截图逐项复核；350→280字节，浏览器关闭/Worker重启/重放及历史状态验证均通过。 |
| C3 `20261115T152911-history-linux-tests-d0ed0c` | Linux CLI 实际命令测试通过，递归 inotify 验证默认初始化/预览无 transient 写入；不代替实际迁移拓扑证明。 |
| C3 `20261115T180101-history-linux-tests-24717a` | 当前全部Go/contract输入下重跑Linux CLI通过，5.107秒，默认初始化/预览递归inotify零变更及命令/取消/输入边界通过；原容器精确清理完成。 |
| C3 `20261115T183728-test-d0c4e5`、`20261115T183838-types-aec1c4`、`20261115T183856-lint-ed3d80` | 公开CLI外壳修正后的两套57项、全局类型和lint通过（0 errors、9项既有warnings）；产品Go/SQL/API/UI未变，不改写之前2150项CI的输入边界。 |
| C3 `20261115T184531-history-integrated-e2e-765657` | 同一次命令完成全部默认11场景，exit0、1278.531秒；实际embedded/dedicated历史复制、默认策略拒绝/正式启用/同任务恢复、源退休失败重试、同卷重建、错卷/实际旧Worker拒绝全部通过。 |
| C3 `final-resource-audit-20261116-617547e9.json` | 复核原daemon上本轮E2E的容器/网络/卷/镜像均不存在；唯一owner/tag/ID、无使用容器的独立依赖缓存以非force删除，tag不存在。原失败回执保留。 |
| 当前 `20261116T023830-test-128545`、`20261116T023915-ci-bounded-c5b0f5` | 旧首页焦点/全选断言改为等待passive effect后，单套24项及同一次完整十阶段CI通过；168套/2150项、全局types/lint、TS/Go契约、Go全量测试/构建和完整原生Next生产构建，222.859秒。 |
| 当前 `20261116T024314-history-catalog-bbe283` | media 820、Canvas 201项实际catalogue通过，与原对象数组逐项一致；共享迁移的新原字节SHA通过实际结构探针。 |
| 当前 `20261116T024338-canvas-db-a4e74b` | 完整/增量历史各4套/87项通过，包含真实额度、保护、清理/迁移/新引用竞争，70.154秒。 |
| 当前 `20261116T024526-worker-db-4e4b18`、`20261116T024608-gateway-db-eea182` | 实际Worker/Gateway数据库专项均通过，11.966/12.219秒。 |
| 当前 `20261116T024637-migrations-061d91` | 全部迁移场景及Prisma schema零漂移通过，50.509秒。 |
| 当前 `20261116T025107-history-integrated-e2e-f78bd8` | 同一次调用完成全部默认11场景，退出0、1600.576秒；两种图片拓扑均实际完成复制校验、策略拒绝/启用/同任务恢复、源退休失败重试、同卷重建与原URL读取，并拒绝真实旧Worker。 |
| 当前 `final-current-source-audit-20261116-b43e9d43.json` | 950项非 `.trellis/` 文件集合及原字节SHA，与完整CI和最终E2E完全相同；两个任务构建辅助器也一致。提交前审计时index为空，HEAD为 `a8c2bc9b3d65fc6970fc895f109aec9728b10290`。 |
| 当前 `final-resource-audit-20261116-6565af27.json` | 原daemon上E2E owner `6b3ebd8c-fddf-479e-bb1a-ea31d68526e0` 的容器/网络/卷/镜像均为空。专属依赖cache的ID/owner/唯一tag/同一owned digest和无使用容器经两次核对后非force删除；marker原字节归档为 `.before`，无陈旧marker。 |

当前历史 SQL SHA-256：`12459548628adecd2f1cde186c0485ebe52d3dd5e44eb5f1b44abafe7ae1eecd`。实际 catalogue 含 media 820、Canvas 201 个对象。storage/reader/executor 及 Canvas storage/GC revision 为 3；scene/run wire 仍为 1。

## 父级验收对应

| 验收 | 证据与行为 | 当前状态 |
| --- | --- | --- |
| A1 | C1 无 S3 的实际读写/下载/重启；最终11场景中的C3两种容器部署实际生成、上传、导入和同卷重建。 | 通过。 |
| A2 | C2 浏览器真实管理员用量/预览/确认/结果；当前 API/组件测试验证普通用户拒绝与准确字节字符串。 | C2 及最终 C3 浏览器回归通过。 |
| A3 | C2 浏览器关闭仍执行、Worker 重启与任务重放；当前真实 DB 两连接 claim/finalize 幂等。 | 已有通过证据。 |
| A4 | 当前真实 DB 最后额度竞争、按最旧可清理对象回收、在途预留和历史双副本计量；上游前拒绝；两种实际迁移拓扑精确核对副本保留/删除后的物理量。 | 通过。 |
| A5 | 当前 DB/Go/Node 验证精选、永久输入/封面、saved/run/result 根、写入保护、Canvas 七天与 active GC lease；实际Canvas纳管停止执行者并等待租约自然到期，原tuple和逻辑量保持。 | 通过。 |
| A6 | C2 真实删除/恢复/重放及已清理占位；当前 DB/Go UNKNOWN/失败/迟到回执不减量，任务与 v0/v1 计费事实保留；最终拓扑核对源删除失败保持量、重试后精确释放。 | 通过。 |
| A7 | 当前 DB/Go 分类、显式源绑定、正向长度/hash 核实、目标 READY 后切换、可恢复 COPY 与默认保留源；两种拓扑实际复制/原URL读取/停站恢复，前端挂载后吸收当前媒体URL。 | 通过。 |
| A8 | Compose共享持久卷、两镜像CLI、严格修订/卷/Worker能力与rollback；两种实际部署重建仍读原字节，真实C2 Worker分别因拓扑冲突/新schema拒绝，计量和attempt不变。 | 通过。 |
| A9 | 当前混合历史夹具将视频、video poster、第三方与未绑定来源排除在迁移/删除之外；两种真实图片拓扑核对混合清单和保留源，未知项明确保留。 | 通过。 |
| A10 | 当前全量 Node/Go 和真实 Worker/Gateway DB 覆盖预算、1–4 张 / 每图 50MiB、部分持久化/UNKNOWN、不重发上游及原 v0/v1 退款差异。 | 已有通过证据。 |

## 最终收尾

当前最终11场景回执SHA256为 `cdf1d0fff9836396feb175148702ade0745fb90c0d5ddb6288743c9453154e2a`，stdout为 `7eb94d2d536121befab8e1dacb835d2d2adadc0567ef83727f51774c4738e4aa`。独立审计逐一重算当前950个非 `.trellis/` 输入，与新完整CI及最终E2E无新增/缺失/变化；集合摘要为 `da14302ceb1264c4baa15caeb0e802568456fc038ab4308e6c325d23e61efac2`。当前两个构建辅助器也与成功快照相同。

两种实际图片拓扑分别验证4个来源绑定、3个持久任务、3个源保留/1个退休、8个LOCAL文件和最终770字节。任务构建变体保留原安装/完整Next及Go构建/启动/全部场景，Linux应用/Worker完整构建分别为364.209/107.474秒；builder与runner逐项核对55,432个依赖条目，摘要同为 `2ec77b87d24425b94c5f7d8a2e4be988a042178c5115a266a5f78c39fe6e540d`。这是核实的任务构建变体，不声称生产Dockerfile原样构建或真实R2服务验收。

C3 `checks/gates.json` 保留23份实际通过回执，将每份相对当前最终输入的差异重新计算；原 `765657`、其950项摘要 `765f4633d66a7607bef9faa023b759cb4978e68e83fbee5b4bc0d12c27cc6885` 及旧清理另存在 `previousFinalIntegration`，不覆盖历史边界。三个当前失败（native ESLint OOM、焦点时序、陈旧cache marker预检）保留原退出码；后续成功回执独立绑定。父A1–A10及C3 H-A1–H-A6已完成隔离验收；两笔工作提交与逐文件范围见 `commit-plan.md`。用户已按workflow §3.4一次确认，功能提交 `1368518dfe0e2b3d9a78789f022b4e0859240ff6` 的272个路径与清单一致，当前提交79个任务记录，之后依序归档C3/C2/C1/父任务并记录journal。六份既有GHCR文件字节未变，不纳入本次提交，未推送。

## 已完成的工作提交与归档（2026-11-16）

两笔工作提交依次为 `1368518dfe0e2b3d9a78789f022b4e0859240ff6`（272个功能/spec路径）和 `67b0edfd777629bd1dcd37117a1d0e892a115c9e`（79个任务记录路径），实际范围均与用户一次批准的清单一致。本任务已通过native `task.py archive`移动到 `.trellis/tasks/archive/2026-11/11-12-local-media-retention`，status为completed，quality gate保持passed；归档Git提交只暂存本任务原路径删除及新路径文件。journal由父任务统一记录，两笔工作提交先于全部归档/journal提交，未push，六份既有GHCR文件字节保留。

## 归档与session记录完成

四任务归档提交依次为 `2d8830252f578d5d84aad8713325189a06b23315`、`d5ed97563cac177cbc899fec54c1ed0a64c7b4de`、`7d570e77d8207e239f8bdd5be99b569623ff94df`、`9749ecbe533ddd373bc950e54da9aec0f0846152`，均在两笔工作提交之后。native `add_session.py` 第9次记录仅引用两笔工作提交，位于 `.trellis/workspace/0401lucky/journal-1.md`；父实施清单全部完成，任务状态completed，最后journal提交收录本轮session与最终完成元数据。六份原GHCR文件原字节保留，未推送。
