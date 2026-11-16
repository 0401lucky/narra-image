# 受管理图片存储契约

## 1. 适用范围与触发条件

- 修改 `contracts/media/v1/`、`src/lib/storage/`、`worker/internal/worker/image_*.go`、图片提交/上传/读取或图片清单 migration 时必须读取本规范。Canvas 的账户、场景与原图根规则同时遵循 [Canvas Contracts](./canvas-contracts.md)。
- 范围是生成图片、普通上传参考图和 Canvas 导入。视频、视频专用封面、提示词库外部预览及未知第三方 URL 保持原有路径。
- 图片文件存 LOCAL 持久卷或 S3；PostgreSQL 只存身份、物理副本、引用、额度和状态。不得把生产本地模式实现成大 base64/数据库 BLOB。
- 本规范不授权生产迁移、删除、调整额度或切换后端。

## 2. 签名与职责

- Node `ImageRepository(queryer?)` 与 Go `NewImageRepository(queryer)` 调用同一组 `image_*(jsonb)` SQL 状态动作；事务客户端用于业务绑定/引用，不能在长业务事务内预留容量或执行 IO。
- 写入顺序：`reserveOutputs/reserveInput → bindReservation（输出）→ acquireForJob（Worker）→ beginObject → 物理 PUT → finishObject → closeReservation`。`beginObject.writeGranted=false` 是重放，不能再 PUT。
- `finishObject` 只接收 `CONFIRMED | UNKNOWN | NOT_WRITTEN`。只有确知未开始 IO 才能报 `NOT_WRITTEN`；超时、进程失联或 DB ACK 丢失不能推断没有文件。
- `replaceReferences({ownerId,kind,referenceKey,assetIds})` 支持 `JOB_INPUT/CANVAS_SAVED/SHOWCASE/SITE_COVER`。`JOB_INPUT` 只追加并永久保留；其他关系是同一引用者/用途/key 的集合替换。
- `activateObject({assetId,objectId,expectedObjectId})` 只在同一逻辑图片、相同长度/摘要、目标 READY 时 CAS 切换副本。
- `GET/HEAD /media/images/<64hex>` 使用随机读取 token；`resolveUrl` 仅查精确 `ImageUrlAlias`，不能用前缀、文件名或当前默认后端推断历史对象。
- 本地初始化命令：`narra-worker --init-image-volume`；普通启动和只读验证不会自动创建卷身份或清空目录。
- `CheckRollbackSafety` / `pnpm rollback:preflight` 使用只读 REPEATABLE READ 快照。CLI JSON 追加 `image_storage_revision/canvas_storage_revision/managed_image_assets/local_image_objects/active_image_reservations/unresolved_image_objects`，不输出文件路径或 SQL。
- `verify:migrations` 的 pgx URL 场景先 `go build -o <owned-scratch>/rollback-preflight`，再直接执行二进制；当前新 schema 空库应返回完整 `ROLLBACK_UNSAFE` 报告及退出码 2。`go run` 会将程序的非零退出折叠为 1，不能用于核对 CLI 的 safe/unsafe/error 区别。
- `listLocalMigrations(migrationsRoot)` 对 `migration.sql` 的原始文件字节计算 SHA256；Prisma应用记录和Node/Go声明的migration链须匹配这些原字节。schema函数body的CRLF规范化是另一个契约，不能用于改变部署checksum。

## 3. 数据、环境与读取契约

- `IMAGE_STORAGE_MANAGED_ENABLED=false` 是升级默认值。`IMAGE_STORAGE_BACKEND=s3|local` 默认 `s3`；LOCAL 必须显式启用 managed，并配置 `IMAGE_STORAGE_PATH` 与规范小写 UUID `IMAGE_STORAGE_VOLUME_ID`。两端 loader、runtime manifest、公开示例、Compose 同步。
- managed 生产者（普通 Worker 与独立 backfill）在任何存储 IO 前强制校验显式、非 loopback 的 HTTP(S) `APP_URL`；所有模式拒绝凭据/query/fragment 等无效 URL。不能依赖 Node 校验替独立 Go 入口兜底。纯 `--init-image-volume` 是离线卷准备，不要求公网域名、认证或数据库。
- `ImageAsset` 是稳定逻辑身份；`ImageObject` 每个物理副本独立计量。业务 User/Job 的 cascade 不能删除它们。原 owner 与 `ImageReference.ownerId` 的引用者身份不同：普通已知公开图片允许跨账户作为输入，Canvas 仍遵守 same-owner 限制。
- 额度是 `5,000,000,000` 字节，即十进制 5GB。总量为 `usedBytes + reservedBytes`；managed 模式即使 `ImageStoragePolicy.enabled=false` 也执行 gate，策略开关只控制破坏性清理。
- PostgreSQL 使用 BIGINT、Go 使用 int64、JSON 使用经过校验的十进制字符串。前端只在安全范围内转 number。输出预留每槽最多 50MiB，规范化数量 1–4；图生图固定一个输出。实际 byteLength 从槽预算转到物理量一次，剩余槽关闭后归还。
- 手写 DDL 对应的 Prisma `dbgenerated(...)` 必须使用 PostgreSQL 实际 catalogue 的规范表达式；语义相同的括号写法仍可能触发 Prisma schema drift。`ImageAsset.publicToken` 的数据库默认值为 `replace(((gen_random_uuid())::text || (gen_random_uuid())::text), '-'::text, ''::text)`。修正 Prisma 声明不改变已发布 migration、随机令牌算法或数据库函数指纹。
- 两份shared schema的每个migration链成员必须在 `.gitattributes` 以精确路径固定 `text eol=lf`，包括已发布Canvas基座及全部新图片迁移。新增链成员同时补规则；已发布SQL字节不修改。未发布SQL的空白修正须同步两份链中SHA并保留旧证据，重新验证当前源码，不能为真实SQL增加whitespace豁免。
- 全站维护锁序：引用协调 epoch → quota → policy → executor/job/item → reservation → CanvasImportAsset → ImageAsset → ImageObject；不涉及维护时跳过对应层。`image_lock_reference_epoch()` 必须先于业务行锁，保护尚未建立别名的输入 URL；managed 新写入关闭时也执行。引用再按稳定顺序锁 asset，历史 Canvas 绑定读取须按序取得 `GenerationImage FOR SHARE`。已有 Canvas/run/owner 业务事务内不得反向申请 quota，持有 quota 时不能反向取得 Canvas document/User 锁。
- 本地卷标记字节严格为 `narra-image-volume-v1\n<UUID>\n`。根目录必须已存在、绝对且由服务独占管理。每个 key 映射平面文件 `image-<sha256(key)>.bin` 与 `.image-<sha256(key)>.writing`；排他暂存、fsync、硬链接不覆盖发布。
- `verify/Verify` 只读；`probeWritable/ProbeWritable` 明确创建并精确删除两个零字节探针，验证当前进程 UID 的硬链接、不覆盖与写权限。Node/Go 使用兼容 UID（当前镜像均默认 root）；文件 0600。Go 最低 1.25。
- `Open/Read` 有界读取并验证实际长度/摘要；`Head` 验证已登记长度，不能把其返回的登记摘要当成内容已读校验。missing 必须复核卷身份与暂存；存在 `.writing` 返回 pending，不是释放空间证据。
- 图片字节保持不可猜链接的公开读取语义，不要求 cookie；作品元数据、提示词和下载代理继续使用原权限。GET/HEAD 提供准确 MIME/Content-Length/ETag、nosniff；已删除返回 410，未知 404，不可用存储 503。
- 自己的已登记图片从数据库当前副本读取，避免公网域名回环。Next optimizer 只将与 APP_URL 精确同源且合法 token 的自身媒体 URL 改为内部路径；任意第三方 URL 继续原 SSRF/DNS/重定向限制。
- Canvas 场景 wire 仍为 1；存储/GC capability 是 revision 3，包含 provider/location。LOCAL 行使用真实 provider 与 nullable S3-only 列，保留已有 ID/原始 S3 tuple。旧 GC mutation 签名被栅栏拒绝；新兼容 GC 只负责未纳管 S3，managed 对象由全站执行器处理。

## 4. 校验与错误矩阵

| 情况 | 结果 |
| --- | --- |
| 超额、最后额度被并发占用 | `IMAGE_QUOTA_EXCEEDED`；provider 前失败，不擅自扩大配额 |
| 超过 50MiB、非法十进制数、输出张数越界 | `IMAGE_INVALID_INPUT` 或既有生成边界错误，不发布文件 |
| 相同 intent/slot 对应不同 payload 或旧 worker token | `IMAGE_RESERVATION_CONFLICT` / `IMAGE_WRITE_CONFLICT` |
| 新引用与删除状态竞争 | 同一 asset 锁；不可用或引用冲突，不能引用已删图片 |
| 错卷、不可写、schema/catalogue 不匹配 | readiness 失败；不能以额外新表存在代替有效函数指纹核对 |
| 未知 PUT、晚到确认、过期 reservation | 保留对象身份和占量，等待协调；过期本身不释放物理字节 |
| provider handoff 后持久化失败 | 保持 `RESULT_PERSIST_FAILED` 及当前 v0/v1 各自退款/UNKNOWN 语义；不得再次付费调用 provider |
| 原图仍被永久输入根保留或脱离不足七天 | 不能清理；管理保留天数和容量压力不能缩短 Canvas guard |
| 回滚前发现新清单/绑定列/v2 GC 函数标记 | 必须核验完整实际 Image/Canvas catalogue；partial/mismatch 失败，不能当成没有图片数据 |
| 受管理 image schema（当前 revision 3）/ Canvas storage revision 3 已存在 | 即使没有 v1 活动任务或当前图片也拒绝旧 Worker 回滚；完全无新 schema 的旧库才沿用旧安全检查 |
| migrations 已应用，但 Prisma 默认表达式与实际 catalogue 不同 | `migrate diff --exit-code` 返回 2；应获取实际差异并对齐声明，不能取消零差异门禁 |
| Windows检出改变shared migration原字节/链checksum | 新schema/迁移门禁失败；固定LF与声明SHA，不能仅依赖规范化函数body单测 |

JavaScript `$` 可在末尾换行前匹配；UUID、SHA256、key 校验需要绝对结尾，例如 `(?![\s\S])`，与 Go 保持一致。项目 TypeScript target 是 ES2017，使用 `BigInt(...)`，不为这些比较提高全局 target。

## 5. 正例、基线与反例

- 正例：普通参考图先按确切大小预留，原子登记后 PUT；成功任务绑定输出且建立永久输入引用。两副本迁移期间两份实际字节都占全站额度。
- 基线：managed 关闭时保留旧 S3/data URL 开发兼容；视频不进入此清单。旧媒体来源不明时保持可读、待盘点且不自动删除。
- 反例：按 `GenerationImage` 行数/URL估算物理量，删除用户时顺便丢清单，或把 reservation 到期当成文件已消失。
- 反例：将 `INPUT + GENERATED` 当通用历史纳管入口。现有 backfill 的窄例外仅允许 `backfill-image:<legacy-id>`、owner 匹配且尚未关联的旧图片，并且仍要实际预算和新 PUT；无 PUT 的历史盘点需独立核实对象登记流程。
- 正例：从实际 catalogue 对齐所有 Image 模型的 `dbgenerated`，再验证完整迁移历史和 baseline 升级均无差异；基线是原 DDL 和随机令牌行为不变。反例：只看 SQL 语义近似就宣布结构已一致，或把空的新 schema 当作旧 Worker 可安全回滚。

## 6. 必需验证

- Node/Go 共用 media 输入 fixtures；覆盖末尾换行、数字格式/范围、50MiB、count 1–4、S3 physical namespace 与本地身份。
- 真实临时目录验证 Node/Go 互读、不覆盖、流取消、符号链接拒绝、写入途中 missing、精确删除；Linux 当前服务 UID 的共享持久路径与容器重建需单独证据。
- `verify:canvas-contracts:db` 包括 image suite，full/additive 两场景和真实两连接最后额度/引用竞争。suite 按文件串行；状态用事务 rollback，竞态只清自己的可变引用/预留，不删除不可变清单来清场。
- schema verifier 读取 PostgreSQL 实际约束、触发器、函数 body 指纹，并覆盖完整依赖的 Canvas 字段/索引/约束/函数/触发器、CanvasGcLease 和四个有序 enum（media 使用 `{labels:[...]}` 对象形状）。CANVAS_ENABLED=false 也不能漏检这些 hold/GC 依赖；仅迁移文件 checksum 或调用 `getUsage()` 不足以声明 schema ready。
- `image-schema.test.ts` 将全部 Image/Canvas 模型的 `dbgenerated` 默认值与已采集的实际 catalogue 对照；新增默认值不能只增加一份相同的手写期望字符串。`migration-safety.test.mjs` 保留 direct-binary/unsafe 2 正例，以及构建失败、无效 JSON、旧 safe 报告、错误修订、非空清单和退出码折叠负例；真实 URL/结构验证仍由 disposable `verify:migrations` 执行。
- 真实 Next/Go 请求验证无 S3 的生成、普通上传参考图、Canvas 导入/重放/保存根、匿名原图/HEAD/304、实际 `/_next/image`、下载代理和重启读取。fake HTTP/jsdom 不能代替 optimizer 与存储实证。
- 必跑 `verify:ci`、Worker/Canvas/gateway DB 与新增 migration 验证；完整部署切换另跑两种拓扑 E2E。所有验证使用 disposable 资源，不能读取开发 `.env` 或访问真实 R2。
- 换行规则以实际Git检出过滤器验证：`git -c core.autocrlf=true cat-file --filters --path=<声明路径> HEAD:prisma/migrations/20261029090000_canvas_v1/migration.sql` 对所有链路径保持原LF字节；未匹配SQL路径必须产生CRLF负对照且规范化后回到同一内容。此检查不暂存或修改对象/index；原字节hash、Prisma实际应用checksum与真实catalogue仍分别核对。

## 7. 错误与正确示例

```typescript
// 错误：在长业务事务中申请额度；超时即释放未知文件。
await db.$transaction(async (tx) => {
  await lockCanvas(tx);
  await new ImageRepository(tx).reserveInput(input);
  await upload();
});

// 正确：先独立预留，短事务绑定业务，登记授权后仅执行一次 IO。
const reservation = await repository.reserveOutputs(output);
await db.$transaction((tx) => bindManagedImageOutputs(tx, reservation, ownerId, jobId));
// Worker acquireForJob 再校验当前领取者；未知回执保留占量供协调。
```

```prisma
// 错误：语义等价，但不匹配 PostgreSQL catalogue 规范化后的默认表达式。
// @default(dbgenerated("replace((gen_random_uuid())::text || (gen_random_uuid())::text, '-'::text, ''::text)"))
// 正确：与实际数据库保持同一表达式。
// @default(dbgenerated("replace(((gen_random_uuid())::text || (gen_random_uuid())::text), '-'::text, ''::text)"))
```

## 8. 维护、读者与迁移源退休

### 管理命令与持久范围

- `getStorageOverview` 仅汇总已登记物理字节和未物化预留，未核实历史图片单列数量，不估算其大小；位置统计不返回路径、endpoint 或凭据。
- 六个管理 API 位于 `/api/admin/storage` 及其 policy/cleanup/jobs 子路由，每个入口均先校验管理员身份并集中校验输入。`updateStoragePolicy` 使用 `expectedVersion` CAS；`enabled` 控制清理，不能关闭写入额度 gate。
- `previewCleanup` 持久固定最多 1000 个资产及其当时全部对象，10 分钟失效；结果为估算。`confirmCleanup` 绑定 actor、preview、策略版本和请求 UUID，同请求只返回原任务，不包含预览之后创建的副本或图片。策略冲突/预览过期返回稳定 409，不能静默重新选范围。
- `MANUAL_AGE`、`MANUAL_ALL`、`SCHEDULE`、`QUOTA` 共用维护任务及执行器。取消停止新领取，在途确切回执仍可结算。管理员页用 `?job=<uuid>` 恢复任务详情，浏览器轮询不驱动实际删除。
- 定时默认关闭，初始每 24 小时清理超过 30 天的允许对象；调度使用数据库时钟和持久 `nextRunAt`。容量清理按 `(createdAt,id)` 最旧优先并冻结本次需求，达到需求或当前容量满足即停止。请求方在业务事务外最多等待 10 秒，再重试原预留；其他写者抢先占满时仍可返回 `IMAGE_QUOTA_EXCEEDED`。

### 保护和实际删除

- 候选、领取和关联触发器均复核当前保护事实：精选/审核、站点封面、保存画布、永久任务输入、在途写入/复制/读取以及 Canvas 七天宽限。管理员年龄和容量策略不能缩短这些保护。
- 历史 Canvas result、run 或保存场景先存在，随后才绑定 `GenerationImage.mediaAssetId` 时，桥接函数必须补齐根。原业务行删除后仍保留不可变输入绑定；空 `ImageReference` 不能单独作为无历史根的证明。
- Worker 获得全站 90 秒执行租约后才领取，一个 claim 是一组完整资产。`listMaintenanceLocations` 只返回到期任务实际需要的位置；空闲 tick 不能为了无任务清理而探测所有 S3/R2。
- 在领取前、每次物理删除前核对存储身份和能力。LOCAL 核对真实卷、精确 key 和 writing 标记；S3 拒绝版本异常、重定向及隐式删除重试。对象 IO 不持有长业务事务，单对象删除不超过 30 秒，单 pass 不超过 45 秒。
- `finishMaintenanceObject` 只接受匹配的有效 delete token。仅确切 `DELETED/MISSING` 导致 `accounted:true→false` 并减量一次；`FAILED/UNKNOWN` 保留计量和持久重试状态。重复 finalizer 的 `releasedBytes` 为零，过期旧 token 不能完成新执行者的删除。
- managed Canvas 只在最后一份物理副本确认消失后形成逻辑 tombstone 并释放一次原图账户额度。执行者接管时续期所需的 Canvas 逻辑 token，不复用过期 token。续期必须发生在 `ImageAsset` 与 `CanvasImportAsset` 仍同时为 `DELETING` 时，然后依次终结两层逻辑状态；先把 ImageAsset 设为 DELETED 再续 Canvas token 会被真实关联 guard 拒绝。源副本退休不会释放逻辑图片/Canvas 账户额度。

### 读取与同内容副本

- 每次实际读取都调用 `beginRead`，由 DB 返回最新活动对象和 45 秒读保护；之前取得的 DTO 不能替代这次校验。Node Buffer/HEAD/stream、Go managed read、代理/base64/生成输入共享这一入口，IO 在最多 30 秒内结束并留出保护余量，取消须关闭流。
- `prepareCopy` 原子建立绑定到 asset 的 COPY 预留；复制不能用普通 INPUT 预留绕开源保护。双份文件和剩余预留都进入额度，未定 PUT/未过期写保护不能退休源。
- `recordReplicaVerification` 只供已实际读回并校验长度/SHA256、精确别名的内部迁移消费者调用；持久证明还绑定 source、target、当前活动副本与 reader revision。浏览器管理 API 不接受此类证明。
- `requestSourceRetirement` 排入同一执行器的 `SOURCE_RETIREMENT` 模式。其目标必须是同一逻辑图片的已验证 READY 当前副本，全部读取别名已兼容且无旧副本在途保护；它与整张图片 RETENTION 的资格不同，不删除逻辑根。没有确切源删除回执时不能宣称释放源空间。
- Node/Go 均加载 `contracts/media/v1/maintenance.json`：当前 storage/reader/executor revision 均为 3。Worker readiness 保留 version/schema/provider/locationId，追加这三个 revision 和 `maintenance:"running"`；Canvas scene/run wire 仍为 1、存储/GC revision 为 3。实际 PostgreSQL catalogue 必须匹配追加迁移后的函数/约束/触发器。

### 历史可用性与验证

- 公共 DTO 用 `available | cleaned | unavailable`；`DELETED→cleaned`，其他不可读状态为 `unavailable`，未纳管旧图片保持原兼容读取。已清理图片不改任务终态、提示词或计费事实；页面显示占位并阻止下载、复用及作为 Canvas 输入。
- 相同不可变图片 ID 的 `cleaned` 在迟到 DTO/缓存中不可回退，`unavailable` 可以恢复。作品页仅按 ID 合并服务器 URL/可用性，保留本地分页、搜索、筛选、选择和删除；具体 React 模式见 [State Management](../frontend/state-management.md)。
- Node/Go `/v1` 查询不得返回不可用图片的失效 URL；Node chat JSON/SSE 也必须经过共享图片 formatter，而非直接拼 `job.images`。非作者作品详情保持 [Public Work Data](../frontend/public-work-data.md) 的 12 字段白名单。
- 必须有真实 DB 的多执行者/旧 token/UNKNOWN/重复回执/晚绑定根/七天保护/多副本逻辑额度用例，并有实际浏览器的策略→预览取消→确认→关闭浏览器/Worker 重启→同任务恢复、文件消失与字节精确减少证据。UI 单测或 S3 HTTP 模拟不能冒充生产桶清理。
- 历史年龄测试若生产 guard 强制当前时刻，可在具有专用 sentinel 的 disposable DB 内按精确 ID 临时调整 `CanvasImportAsset.uploadExpiresAt/detachedAt` 和 `ImageAsset.detachedAt`。使用事务本地 replica 时必须立即恢复并断言 `origin`、验证其他完整字段不变；所有实际资格、领取、删除和重放断言都运行完整 guards，不能把年龄播种当作正常生产纳管验证。

## 9. 历史登记、复制和读取投影（revision 3）

### 适用边界与入口

- 修改 `worker/cmd/image-history`、`image_history*.go`、历史 SQL/DTO、来源别名或展示 URL 时读取本节。工具打包为 `/app/narra-image-history`，操作步骤见 `docs/image-storage.md`。
- 默认命令只读；`--apply --bindings <manifest> --request-id <uuid> --actor-id <id>` 才允许登记，`--target-location <id>` 追加复制，`--retire-source` 显式请求源退休。`--job-id` 查回原任务；配合 `--apply` 恢复，`--item-id` 指定阻塞项。`--limit` 为 1–1000，固定 `--upper-bound`/不透明游标用于稳定分页。
- SQL/仓库入口为 `image_scan_history`、`image_begin_history_apply`、`image_claim_history_item`、`image_record_object_observation`、`image_adopt_observed_object`、`image_prepare_migration_copy`、`image_prepare_copy_reconciliation`、`image_finish_copy_reconciliation`、`image_commit_migration_switch`、`image_request_history_source_retirement`。Node/Go 方法共同消费 `contracts/media/v1/history.json`，字节是十进制字符串。
- CLI stdout 使用 `worker/cmd/image-history/main.go` 的 `historyCommandResult`：顶层为 `schemaVersion: 1`、`dryRun`、`code`、`status`，按操作包含 `plan` 或 `progress`；`ImageHistoryApplyReport` 位于 `progress`，条目必须从 `progress.items` 读取。内部 report 不能直接充当公开命令的返回值或测试 mock。
- CLI 计划成功为 `IMAGE_HISTORY_PLANNED / planned / exit 0`，只读任务查询为 `IMAGE_HISTORY_PROGRESS / read / exit 0`，apply 完成为 `IMAGE_HISTORY_APPLIED / applied / exit 0`；仍有 blocked/hasMore 时为 `IMAGE_HISTORY_PENDING / pending / exit 2`，错误为具体安全 `code / error / exit 1`，有进度时仍保留嵌套 `progress`。调用者必须同时判断退出码、顶层 code/status 和条目状态。

### 身份、计量与保护

- `ImageObject.provenance` 区分 `WRITE` 与 `OBSERVED`。WRITE 保留 reservation/slot/writeToken/writeExpiresAt；OBSERVED 的四个字段必须为 NULL，并关联独立不可变 SOURCE observation，没有 PUT 授权。Go 既有 scalar 字段仅在严格 JSON null 校验后用零值表示缺失，序列化还原 NULL，零值不可当作写入凭据。
- 显式 binding 固定 subjectKind/subjectId/expectedSnapshotHash/locationId/key/ownerId；普通引用 URL 须匹配已确认位置的完整发布地址或已有精确别名，不能从前缀、basename、当前后端或引用者猜归属。视频、视频专用封面、未知桶对象、第三方和 data URL 不冒充可观察源。
- 历史生成原 URL 超过2048字节时，报告保留摘要而不下发长 URL，已核实的物理量只进入隔离 inventory/hold。无可桥接精确旧地址的项不允许 COPY 或解除 hold，复用既有物理对象也遵守该规则；数据库原字符串与永久输入事实不截断。
- `ImageHistoryJob` 固定 scope、planDigest、sourceBindings、publicUrlBase、target、retireSource、扫描上界；同 request 改 intent 冲突。`ImageHistoryItem` 固定业务快照、原身份与目标 attempt/key；`ImageObjectObservation` 保存完整读取的字节/摘要/版本及 writer 证据。
- 已存在的真实历史字节即使超出额度也如实入账，重复物理对象 delta=0；新 COPY/上传仍走原额度 gate。超过单图复制上界的真实长度保留 BIGINT 并隔离，不能截断或记零。来源业务在观察后消失时保留已证明对象与隔离 hold，不伪造业务绑定。
- `ImageHistoryReference` 在别名尚不存在时保存永久 JOB_INPUT URL，业务 cascade 不清除它；SITE_COVER 是当前集合。`ImageHistoryHold` 在原始/规范 token aliases、根与业务绑定一致之前阻止清理。解除 guard 独立复核事实，不能仅将 item.state 改为完成。Canvas 原 tuple/upload ID、GenerationImage.url 和冻结输入保持不变。
- Canvas 历史接管须实际停止兼容 GC 并等待原租约结束；不能借迁移关闭原 lease guard。原 UNKNOWN/DELETING/版本异常保持隔离与计量。历史 C1 `WRITE+CONFIRMED+versionId` 可继续按版本读取，但不满足迁移/清理资格；新 observed/reconciled READY 只接受无版本的正向证明。

### 复制、恢复与展示

- `prepareImageMigrationCopy` 原子保存唯一 intent/key/attempt 并调用原 COPY 预算与 beginObject；replay 不重新授权 PUT。目标原 writer 到期时间不可修改，UNKNOWN 原事实不可覆盖。实际正向读回、不可覆盖文件身份和原 writer 已终结证明才能通过独立 reconciliation observation 恢复；missing/超时/403/残留 staging 只阻塞，不释放字节。
- 切换前目标完整读取并核对长度/SHA256/MIME，短事务 CAS 后记录 C2 replica proof。默认 SOURCE_RETAINED；有显式 retireSource 的项在 retirementJobId 尚未建立时仍是未完成工作。
- 显式退休再以原 publicUrlBase 访问规范 token URL，验证实际部署能返回同一完整内容；不跟随重定向、不携带存储凭据。失败为 `IMAGE_READER_INCOMPATIBLE`，保留源与原任务恢复位置。这个网络证明仅用于运维退休命令，不能放入 Worker/embedded 启动就绪链。
- `--retire-source` 与公开读者证明不自动开启清理策略：`ImageStoragePolicy.enabled=false` 时 C2 请求返回 `IMAGE_POLICY_DISABLED`，不排队/不删源/不减量；管理员显式启用后恢复同一 history job。定时与容量自动清理可以继续关闭。真实迁移场景必须先证明默认拒绝，再经带 expectedVersion 的正式策略入口开启，不通过直接 UPDATE 绕开策略契约。
- 数据库源 URL 是来源事实。`presentGenerationImage` 对 AVAILABLE managed 输出规范 token URL，不可用输出空 URL；公开作品仍遵守 12 字段白名单。`projectGenerationSourceUrls` 一批精确查 aliases、仅克隆展示字段，未登记外链保持原值，已知不可用项不供缩略图/复用。POST 的展示查询在提交前完成，不能因提交后的展示失败进入退款分支。
- 原图媒体路由、Node/Go 内部读取及规范 token 解析独立于新写入开关。token URL 规范化后的 origin 必须与 APP_URL 相同，允许 host 大小写/默认端口差异，但其原始路径必须是该基址下的规范 token 路径；不接受跨域、query、fragment、dot-segment 或任意 URL 推断。登录封面保存原配置，显示使用精确解析的当前图片。
- 读者可能规范化 host 大小写/默认端口，但 SQL roots 按原始精确 URL 关联。新任务与当前封面接受自己的 token URL 时，须在 epoch 保护的业务事务内查回 AVAILABLE 当前对象并注册该次输入的精确 alias，再写业务根；保留输入字符串。Node `bindManagedImageInputAliases` 与 Go 网关遵守同一顺序，不能靠只读 GET 副作用或假设原 token alias 的拼写相同来保留图片。

### 错误矩阵与必测边界

| 情况 | 结果 |
| --- | --- |
| 默认 CLI 初始化/扫描 | DB 连接与事务只读，无 RegisterLocation、ProbeWritable、PUT/DELETE、卷 marker 或 checkpoint 写入 |
| 来源绑定/业务快照变化 | 冲突或持久 BLOCKED，原图继续原读取语义 |
| 已观察历史量超过额度 | 保留真实 usedBytes/overLimit，后续 COPY/新增写入被 gate 拒绝 |
| grant/PUT/数据库 ACK 丢失 | 原 item/target 可查回；无第二次 PUT，未决字节保留 |
| 错误内容、版本、缺失或未证明 writer 终结 | 不切换，不释放源或目标量 |
| 已有副本后再显式退休 | 复用目标、不新增计量，重新核实读回/别名/读者后交给同一 C2 executor |

- 真实 DB 覆盖重复/并发登记、超额、原始身份不变、未绑定 URL 新任务/封面竞争、hold、COPY/switch/replay/源退休及 full/additive 历史；不能用 schema capture 代替行为验收。
- 实际 LOCAL/模拟 S3 覆盖版本/长度/摘要、staging、迟到 ACK、不能二次 PUT；Linux inotify 覆盖默认命令从初始化到退出的全部现存目录，最终目录相同不足以证明没有临时探针。
- `image-history-e2e-safety.test.ts` 的策略拒绝/恢复与有界诊断 mock 必须包含真实 CLI 外壳，保留 `progress.items` 中的读者证明与安全错误码；两种实际图片拓扑须用真实命令再次验证。正例是按序列化后的公开结构解析，基线是保留内部 report 的独立类型；反例是消费者和 mock 共同发明顶层 `items`，或用 flat/nested fallback 掩盖错误协议。
- 反例：为旧文件伪造 COPY reservation/CONFIRMED；正例：记录 SOURCE observation 后由专用 observed 分支入账。反例：将 old R2 字符串继续直接交给浏览器；正例：保留其数据库事实并投影稳定的 managed token URL。
