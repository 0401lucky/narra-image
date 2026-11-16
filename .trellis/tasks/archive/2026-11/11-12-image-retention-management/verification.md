# C2 图片清理与管理审查

## 当前结论与范围

2026-11-15，C2 质量门禁通过。`trellis-check` 已完成 SQL 状态机、Node/Go 接口、执行器、管理员操作及图片可用性消费路径的全范围审查，四个跨层行为问题、一处实际 lint 错误及关键数据库覆盖缺口均已修复。最终版本的全量 Vitest 为 161 套、2065 项全部通过；lint、TypeScript、Worker TypeScript/Go 契约、Go 全量测试/构建、新 SQL 的 full/additive 各 60 项真实 DB、Worker/Gateway DB 和迁移验证均有实际通过回执。

门禁由同一最终产品源码的分阶段证据组成：`20261115T075820-ci-bounded-1e367d` 前九阶段通过，最后的 Windows 原生构建当时退出 134，因此该次完整 CI 仍记为失败；随后 `20261115T132252-build-55c84c` 的完整原生 Next 生产构建通过，`20261115T132509-retention-http-f8a633` 的实际 Next/Go/PostgreSQL/Chrome 链路及六项浏览器检查通过，主会话已复核全部五张截图。此前 Windows 原生内存失败、Linux Docker EOF 失败与诊断性类型检查分别保留，不改写失败结果，也不以诊断代替完整构建。

审查依据为本任务 `prd.md`、`design.md`、`implement.md`、`check.jsonl`、C1 的 `research/retention-data-handoff.md` 及相关 media/Canvas/前端/发布规范。C1 已验收范围以 `../11-12-image-storage-foundation/verification.md` 为准；C2 变更归属对照 C1 最后 CI 回执的源码指纹，不能将整个脏工作区都认作本任务新增代码。

本轮不操作生产数据库、真实桶或实际用户图片，不执行 C3 历史盘点/迁移。验证工作区、测试调度和最终回执均由主会话管理；审查代理没有修改共享验证副本或提交代码。

## 已修复发现

### 1. 作品页刷新后忽略已清理状态，预览持有过期图片对象

- 文件：`src/components/works/my-works-board.tsx`、`src/tests/unit/my-works-board.test.tsx`。
- 原行为：组件仅用 `useState(initialItems)` 初始化列表。`router.refresh()` 带回同一图片的 `cleaned` 状态后，本地列表仍显示旧图片，已打开的 `zoomedWork` 也继续提供下载按钮。
- 修复：只在收到新的 props 数组时，按已有图片 ID 合并 `availability`，保留已加载分页、本地删除、搜索和选择；已知 `cleaned` 不可被迟到 `available` 覆盖，临时 `unavailable` 可恢复。预览及其下载操作读取当前列表中的图片状态。
- 回归：真实组件先打开可用图片，刷新为清理态后移除图片及预览操作，再输入旧快照仍保持清理；另验证第二页、搜索和选择不丢失，以及临时不可用恢复。没有引入全量 props 覆盖本地状态的 effect。

### 2. Node 聊天兼容接口绕过图片可用性校验

- 文件：`src/app/v1/chat/completions/route.ts`、`src/tests/unit/external-v1-routes.test.ts`。
- 原行为：非 gateway 分支把 `job.images` 直接转成 Markdown；成功任务查询虽包含媒体状态，但该端点仍可能返回已清理图片地址。其他 Node 图片端点及 Go 聊天端点已有校验。
- 修复：先调用现有 `formatImageGenerationData(job.images, "url")`，再沿用原 Markdown 和 JSON/SSE 结构。已知不可用图片返回现有 `IMAGE_UNAVAILABLE` 错误，保留任务与计费事实。
- 回归：`DELETED` / `DELETING` × 普通 JSON / `stream=true` 四个实际路由用例均要求 HTTP 410，响应不得含失效 URL；既有正常 JSON、SSE 与 gateway 测试继续保留。

### 3. 存储设置页在 try/catch 内创建组件，实际 lint 失败

- 文件：`src/app/admin/settings/storage/page.tsx`。
- 证据：`20261115T053436-ci-bounded-7b5a38` 在 scripts、Prisma、类型检查后，因 `react-hooks/error-boundaries` 拒绝 try/catch 中的 `<StorageManager>` 而退出 1。
- 修复：try/catch 只加载有明确类型的页面数据，组件与错误提示统一在外部构造；管理员鉴权保持独立，数据不可用时继续显示原提示。
- 没有为可逆的 JSX 结构调整新增镜像测试；由实际 lint、类型和页面构建复验。

### 4. managed Canvas 在新清理器中的关键分支缺少真实 DB 覆盖

- 文件：`src/tests/integration/canvas-contracts/image-retention-db.test.ts`，由 data 代理按其所有权补齐；补测时先保持生产 SQL，实际执行随后发现下述第 5 项。
- 原有 11 个 C2 用例覆盖生成图及普通引用；C1 的七天测试使用旧 Canvas GC，不能证明新执行器的 Canvas 逻辑额度收尾。
- 新增 3 个用例，当前共 14 项：七天内图片及保存/永久输入根不被清理；两份物理副本逐次删除，最后一份确认消失后才清一次逻辑额度；UNKNOWN 接管拒绝旧物理 token，并续期已过期的 Canvas token，重放不重复计量。
- 补测已静态复核。`20261115T072815-canvas-db-2fb293` 的 full 场景中，七天/根及双副本计量用例通过，UNKNOWN/过期 Canvas token 用例失败；整体为 59/60，不能标记 full/additive 全部通过。历史年龄夹具的专用准备边界见下文。

### 5. UNKNOWN 恢复时先终结主图片，导致 Canvas 删除令牌无法续期

- 文件：`prisma/migrations/20261115090000_image_retention/migration.sql`，`image_finish_maintenance_object`；修复由 data 代理完成，检查代理只读复核。
- 实际证据：上述新 DB 用例在最后物理回执后抛出 `CANVAS_LEASE_LOST`。旧顺序先把 `ImageAsset` 设为 `DELETED`，再更新仍为 `DELETING` 的 `CanvasImportAsset.deleteToken`；C1 关联 guard 要求此时主图片仍为 `DELETING`，因而拒绝续期。
- 修复顺序：所有物理对象已无 accounted/reconciliation 后，先在两层逻辑记录都为 `DELETING` 时续过期 Canvas token，再依次将 `ImageAsset` 和 `CanvasImportAsset` 置为 `DELETED`，最后一层同时释放逻辑额度。
- 已核对原锁序、根/旧 expiry 校验、物理 token/CAS/重放早期判断和 SOURCE_RETIREMENT 分支均保持；全部修改仍在同一短事务内，任一步失败仍回滚计量。没有修改 C1 guards 或弱化 14 项回归断言。
- 新 migration SHA-256：`2d65ec945b167fac0df3a8e08d6f6d92cbdcf9545dd23b5eaa05d978ecf2bdcb`。`20261115T073350-retention-catalog-56af4a` 采集的新函数 MD5 `52d187a9be96aa5ef871d4d59f9afd6c` 已同步到 expected catalogue；`20261115T073819-canvas-db-0941d9` 的 full/additive 各三套、各 60 项全部通过，含全部 14 个 C2 用例，实际修复闭环。

### 6. 会话缓存复制等价 canonical 对象，导致工作台 effect 无限回写

- 文件：`src/components/create/hooks/use-conversation-generations.ts`、`use-studio-jobs.ts`、新增 `generation-value.ts` 及两个对应 hook 测试，由 UI 代理修复、检查代理只读复核。
- 定位证据：`20261115T074004-ci-bounded-aa02a2` 的 module/case reporter 显示 `generator-studio-origins.test.tsx:251` 同账户新 props 用例未完成。C2 的 `mergeGeneration` 对等价输入仍复制任务和图片数组，`updateGeneration` 无条件 publish；`GeneratorStudio` 发现 `canonical !== generation` 后继续回送，形成真实更新循环。不能将此前全部 OOM/超时仅归因于环境。
- 修复：合并返回实际变化标记，同引用、语义等价及已拒绝的旧状态不更新缓存、不 publish；只有需要修正图片可用性时才构造相应新对象。现有 studio 的语义比较原样抽为 feature 内纯 helper；外部输入仍在所属缓存边界复制，真正的新 canonical 无额外修正时保持身份。
- 已核对：`acceptGeneration` 对合法归属仍返回接受成功，替换/删除归属仍计为变化；终态与时间优先级、按图片 ID 保持 cleaned、旧任务元数据携带新清理事实以及 unavailable 恢复均保留。没有改变 `GeneratorStudio` 的 effect 或缩减原组件用例。
- 回归：新增跨 hook 重复 canonical/等价副本/迟到 available 回送，要求列表和 canonical 在一次清理更新后稳定；独立 no-op 用例保留分页与选择。`20261115T075011-test-354dde` 已实际通过五套/89 项，其中原 `generator-studio-origins` 26 项完整执行。`GeneratorStudio`、origins、conversations、session-history 四个文件与卡点回执的 SHA 相同。
- 后续 `20261115T075119-ci-bounded-cb2ab3` 已跑完全部 161 个 Vitest suite，没有再次 OOM/挂起；当时两项剩余失败为 featured DTO 白名单预期缺 `availability` 和多行提示词默认 normalizer 匹配。UI 代理只修正这两项断言：保留显式 12 字段白名单，并用原始 `textContent` 精确核对完整多行提示词；没有改变稳定产品修复。`20261115T075738-test-135701` 两套/22 项通过，随后 `20261115T075820-ci-bounded-1e367d` 全部 161 套/2065 项通过，真实会话回路与这两项断言问题均已关闭。

## 全范围审查覆盖

| 边界 | 已核对的实际代码路径 |
| --- | --- |
| 数据与契约 | 新增 `20261115090000_image_retention`、Prisma、media/Canvas catalogue、Node/Go repository 与 maintenance DTO。字节保留十进制字符串；共享 revision 和读写/执行时限在两端一致。 |
| 预览与确认 | 管理 API 先鉴权和集中 Zod 校验；预览固定图片、活动对象及全部对象清单，最多 1000 个资产，10 分钟过期；确认绑定 actor、preview、策略版本和请求身份，不能扩展为预览后新图片。 |
| 引用保护 | eligibility、claim 和触发器复核 showcase、封面、保存画布、永久输入、在途任务/写入/读取/复制及 Canvas 七天宽限。晚绑定历史 `GenerationImage` 补建根；历史业务行删除后保留不可变绑定。Save/run 读取绑定前按序锁定原图行。 |
| 领取与锁 | quota → policy → executor/job/item → reservation → CanvasImportAsset → ImageAsset → ImageObject。等待容量清理在业务事务外；额度锁下不反向获取 Canvas document/User 锁。一次领取一个完整资产组。 |
| 执行与恢复 | Worker 生命周期持有单执行者租约；检查运行拓扑/schema，并只探测有到期任务的位置。LOCAL 精确对象删除；S3 在领取前及每次删除前验证位置/版本能力，单次 HTTP 删除、拒绝重定向。失败和 UNKNOWN 保留计量、持久重试。 |
| 回执计量 | 匹配未过期 delete token 的完成回执才能进行一次 accounted 转换；重复回执 delta 为零。最后一个物理副本消失后才形成逻辑 tombstone；迁移源副本退休不修改逻辑图片、永久根或 Canvas 账户。 |
| 配额与调度 | 容量请求按 `(createdAt,id)` 最旧优先，达到本次固定需求或当前容量满足即停；等待最多 10 秒，最终由原 reservation 再次判断空间。定时任务使用数据库时钟与持久 nextRunAt，默认关闭。 |
| 读取围栏 | Node Buffer/HEAD/stream 与 Go managed read 获取新的 `beginRead` 租约和当前活动副本；IO 受读租约时限约束，取消时关闭流。代理、外部输入/base64 和匿名媒体路由使用相同受保护读取路径。 |
| 公开与历史状态 | 作品、管理员历史、会话、Canvas resolver、Node 外部查询和 Go query/replay 投影 `available/cleaned/unavailable`。清理不改任务终态、提示词或余额；非作者作品详情仍为 12 字段白名单，只新增 `availability`，不泄露审核/作者私有字段。 |
| UI 状态 | 会话、工作台、Canvas 缓存按不可变图片 ID 保持 `cleaned`；重复 canonical/等价值不再 publish，真实清理变化能收敛。查看、下载、加入编辑、Canvas 连线及提交阻止使用不可用图片。局部本地原图的生命周期和既有任务组织状态保持独立。 |
| 配置/升级/范围 | 新维护能力进入 Worker readiness 与 schema/rollback 检查；旧 Canvas GC 不能领取新清单。视频/视频专用封面、任意第三方 URL 和未登记对象不进入自动清理；既有 managed 关闭时的兼容路径不伪造已知媒体查询状态。 |

## C-A1–C-A7 验收映射

| 条目 | 已有自动化与静态证据 | 最终验证状态 |
| --- | --- | --- |
| C-A1 管理员统计→策略→预览→确认→结果及权限 | `storage-admin-api.test.ts` 对六个 API 的 401/403、输入边界、actor、CAS、过期、分页、错误脱敏；`storage-manager.test.tsx` 对确认重试身份、预览撤销、策略冲突、轮询及取消。 | 通过。最终 lint/types/全量测试通过；真实浏览器完成策略修改、预览、取消、确认、同任务重载和结果，实际未登录/普通用户分别得到 401/403。 |
| C-A2 持久任务、多实例/重启及一次减量 | `image-retention-db.test.ts` 真 SQL 的重复确认、执行者互斥、接管、旧 token、UNKNOWN、重复 finalizer；`image_maintenance_test.go` 的 LOCAL 删除/ACK 丢失及两种运行模式生命周期。 | 通过。新 SQL full/additive、Worker/Gateway DB 及 Go 全量通过；实际确认后关闭浏览器并重启 Worker，后台仍完成原任务，重放没有额外释放字节。 |
| C-A3 最旧优先与容量保护 | 真 DB 的小额度、固定时间顺序、永久保护根、整资产回收及达到 8 字节需求后仅回收首个 10 字节对象；Node/Go quota tests 验证重新预留、其他写者抢占及超时不越过准入。 | 通过。新 SQL full/additive 与最终全量测试覆盖容量竞争；真实 LOCAL 清理补充核对实际删除量与用量下降一致。 |
| C-A4 预览后新增引用、写入/复制和七天保护 | 新 DB 两连接引用竞争、Save 与晚绑定竞争、历史保存/永久输入根；C1 DB 的实际 showcase/封面/跨账户永久根；读取及未定 PUT 栅栏。 | 通过。新 SQL full/additive 各 60 项通过，包含 managed CANVAS_IMPORT 七天/保存/永久根；实际 HTTP 另验证保存画布和普通任务输入根。 |
| C-A5 真实文件删除、UNKNOWN 和版本异常计量 | Go 使用真实临时 LOCAL 文件；S3 HTTP 夹具核对精确 DELETE、403/500、missing、版本变化、delete marker、版本回执及不隐式重试；真 DB 验证实际 accounted 转换及重放。 | 通过。新 SQL 双副本/UNKNOWN/token 续期与 Go 全量通过；真实浏览器驱动 Worker 删除 70 字节 LOCAL 文件，文件消失、用量精确下降、重放不重复减量。S3 证据为本地 HTTP 夹具，没有执行真实桶清理。 |
| C-A6 历史占位、外部查询与事实保留 | 公共白名单/作品详情/会话/Canvas/管理员/外部路由回归；新增作品刷新、Node chat 和组合缓存收敛回归。真 DB 首例验证清理后任务 SUCCEEDED、提示词和余额保留。 | 通过。相关回归进入全部 2065 项通过结果；实际浏览器的作品卡片和独立详情显示清理占位并禁用下载，原提示词/任务终态/余额保留，失效媒体返回 410；截图复核通过。 |
| C-A7 视频/第三方/未登记对象排除 | 原生成/存储/视频契约；C1 真 DB 拒绝将 video job 按图片 backfill 纳管；候选来源只遍历登记 ImageAsset/Object，第三方 URL 不按前缀推断对象。 | 通过。最终全量回归及相关真实 DB 负例通过；未执行真实桶扫描或批量纳管。 |

managed Canvas 的历史年龄补测沿用 C1 的窄时间夹具：先经真实入口建立有效托管行，在 runner 哨兵和精确 ID 限定的临时数据库事务中，短暂 `SET LOCAL session_replication_role=replica` 只调整 `CanvasImportAsset.uploadExpiresAt/detachedAt` 与 `ImageAsset.detachedAt`，随即恢复 `origin` 并验证 `current_setting`，前后其他完整行字段相同。不修改 DDL、身份、状态或计量字段；后续 eligibility、claim、finalize、旧 token 与 replay 均运行完整生产 guards。该年龄播种属于测试准备，不能作为正常生产历史插入路径通过的证明。

## 实际回执与门禁组合

回执由主会话保存在 `../11-12-image-storage-foundation/checks/.runtime/storage-4e37900e/receipts/`，下表保留快照适用范围。UTC 标签与回执的本地时间字段可能分别显示 UTC/Asia-Shanghai，按完整回执 ID 定位。

| 回执 | 实际结果与限制 |
| --- | --- |
| `20261115T051201-prisma-a031ce`、`20261115T051218-go-build-18c64f`、`20261115T051242-types-d4162d` | 05:11:40 冻结版本的 Prisma、Go 构建、全局类型通过；不覆盖本轮五个修复文件的最终字节。 |
| `20261115T051448-test-45d713` | 初版 17 个 Node suite / 197 tests 通过；后续 UI 和本轮回归需重新执行。 |
| `20261115T052055-retention-catalog-5f441a` | 旧 SQL 的实际 PostgreSQL capture 通过。当时 migration SHA-256 为 `f6917c183d108706fda46282263a58a3bdbaaefb9ee3f641e3f9b38d7843cbf1`；media 417、Canvas 196 个对象。该回执不覆盖之后的 Canvas finalizer 顺序修复。 |
| `20261115T052650-canvas-db-7a3f5d` | 05:26:12 冻结版本，47.6 秒，full/additive 三套 DB suite 全部通过，包含初版 11 个 C2 用例，源/验证副本零漂移。后续新增 Canvas case 须重跑。 |
| `20261115T051517-go-tests-50e520`、`20261115T052754-go-tests-c496cf` | 早期 Go 失败保留：先为测试 delete token 非规范 UUID，修复后仅剩 S3 mock 拒绝 SDK 合法 `?x-id=DeleteObject`。runtime 代理已修夹具并保留精确 bucket/key/版本/单次请求断言，另加 500 单次请求用例；后续通过见 073013。 |
| `20261115T053436-ci-bounded-7b5a38` | scripts、Prisma、类型检查通过；lint 因页面 JSX 处于 try/catch 退出 1。该实际失败已按上文修复，不能把此回执标成完整 CI 通过。 |
| `20261115T054820-test-9950d7` | 05:47:56 冻结版本，两个修复相关 suite / 31 tests 通过，2.998 秒；五个修复文件 SHA 与工作区一致，源/副本零漂移。 |
| `20261115T054839-types-6f3771` | 相同冻结版本，全项目 `tsc --noEmit` 通过，5.426 秒；源/副本零漂移。 |
| `20261115T054901-lint-439f1f` | 相同冻结版本，lint 通过，零 errors；保留 9 个既有 warnings。 |
| `20261115T055319-ci-bounded-d14fc2` | 05:50:31 冻结版本，前四阶段通过；双 worker Vitest 出现原生 `Zone Allocation` 内存分配失败，随后 300 秒截止，退出 124。部分测试输出和末尾 `act` warnings 不算完整测试通过，也不能独自定位卡点；后续诊断确认另有第 6 项真实会话循环，不能把本轮异常全部归为环境。 |
| `20261115T071234-ci-bounded-a317a2` | 完整 CI 再次因原生内存分配失败退出 134，177.784 秒，源/副本零漂移；保留为失败回执。 |
| `20261115T071828-ci-bounded-6adced` | 小堆、单 worker 本地验证没有重现原生 OOM，但 Vitest 阶段到达 300 秒截止，子阶段退出 124，整条命令 319.851 秒。已有输出仅为部分测试，不能标为全量通过；外层 receipt 的 `timedOut=false` 不改变其子阶段超时事实。 |
| `20261115T072621-worker-db-3ab400` | Worker DB 通过，13.736 秒；源/副本零漂移。使用顺序修复前的旧 SQL SHA，不能作为新 migration 的最终数据库证明。 |
| `20261115T072717-gateway-db-3d61f4` | Gateway DB 通过，10.366 秒；源/副本零漂移。同样为顺序修复前的旧 SQL。 |
| `20261115T072815-canvas-db-2fb293` | full 场景 3 套 suite，共 59 项通过、1 项失败，退出 4，28.802 秒；唯一失败为新增 UNKNOWN Canvas token 续期用例，揭露第 5 项真实 SQL 问题。未得到整体 full/additive 通过。 |
| `20261115T073013-go-tests-3b9981` | `go test ./...` 全量通过，7.218 秒；源/副本零漂移。包括维护执行器/LOCAL/S3/运行生命周期，尚未覆盖随后更新的 migration/catalogue 指纹。 |
| `20261115T073350-retention-catalog-56af4a` | 新 SQL 的实际 PostgreSQL capture 通过；migration SHA 为 `2d65ec945b167fac0df3a8e08d6f6d92cbdcf9545dd23b5eaa05d978ecf2bdcb`。media 417 项 catalogue 摘要为 `22019c06daaabcf147a43942df7b4ff42e8d2786615526c74cf5b220a57a21aa`；Canvas 196 项摘要不变。采集成功不是功能回归通过。 |
| `20261115T073819-canvas-db-0941d9` | 07:37:59 冻结版本，53.534 秒，full/additive 各三套、各 60 项全部通过，含全部 14 个 C2 用例；新 SQL SHA `2d65ec…bdcb`，源/副本零漂移。Canvas 恢复顺序问题已由实际回归关闭。 |
| `20261115T074004-ci-bounded-aa02a2` | reporter 定位原 same-owner fresh props 用例未完成，完整 CI 因 Vitest 300 秒截止退出 124，320.068 秒，源/副本零漂移。对应第 6 项真实缓存回写循环。 |
| `20261115T074719-migrations-f68b91` | 新 SQL 的 migration 验证通过，48.231 秒，源/副本零漂移；不是 UI 或完整 CI 的通过证明。 |
| `20261115T075011-test-354dde` | 07:49:47 冻结版本，会话循环修复五套/89 项通过，6.507 秒，源/副本零漂移：use-conversation-generations 34、use-studio-jobs 20、image-availability 7、原 generator-studio-origins 26、generation-bubble-availability 2。 |
| `20261115T075119-ci-bounded-cb2ab3` | 当前会话修复版本的发布脚本、Prisma generate、TypeScript、ESLint 均退出 0。完整 Vitest 阶段已结束：159/161 suites、2063/2065 tests 通过，两个测试断言失败；无 OOM/挂起。整条 CI 退出 1，155.145 秒，源/副本零漂移。失败为 `featured-response-validation.test.ts` 的预期未包含新增 availability，以及 `work-detail-panel.test.tsx` 多行提示词文本匹配；后续 CI 阶段尚不能据此标记通过。 |
| `20261115T075738-test-135701` | 两项陈旧断言修复后，两套/22 项通过，3.159 秒；源/副本零漂移。保持公开字段白名单和原始多行提示词的完整断言。 |
| `20261115T075820-ci-bounded-1e367d` | 前九阶段全部退出 0：发布脚本测试、Prisma generate、全局 TypeScript、ESLint、161 套/2065 项 Vitest、Worker TypeScript 契约、Worker Go 契约、Go 全量测试及 Go 全量构建。最终 `pnpm build` 在成功编译后进入原生 TypeScript worker 时失败；整条 CI 退出 134，181.396 秒，源/副本零漂移。这次调用始终记为失败，构建门槛由后续 132252 单独补齐。 |
| `20261115T080233-build-42bd97`、`20261115T080555-build-af3d12` | Windows 原生完整构建尝试均因原生内存分配失败退出 134，分别为 6.123 秒和 25.672 秒；源/副本零漂移。失败记录保留。 |
| `20261115T091245-build-9db16a`、`20261115T091842-build-5b5a56` | Windows 原生完整构建尝试仍退出 134，分别为 8.199 秒和 7.483 秒；源/副本零漂移。没有生成可供验收的成功构建。 |
| `20261115T091715-next-types-bec0f8` | 官方 Next TypeScript checker 单进程诊断通过，16.641 秒；源/副本零漂移。只证明类型检查诊断通过，不能代替完整 Next build。 |
| `20261115T092305-go-vet-57313a` | 最终版本 `go vet` 通过，1.795 秒；源/副本零漂移。 |
| `20261115T092521-worker-db-384562` | 新 SQL 的 Worker DB 通过，12.259 秒；源/副本零漂移，909 个非 `.trellis/` 输入哈希与最终构建/HTTP 完全一致。 |
| `20261115T092738-gateway-db-c1be1e` | 新 SQL 的 Gateway DB 通过，10.073 秒；源/副本零漂移，同样绑定最终 909 个非 `.trellis/` 输入。 |
| `20261115T094421-linux-next-build-4f2ac4` | Linux 辅助构建实际失败，退出 1，199.687 秒；依赖安装完成后，在 Docker 第 12/22 步 `COPY --from=deps /app/node_modules ./node_modules` 遇到 `unexpected EOF`，尚未执行应用构建。未生成 builder image、导出容器或 `.next` 产物。当时 daemon 不响应使清理核验超时，原报告 `cleanup.complete=false` 原样保留；后续同 daemon 的只读归属核验是独立证据，不能回写这次失败为成功。 |
| `20261115T132252-build-55c84c` | 完整原生 Next 生产构建通过，退出 0，26.27 秒；Next 16.2.4/Turbopack 编译、内置 TypeScript、64/64 静态页和最终优化全部完成。使用原 Next CLI `next build`，本地进程仅限制 worker/堆资源，未跳过类型、页面生成或替换 bundler；源/副本零漂移。 |
| `20261115T132509-retention-http-f8a633` | 实际 Next/Go/PostgreSQL/Chrome 验证通过，退出 0，132.266 秒；源/副本零漂移。生产 BUILD_ID `cVvTE5CJ6lMPQ_mML0eR8`，真实 LOCAL 读写/优化器/下载/根保护/进程重启及六项清理浏览器检查全部通过；精确归属的临时 PostgreSQL 容器清理完成。 |

### 最终输入绑定

最终 build 和 retention-http 使用 `source-manifest.json` 中 `2026-11-15T17:43:45.78081+08:00`（09:43:45 UTC）的冻结输入。审查代理逐项比较回执的 `sourceBefore`：075820 CI、092521 Worker DB、092738 Gateway DB、132252 build 和 132509 retention-http 的全部 909 个非 `.trellis/` 输入路径及 SHA-256 完全相同；各回执的 `sourceChanges` 和 `snapshotModifications` 均为空。主会话另对当前工作区相应输入重新哈希，确认与冻结版本无产品差异。

较早的新 SQL full/additive 与 migration 回执和最终版本之间，仅有随后修复会话循环的三个 hook/helper 文件及四个前端测试文件不同；SQL、Prisma、数据库测试、Node/Go 存储实现与对应契约输入没有差异。最终 migration SHA-256 仍为 `2d65ec945b167fac0df3a8e08d6f6d92cbdcf9545dd23b5eaa05d978ecf2bdcb`，因而可复用这些实际 DB 回执。会话/测试差异已由最终 2065 项、构建及浏览器回执覆盖；任务记录和本地诊断 helper 的后续修改不作为产品行为改变。

完整原生构建使用 Node 24.22.1、原 Next 16.2.4/Turbopack，主会话在本地验证进程设置 `CIRCLE_NODE_TOTAL=2`、1536 MiB old-space / 4 MiB semi-space，并保留 deny-env preload。实际日志包含内置 TypeScript 完成、64/64 页面生成和最终路由清单，未使用跳过类型或未完成的 `.next` 作为运行证据。前段 Prisma generate 已在同一产品输入的 075820 回执通过；132252 完整 `next build` 补齐该次 CI 最后的构建门槛。

### 真实 HTTP、浏览器与截图

`20261115T132509-retention-http-f8a633` 使用上述原生构建及当前 Windows 的依赖/Prisma/native modules，实际启动 Next、Go Worker 和 disposable PostgreSQL。HTTP 报告确认原图 GET/HEAD/304、真实 Next 图片优化器、鉴权下载代理、匿名图片字节、Canvas 上传重放/保存根、普通输入任务根、真实 Worker 生成及应用重启均通过；`fakeProductRoutes=false`。没有安装或使用失败 Linux 尝试的产物。

浏览器结构化证据位于 `receipts/retention-browser-fdc1a2e9-7105-4b7f-ac75-ef033e90971a/checks.json`，六项全部 `passed=true`：

| 检查 | 实际结果 |
| --- | --- |
| `admin-permissions` | 未登录 401，普通用户 403。 |
| `native-policy-and-preview-cancel` | 原生表单保存到策略版本 2；预览不删除文件，原生取消有效。 |
| `native-confirm-and-close-browser` | 原生确认建立一个持久任务；执行前关闭浏览器并重启夹具 Worker。 |
| `background-physical-delete-and-replay` | 后台完成实际 LOCAL 删除；70 字节物理文件消失且用量精确下降，重放不额外释放；任务、提示词、余额保留，媒体返回 410。 |
| `reload-same-job-and-responsive-results` | 重新打开后仍为同一任务，无重复确认；390 px 移动视口没有横向溢出。 |
| `owner-history-cleaned-state` | 原生成任务仍为 succeeded，可用性正式为 cleaned；原提示词保留，作品卡片和独立详情均显示占位并禁用下载。 |

主会话已逐张查看五张实际截图：desktop-preview、desktop-completed、mobile-completed、owner-history、owner-detail。预览为 70 B，完成后登记用量 280 B、可清理量 0；移动端没有横向裁切，作者列表和独立详情的清理占位、下载禁用与提示词保留均可见。截图结论与结构化断言一致，C-A1/C-A2/C-A5/C-A6 的真实操作链路已关闭。

### Linux 构建辅助脚本复核与失败边界

审查代理只读复核 `checks/linux-next-build.mjs` / `.md`；实现代理完成五项边界修正：记录 Linux/宿主真实 mtime 并明确允许的精度差异；对大型 inspector JSON 在进程 `close` 后排空输出，限制 stdout 16 MiB/stderr 1 MiB 并使用共享进程树截止；按完整 image ID 精确清理；验证 APPDATA/LOCALAPPDATA 的归属路径；最终产物写入权限校验失败仍输出非零失败报告。没有触碰时间戳或共享执行副本。

静态通过版本 SHA-256 为 `linux-next-build.mjs = 7618a1ab31bc67c551a92dd220bb744665e3d7f2cb32f9f497af3bb5ea08ed0a`、`linux-next-build.md = 03a9984413df0c882e906d41a046fcc45536d9334857fe87a34c4b78255a4633`。已核对冻结源码/owner/凭证隔离、固定本机 daemon 与基础镜像、原 Dockerfile 构建流程、资源边界、产物哈希和精确归属清理；静态通过不表示运行通过。

094421 的实际失败发生在依赖 COPY，未到达应用 build，原报告没有产物且清理核验未完成。主会话在 daemon 恢复后进行独立只读归属核验，确认同一 daemon 上该 run 的 owner 容器、image 和 tag 均无残留；没有修改原失败回执，也没有执行未知对象清理。Linux 产物导出及其在 Windows 的可移植性未获通过证据；C2 最终门禁使用后续成功的原生 Windows 完整构建和实际运行链路。

### CI 内存失败后的定向只读审查

早期只针对 stderr 末尾 `canvas-unified-view.test.tsx` 的检查未发现该路径引入循环；这个结论范围有限，不能推导为整个 C2 没有循环。后续 reporter 和第 6 项已确认另一条真实会话回写循环，并完成专项修复验证。

- 与已通过 C1 前九阶段的 `20261115T042822-ci-bounded-80bc42` 指纹比较，该七用例 suite、`canvas-renderer-fixtures.tsx`、`canvas-controller-fixtures.ts`、`canvas-stage.tsx`、`use-canvas-editor.ts` 和 `use-canvas-composer-placement.ts` 六个文件完全一致。
- suite 只构造 prompt/generation 节点；唯一生成调用的 fake API 返回 `pending` 且 `images=[]`，不运行新增的 succeeded 图片可用性合并、reference/result 占位路径，也不挂载 `useStudioJobs` 或作品列表。`rememberImages` 在该状态直接返回。
- `controller.getSnapshot` 返回已经保存的 snapshot；`selectNode` 和 `setViewport` 对相同值提前返回。布局 fixture 的 ResizeObserver 按真实模拟尺寸去重，`updateCanvasNodeMeasurements` 在尺寸不变时保留原 Map，编辑器 effect 按 store/view 依赖运行，没有发现新清理状态触发的回写环。
- 同一时段，一个仅用于读取 spec 的独立 PowerShell 进程也在启动阶段报 `Releasing the double mapped memory failed`；这说明宿主资源也有异常，但不能排除产品循环造成额外内存压力，也不用于替代产品测试。

早期这次调查没有启动测试、修改产品源码或操作共享验证副本。它仅排查上述 Canvas 路径，未覆盖当时尚未定位的 GeneratorStudio 缓存回路；不能把窄范围静态检查写成完整 UI 已排除问题。

后续单 worker 小堆尝试仍在 300 秒阶段截止内未完成。主会话将本地 harness 调整为 2 workers、512 MiB old-space / 4 MiB semi-space，并添加模块/用例诊断 reporter；追加资源参数保留 deny-env preload、全部用例/断言及原截止，不修改产品运行参数。诊断随后找到了真实回路；资源调整本身没有修复它。会话修复后的 075119 已完成整个 Vitest 清单但因两项测试断言退出 1；修正断言后 075820 全部 2065 项通过。其后原生构建的内存失败发生在已通过全量测试的版本上，最终由未改变产品源码的 132252 完整原生构建和 132509 实际运行通过关闭；不会把早先真实产品循环归为纯环境问题。

## 规范同步复核

主会话已同步并已对照实际代码复核：`image-storage.md` 的维护 API、锁序/租约、读保护、配额回收与源退休；`canvas-contracts.md` 的逻辑计量、晚绑定根和 token 续期顺序；`release-hardening.md` 的 image revision 2 升级/回滚；`quality-guidelines.md` 的三套 DB、窄时间夹具、诊断 reporter、环境归因与 preload 保护；`state-management.md` 的同 ID 可用性和 canonical 回写收敛；`public-work-data.md` 的 12 字段白名单；跨层 guide 的中间转换合法性与重复发布检查。复盘已记入 `research/recovery-and-cache-loop.md`。没有发现新的规范漂移。

## 最终门禁结论

- Lint：通过；最终产品版本的 ESLint 退出 0，既有 warnings 保留。
- TypeCheck：通过；全项目 `tsc --noEmit` 及完整原生 Next build 内的 TypeScript 均实际通过。
- Tests：通过；161 套/2065 项、Worker TypeScript/Go 契约、Go 全量、最终 SQL full/additive 各 60 项、Worker/Gateway DB、迁移及真实 HTTP/浏览器均有适用输入下的通过回执。
- Build：通过；原生 Next 编译、类型、64/64 页面和最终优化完成，运行使用该成功构建。失败的完整 CI 调用、较早原生构建和 Linux 尝试仍保留各自失败结果。
- C-A1–C-A7：通过。没有已确认但未修复的产品缺陷，也没有本子任务内尚未完成的验收项。

C2 可由主会话关闭任务元数据并交接到已批准的 C3 工作。此结论覆盖本地隔离验证下的产品实现，不表示已执行真实数据清理、真实桶验收或 C3 生产迁移；后续若改变相关产品/SQL 输入，按实际受影响范围重新验证。

## 父任务最终集成补验（2026-11-16）

前文保留C2原阶段、revision2及原失败边界。C3新增历史纳管/迁移与revision3后的最终完整门禁已通过；提交前的EOF/LF/checksum和旧首页焦点测试修正，不改变C2图片清理产品UI。`20261115T171857-retention-http-4b17cb` 最终真实浏览器六项检查、五张已复核截图仍适用于其清理行为边界；350→280字节、浏览器关闭/Worker重启/重放、70字节精确释放、410与提示词/计费保持均实际通过。

当前 `20261116T023915-ci-bounded-c5b0f5` 同次完整十阶段CI通过（168套/2150项），Canvas完整/增量各4套87项及Worker/Gateway DB、迁移和 `20261116T025107-history-integrated-e2e-f78bd8` 同次默认11场景全部通过。950项产品输入与新完整CI/E2E完全一致；两种历史拓扑实际验证源退休失败保持量、策略拒绝/正式启用/同任务恢复与重试精确释放。独立资源清理通过，当前共享验收见 `checks/gates.json` 的 `finalParentIntegration` 和C3 `checks/gates.json`。用户已于2026-11-16一次确认工作提交及归档/journal计划，功能提交1368518已完成，当前提交任务记录，之后归档，不推送。

## 已完成的工作提交与归档（2026-11-16）

两笔工作提交依次为 `1368518dfe0e2b3d9a78789f022b4e0859240ff6`（272个功能/spec路径）和 `67b0edfd777629bd1dcd37117a1d0e892a115c9e`（79个任务记录路径），实际范围均与用户一次批准的清单一致。本任务已通过native `task.py archive`移动到 `.trellis/tasks/archive/2026-11/11-12-image-retention-management`，status为completed，quality gate保持passed；归档Git提交只暂存本任务原路径删除及新路径文件。journal由父任务统一记录，两笔工作提交先于全部归档/journal提交，未push，六份既有GHCR文件字节保留。
