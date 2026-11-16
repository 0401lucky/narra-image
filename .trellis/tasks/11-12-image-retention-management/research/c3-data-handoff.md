# C2 → C3 数据与恢复协议交接

状态：C2 的交接研究，**不是已实现的 C3 功能**。本轮只写文档；C3 须在主会话完成 C2 质量 gate 并激活 `11-12-image-history-migration` 后实施。依据该任务已批准的 [PRD](../../11-12-image-history-migration/prd.md)、[design](../../11-12-image-history-migration/design.md)、[implement](../../11-12-image-history-migration/implement.md)，以及父设计第 2、5、7、8 节。以下新增模型、函数和方法名均为具体提案。

## 1. 可直接接入的 C2 基线

C2 最终数据版本和实际证据见 [data-interface.md](./data-interface.md)：SQL SHA `2d65ec945b167fac0df3a8e08d6f6d92cbdcf9545dd23b5eaa05d978ecf2bdcb`；media 417 / Canvas 196 项 catalogue；完整历史、追加升级各 60 个 DB case，其中 14 个 C2 case。这里只交付数据层事实，整体 CI/浏览器/部署门禁以主会话记录为准。

| 已有能力 | C3 可复用的边界 |
| --- | --- |
| `ImageRepository.PrepareCopy` / `prepareCopy` | 在额度锁内创建或查回 COPY reservation，并绑定既有 AVAILABLE asset；不是已存在源对象的登记入口。 |
| `BeginObject` / `beginObject` | 新目标在 IO 前登记并物化预算。相同 reservation/slot 重放只返回原对象，`writeGranted=false`，不重新授权 PUT。 |
| `FinishObject` / `finishObject` | 有效原始写租约内确认 PUT；UNKNOWN 保守计量。不能把过期/UNKNOWN 对象通过再次 CONFIRMED 变成 READY。 |
| `BeginRead` / `beginRead` | 返回受保护的当前活动副本；45 秒保护、实际 IO 至多 30 秒。不能用它读取尚未活动的迁移目标，C3 需要受 COPY/协调租约保护的目标读回入口。 |
| `ActivateObject` / `activateObject` | 对 READY 对象执行当前指针 CAS；本身没有“已经从目标存储读回并算完 SHA256”的持久证明。 |
| `RecordReplicaVerification` / `recordReplicaVerification` | 校验同图源/目标、内容、精确 aliases、reader revision，并保存源退休证明；要求目标**已经是 activeObject**，不执行外部 IO。 |
| `RequestSourceRetirement` / `requestSourceRetirement` | 把源交给唯一 C2 删除执行器。实际 mode 是 **`SOURCE_RETIREMENT`**，不要复制旧设计中的 `MIGRATION_SOURCE_RETIREMENT` 名称。默认保留源。 |
| quota/cleanup/alias/roots | 继续使用全站额度、不可变物理 key、ImageReference、精确 alias 和同一 finalizer；C3 不直接删除源、修改 usedBytes 或清 Canvas 账户 bit。 |

C2 已证明：托管 Canvas 七天/永久输入根保护、双副本逐项减物理量、最后副本完成后才清一次逻辑账户量、UNKNOWN 删除重试及过期 Canvas token 续期。最后一步的固定顺序为：全物理副本完成 → 两层仍 DELETING 时续期 Canvas token → ImageAsset DELETED → CanvasImportAsset DELETED。C3 不得改回相反顺序。

## 2. 现有 schema 不能表达独立 observed-object

源码依据：`prisma/schema.prisma` 的 `ImageObject`；C1 migration 的 `image_guard_object`、`image_account_delta`、`image_assert_reservation_balance`、`image_begin_object`；C2 的 `image_cleanup_reason`、`image_guard_maintenance_object`、`image_retirement_reason`。

- `ImageObject.reservationId/slot/writeToken/writeExpiresAt` 全部必填。INSERT guard 要求真实 ACTIVE reservation、相同 owner/token/slot、未过期原租约，以及 `WRITING + NOT_STARTED + accounted`。
- reservation 的剩余预算受延迟 balance trigger 校验；对象与预留变化只有 `image_account_delta` 可以计入全站用量。新对象正向计量超过 `limitBytes` 会拒绝，策略关闭也不会关闭额度 gate。
- C1 的 INPUT→GENERATED 只允许 `backfill-image:<imageId>`、原 `GenerationImage.mediaStorage/mediaAssetId IS NULL` 的新复制。源码已明确它不是 adoption；COPY 同样表示**将要新增的目标物理副本**。
- 物理唯一性实际是 `UNIQUE(physicalNamespace,key)`，不是只按 `locationId`：S3 namespace 不因 region 别名变化就成为另一份物理对象。观察同一 key 时必须查回原 inventory，不能再计一份。

因此不能创建一个虚假的 INPUT/COPY reservation，再伪报 CONFIRMED 来“导入”旧 S3 文件。也不能把副本大小塞到 reservedBytes、临时抬高 policy limit，或在工具中直接 UPDATE ImageQuota。

### 最小模型提案

| 模型 / 增量 | 必要字段与约束 |
| --- | --- |
| `ImageHistoryJob` | `id/requestKey`、`mode=ADOPT\|COPY`、冻结 source bindings/范围摘要、稳定扫描上界/游标、`targetLocationId?`、显式 `retireSource=false`、创建者、状态/取消。相同 requestKey + 改变 intent 必须冲突；dry-run 不创建此行。 |
| `ImageHistoryItem` | 不可变 `subjectKind/subjectId/ownerId/expectedBusinessSnapshotHash`、来源 tuple/key、已捕获原始身份；`sourceObservationId/assetId/sourceObjectId/targetObjectId/reservationId`、`attempt`、阶段、执行 token/expiry/退避、安全错误。保存 COPY intent/key，重入不能重新随机生成。扫描顺序固定，不按 updatedAt 续扫。 |
| `ImageObjectObservation` | append-only `id/requestKey/itemId`、`kind=SOURCE\|TARGET_READBACK\|WRITE_RECONCILIATION`、确切 provider/location/physicalNamespace/key、size/hash/MIME、版本/ETag/LastModified、原业务快照摘要、观测结果、数据库 recordedAt、受信执行者及 IO/原 writer 证据。ETag 和“HEAD 成功”不等于内容 SHA256；凭据和服务器绝对路径不入公开 DTO。 |
| `ImageHistoryReference` | adoption 尚未绑定 asset 时的输入证据：`itemId/ownerId/kind/referenceKey/exactUrl或原业务ID/permanent`；JOB_INPUT 不随 User/Job 删除而级联消失。可作为 item 的关系子表；不要用一次临时扫描结果替代持久根。完成 adoption 后幂等写入 ImageReference，历史证据仍保留。 |
| `ImageObject` 判别字段 | 新增 `provenance=WRITE\|OBSERVED`、`sourceObservationId?`。WRITE 继续要求原 reservation/slot/token/expiry，observation 为 NULL；OBSERVED 要求独立 observation，四个写入字段为 NULL。用 CHECK + FK + guard 严格表达两种形状，不能只把列改 nullable。 |
| `ImageAsset` adoption hold | `adoptionItemId?` 或等价可验证关系。未完成身份/alias/根接管前，eligibility 必须返回 `ADOPTION_PENDING`。item 成功后才解除；不能让一个已计量、尚未补根的 READY 源短暂成为清理候选。 |

对没有新 PUT 的已验证源，建议明确使用 `putOutcome=NOT_APPLICABLE`，不伪报一次本系统写入。如果原 Canvas 记录本来是 UNKNOWN/DELETING/版本异常，observation 必须携带原事实；它不因此成为可读、可迁移或可删对象。已知大小的未决物理风险应保守计量并保持隔离，原业务 URL 继续保持原语义；不要提前注册一个指向 QUARANTINED asset 的 alias，让原本未纳管的链接突然变成不可用。

observation 的未核实结果允许 size/hash/MIME 缺失，不能填零或假摘要凑成 ImageObject。已有 Canvas 的声明 payload 可作为未决写入的保守身份依据；只有 URL/HEAD、尚不能核实归属或内容的项先保留为待盘点证据，已知待核实字节单列，不冒充精确受管理用量。完整证明一旦成立，实际字节即使使额度超限也必须入账。

观察字段与原有写入字段应分开：原 `putOutcome=UNKNOWN` 不因为补了一条证据就被无痕覆盖。若 C3 提供正向写入协调，增加 `reconciliationObservationId`，以独立、不可变证明决定有效可读状态，保留原 UNKNOWN 事实；详见第 4 节。若证据不充分则维持 UNKNOWN，不实现一个“到期自动确认”的通道。

### 诚实计量与 schema 演进

推荐在唯一 accounting trigger 内加入严格的 **OBSERVED 插入分支**：只有专用登记动作消费了与该行所有身份/内容完全匹配的 source observation，才允许已存在的真实对象使 `usedBytes + reservedBytes > limitBytes`。这是既有存储事实入账，不发写授权、不给可花的负预留；COPY/INPUT/OUTPUT 的正向准入继续沿用原 gate。不能用任意可设置的 session GUC 或请求字段 `ignoreQuota` 开例外。

- 重复 observe/adopt 必须在物理唯一约束下返回原对象，delta=0；同 key 内容/归属冲突先隔离，不按第二个 owner 或 location 重复计量。
- 源 S 字节已存在，复制目标 T 字节另行预留：创建目标前为 `used=S,reserved=T`；物化后为 `used=S+T,reserved=0`；只有 C2 源退休确认后才减少 S。Canvas 的账户量始终是一份逻辑导入。
- 已登记超额保持真实数字。C2 的超额 QUOTA 收敛和后续准入拒绝可以复用；不能在登记事务内同步清理，亦不能绕过 protected/UNKNOWN 规则追求数值低于 5GB。
- 检查单对象边界：C1 `image_bytes`、asset/object CHECK、DTO 与 LOCAL reader 限 50MiB，Canvas 仍有 8MiB 约束。不能将可核实但超出迁移支持范围的历史对象截断成 50MiB 或记为 0。C3 的 observation/计量事实需容纳真实 BIGINT；不支持复制的行标为受保护的不可迁移项。若扩展 observed inventory 的长度约束，仍在 WRITE guard/入口保持现有新上传上限，不能顺带放宽上传产品规则。
- 当前 C2 多处直接使用 `putOutcome='CONFIRMED'` 或 INNER JOIN reservation。OBSERVED 分支必须逐一显式接入，尤其是未知写入判断、原 writer 栅栏、删除 token guard、source retirement 和 finalizer；nullable reservation 不能让 INNER JOIN 静默跳过保护。
- Node `imageObjectSchema` 与 Go `ImageObjectRecord` 目前要求上述字段非空。新增判别形状需要共享 contract、两端 DTO/decoder、schema inventory、readiness 和 rollback preflight 同步。建议新 storage/reader/executor revision 3，继续保留 scene/run wire 1；最终编号由 C3 共享事实源一次确定，不能让 C2 Worker 部分兼容新 nullable 行。
- 只追加新 migration，不修改已交付 C1/C2 SQL；重新捕获 media/Canvas 有效 catalogue，并跑完整历史、追加升级与 Prisma 零漂移。

## 3. 来源身份和保护接管

| 来源 | 已有事实与桥 | C3 必须补的动作 / 限制 |
| --- | --- | --- |
| `GenerationImage` | `mediaAssetId` guard 验证 owner、GENERATED purpose、origin 与 AVAILABLE；C2 `ImageGenerationBinding` 持久保存原 image/job/owner，补 exact OLD/NEW HTTP URL aliases、旧 Canvas result/run 根；Save/Run 已按 GenerationImage 有序 FOR SHARE 防晚绑定竞争。 | 核实来源后只 CAS 原绑定；保留 image/job ID 与原 url/mediaStorage/storageKey 来源事实。已有 `mediaStorage='S3'` 的图片不能走 NULL-only backfill。单独的 storageKey 没有 endpoint/bucket，必须由显式 source binding + 对该精确 key 的实际验证补足。 |
| `CanvasImportAsset` | 原 sourceProvider/location/endpoint/region/bucket/key、上传身份和 payload 不可变；C1 adoption guard 要求旧行 READY/CONFIRMED、无版本/删除 token、旧 GC lease 不活动。`canvas_bridge_adopted_import` 已从旧 SavedAssetUse/JobAssetUse 补 managed roots。 | 首先登记**原 tuple 对应源副本**再绑定 mediaAssetId；迁移 LOCAL 只追加目标，不修改 Canvas 原 tuple。无根原图的 `ImageAsset.detachedAt` 取可信原值与新观察/接管时间中的保守值，不借 adoption 缩短 604800 秒。UNKNOWN/DELETING 原行不得强转 READY；若先计入未决 inventory，持久 adoption hold 还须让兼容 GC 排除该精确原图，避免双执行者。 |
| 普通参考 URL / `GenerationJob.sourceImageUrls` | 普通上传旧实现只保留 URL，很多没有独立上传 registry；C1 job trigger 为已知 alias 写永久 JOB_INPUT，C2 alias 插入会回扫既存 jobs，eligibility 还检查现存 exact URL。ImageReference.ownerId 是引用者，不能由某个 consumer 猜原物理对象 owner。 | 从旧 job/已知上传路径的数据库事实发现候选，再用明确 source binding 核实物理身份；未知/第三方 URL 不 adopt。同一个 URL 多次消费只给同一物理记录加根，不能重复创建副本。冻结 sourceImageUrls 不改写。已经 cascade 消失且没有历史证据的旧未纳管输入不能凭空恢复，要报告这个扫描边界。 |
| 保存场景 / 已提交 run | C1 覆盖 imported ID；C2 覆盖历史及晚绑定 result imageId/jobId，并保留 COMMITTED 的永久输入根。Canvas 删除只移除 saved 组织根，不移除 job-input 根。 | 对观察到的原 IDs 和 owner 接管，不重写 scene、run inputSnapshot 或客户端本地草稿；draft 不伪造服务器 root。正式解除 adoption hold 前核对旧根和本次并发写入捕获的根均已落库。 |
| 精选/审核、站点封面 | `GenerationImage_image_showcase` 在 mediaAssetId/showcaseStatus 变化时覆盖 FEATURED/PENDING/TAKEDOWN_PENDING；LoginCoverConfig trigger + alias 历史桥覆盖当前 `mode=custom` 的精确 customUrl。 | 复用这些真实字段；不因为 URL 看起来像图片就把视频专用封面、PromptLibrary 第三方图或未登记桶对象纳入。封面属于共享站点引用，使用既有 `ownerId='site'` 规则。 |

`ImageUrlAlias` 是不可变的**精确字符串**映射；同一 URL 不能改指另一 asset。不要通过 URL 前缀、basename、删 query 或套用当前默认 S3 配置推断所有权。显式 source binding 只限定受信的原存储 namespace；仍须把数据库中这一条原身份与确切 key、实际内容连起来。远端任意 URL 的 SSRF/DNS/重定向边界保持原样。`data:` 没有可接管的物理源；其持久化属于新写入/窄 backfill，不算 observed-object。

一个物理 key 被两个不兼容的 GenerationImage/owner 身份认领时，现有 `GenerationImage.mediaAssetId UNIQUE` 与 asset origin 不允许随意合并。最小安全行为是报告 `PHYSICAL_IDENTITY_CONFLICT`、保留原可读路径和一次物理计量，不改唯一约束来制造两个所有者；普通引用者则可以共享同一 asset 的精确 alias。

### 不能把现有回扫当成完整的 adoption 并发协议

`image_bridge_known_history` 对 jobs/covers 的回扫是普通 SELECT；C2 的 GenerationImage FOR SHARE 修复覆盖 ID 绑定与 Canvas Save/Run，**没有为尚不存在的 URL alias 建立共同写入锁**。例如 job 先检查到 alias 不存在，而并行 alias 插入看不到未提交 job，双方提交后仍可能没有永久 root；现存 job 的 eligibility fallback 不能替代任务日后删除仍保留的根。

C3 需补两件事：

1. apply 的持久 item 捕获已知旧根，涉及仍未绑定的永久输入保存到 `ImageHistoryReference`。活动 adoption 期间，新输入写入也参与该捕获；不要等完成数分钟 IO 后再只扫仍存活的业务行。
2. 精确 URL/subject 的有序事务协调锁与 adoption finalizer共用，覆盖 alias 创建、普通 job 输入、当前封面及业务 media 绑定。最后一次 recheck/alias/root 接管在锁内完成，然后才解除 hold。锁应在会取得 asset/原图等锁的业务动作前取得；仅在现有 AFTER trigger 尾部补一个 advisory lock 可能引入反序死锁。

保持现有 quota→history job/item→reservation→CanvasImportAsset→ImageAsset→ImageObject 顺序；URL/subject 协调须在此链之前设计并由相关生产入口共同参与。GenerationImage 的行锁还必须保留与 Canvas Save/Run 一致的先后关系。adoption 不得在持有 quota/asset 后再锁 Canvas 文档、run 或 owner。C3 应明确每个入口的完整顺序并用两连接验证；只让 CLI 单方加锁没有并发保护作用。IO 不持有这些事务锁，持久 item/hold 负责间隙保护。

## 4. COPY 恢复：哪些情况现在能重入

| 当前状态 / 中断位置 | C1/C2 实际行为 | C3 应采取的动作 |
| --- | --- | --- |
| 目标已 READY/CONFIRMED，ACK 丢失 | BeginObject 返回同一个 target，writeGranted=false。 | 查回已持久的 item/reservation/slot/key，实际读回目标、核对内容后继续验证/切换；不再 PUT。 |
| 只创建 reservation，还没有 object | 有效租约可首次 BeginObject；相同 ACTIVE intent 已过期会拒绝，CLOSED intent返回旧行。 | 状态查询与 item CAS 判定原 grant 是否发出；只对证明未发 IO 的新尝试分配新 intent/key，不能将旧行重新 ACTIVE。 |
| WRITING，原 lease 尚有效 | 重放仍不给第二个 grant。 | 由原唯一执行者完成；别的执行者等待/检查 journal。数据库 lease 不是撤销已发送存储请求的能力。 |
| WRITING 已过期 / UNKNOWN / needsReconciliation | 原 writeExpiresAt 不可改；CONFIRMED 分支不能恢复 UNKNOWN，UNKNOWN sticky guard 禁止无证明清除；关闭 reservation 只减未物化预算。 | 保留对象字节和 COPY 关联，进入 RECONCILING/BLOCKED。新增有证据的协调入口，不通过改时间/改原 outcome/关闭预算假装对象不存在。 |
| 已明确 NOT_WRITTEN / DELETED、无未决 IO | 原 slot/key 仍不可复用。 | 可以创建与原 item 相连的新 attempt、新 intent、新目标 key，重新通过正常 COPY gate；已有目标不删除重造。 |
| LOCAL `OBJECT_EXISTS` | Put 的 O_EXCL/不覆盖 hard link 拒绝第二次写；它不是一个成功 PUT 回执。 | 只读打开该精确注册对象，验证卷、文件身份、无 pending、完整长度/hash；经新协调入口认领既有正确结果。内容不符就隔离，不覆盖。 |
| LOCAL `.writing` 尚在 / staging-only | Read/Head/Delete 都保守拒绝；崩溃可留下 staging。 | 检查原执行者与在途 IO；不能见到文件老或 final missing 就 unlink。若要恢复 staging，新增受 item token/实际文件身份/原 writer 终止证明保护的精确操作，不清目录、不接受任意路径。 |
| HEAD/GET missing、超时、403、未知 S3 版本 | 都不能证明先前 PUT 永远不会完成。 | 记录观测，继续计量与等待/报告 blocker。不能因 lease 到期或一次 missing 自动 NOT_WRITTEN，也不能借新 attempt 丢弃旧未知计量。 |

LOCAL 实现位置：`worker/internal/worker/image_local_store.go`、`src/lib/storage/local-image-store.ts`。两端都先检查 `.writing`、排他创建 staging、完整验证、hard-link 发布且不覆盖。旧 writer 的延迟写入与遗留 staging 必须在 C3 的证明模型中区分；“当前进程没有 handle”不等于旧进程/远端 PUT 已结束。

### 需要新增的短事务接口

以下均只在 apply 路径使用；Go 方法首参 context，SQL 继续 `image_*(jsonb) -> jsonb`，字节使用 JSON 十进制字符串。源/目标 IO 在事务外，由受信 CLI/Worker 收集实际证据。

| 提案 SQL / Go repository 方法 | 输入 → 输出 / 事务职责 |
| --- | --- |
| `image_scan_history` / `ScanImageHistory`（只读） | `{scope,cursor,limit}` → 有界候选、原业务快照、下一稳定游标；不调用 RegisterLocation，也不创建 job。 |
| `image_begin_history_apply` / `BeginImageHistoryApply` | `{requestId,planDigest,scope,sourceBindings,targetLocationId?,retireSource:false}` → 固定 job；apply 明确登记位置、冻结范围和保护范围，改 intent 冲突。 |
| `image_claim_history_item` / `ClaimImageHistoryItem` | `{jobId,workerId,token}` → 当前 item/epoch/阶段/确切 IDs；建立持久 hold。接管 token 不能自动转化为第二份 PUT 权限。 |
| `image_record_object_observation` / `RecordImageObjectObservation` | `{itemId,token,kind,sourceSnapshotHash,locationId,key,readResult,byteLength,sha256,mimeType,versionEvidence,writerEvidence}` → 不可变 observation ID；严格关联该 item，不能接受管理员网页的 `verified:true`。 |
| `image_adopt_observed_object` / `AdoptObservedImageObject` | `{itemId,token,observationId,expectedBusinessSnapshotHash}` → `{assetId,objectId,replayed,accountedDelta,overLimit}`。在共同锁下核对 snapshot、独立 provenance 入账、CAS 绑定业务、精确 aliases、永久/当前根与 hold 完成；不发 PUT grant。不能用调用方再次填写的 size/hash 覆盖 observation。 |
| `image_get_history_item` / `GetImageHistoryItem`（只读） | `{itemId}` → 原阶段/源目标/reservation/attempt/结果；用来恢复数据库 ACK 丢失，而不是创建第二个 job。 |
| `image_prepare_migration_copy` / `PrepareImageMigrationCopy` | `{itemId,token,expectedSourceObjectId,targetLocationId}` → 持久 target descriptor + 唯一 grant；原子绑定 item 与现有 PrepareCopy/BeginObject。DB 生成并保存稳定 intent/key，额度不足不发 grant。 |
| `image_prepare_copy_reconciliation` / `PrepareImageCopyReconciliation` | `{itemId,token,expectedTargetObjectId}` → 仅协调观察 descriptor/expiry/原 writer 状态，不给 PUT/DELETE grant、不释放预算或对象字节。 |
| `image_finish_copy_reconciliation` / `FinishImageCopyReconciliation` | `{itemId,token,observationId,expectedOriginalWriteToken}` → `{accepted,state,byteDelta:"0"}`。只有完整正向读回、不可覆盖身份、版本和原在途 writer 证据全部满足才恢复有效 READY；保留原 UNKNOWN 审计事实。missing/不充分证据只能继续 BLOCKED，不能清计量。 |
| `image_commit_migration_switch` / `CommitImageMigrationSwitch` | `{itemId,token,targetReadbackObservationId,expectedActiveObjectId,expectedAliasManifest,readerProtocolRevision}` → `{switched,replayed,replicaVerificationId}`。证明先于切换；短事务中检查实际 target/manifest、CAS ActivateObject，再调用 C2 RecordReplicaVerification（它要求 target 已 active），并保存 item 阶段。 |

`RecordImageObjectObservation` 的 TARGET_READBACK 可复用为复制校验证据，不必再发明另一个会计来源。新的协调 helper 需要让原 WRITE、已验证 OBSERVED、经过严格正向协调的 WRITE 明确走各自 readiness/eligibility 分支；所有读取、COPY、清理 guard 和 source-retirement 必须使用相同判定。不能只修改一个 FinishObject 分支，使别的查询仍把该对象当 UNKNOWN 或反过来漏检。

对于“grant 发出后进程失联、存储结果不可判定”保留 BLOCKED 是有效恢复结果，不应承诺所有失败都能自动继续。若无法给出原远端 PUT 已终结的证据，原未知对象继续计量；不能用一次 negative observation 创造释放量。已经确认的 source 始终保留并继续服务。

`CommitImageMigrationSwitch` 成功不代表源已退休。默认 item 到 SOURCE_RETAINED；只有 frozen intent 显式选择 retire，才以稳定 requestId 调 C2 `RequestSourceRetirement`，查回同一个 maintenance job。源删除 FAILED/UNKNOWN 继续计量，C3 的重试不再直接调用 DeleteObject/unlink。alias manifest 变化、active target 变化或 reader 证据过期都重新验证；不复用旧 proof 强行退休。

## 5. 默认 dry-run 必须从根入口分离

当前旧命令 `worker/cmd/backfill-media/main.go` 的 `--dry-run` 默认是 false，而且调用 `NewStorage` 后才进入逐行 DryRun 分支；它还扫描视频。因此只能参考 flag/output 风格，不能直接拿它作为 C3 的默认入口。

已确认的副作用：

- `NewStorage` → `initializeManagedImages` → LOCAL `ProbeWritable`。ProbeWritable 会创建两个零字节测试路径、hard-link、sync、删除；最终清理成功也不是“零写入”。`verifyManagedImages` / Node `verifyManagedImageStorage` 的 LOCAL 分支同样会写探针。
- `ImageRepository.RegisterLocation` 是真实 INSERT/UPDATE，可改变 `publicBaseUrl`；“先确保位置存在”不能出现在 dry-run 中。
- `PrepareCopy`、`BeginObject`、RegisterAlias、CloseExpiredReservations、maintenance enqueue 及默认启动 Worker loops 都会写 DB。不能为了盘点复用整个 Worker 初始化。

C3 CLI 默认选择只读 planner，显式 `--apply` 后才构造写入/可写探针依赖。只读路径使用纯 `NewImageS3Location/NewImageLocalLocation` 计算身份、SELECT 查现有位置、`LocalImageStore.Verify` 验证已有 marker；不存在 marker/位置时报告未准备，不自动初始化卷。源 HEAD/GET 可以是有界的只读核实，仍要验证确切 endpoint/bucket、版本证据和内容；LOCAL Verify 不证明可写，dry-run 输出需如实显示“尚未验证写能力”。

建议 planner 的 DB transaction 设置 READ ONLY，并注入只提供 Head/Get/Verify 的窄存储接口；无 Put/Delete/ProbeWritable/RegisterLocation 能力。默认输出 stdout，显式指定报告文件可写工具输出，但不写业务库、checkpoint、图片卷、probe 或 bucket。apply 必须重新核对 planDigest/业务快照和真实可写能力，不能把旧 dry-run 结果当永久授权证明。

测试应记录全过程的 DB mutation 与文件/模拟 S3 mutation 调用，不能只对比结束后的目录：创建再删除的零字节 probe 也必须让 dry-run 测试失败。

## 6. 受影响文件与实施切分

| 切分 | 实际文件 / 新文件提案 |
| --- | --- |
| 数据与共享事实 | `prisma/schema.prisma`；新的追加 migration；`contracts/media/v1/{contract,maintenance,schema}.json` 及新 history contract；若改 Canvas bridge/兼容 GC hold，同步 `contracts/canvas/v1/schema.json`。 |
| repository / decoder | `src/lib/storage/{image-contract,image-repository,image-schema,image-maintenance-contract}.ts`；`worker/internal/worker/{image_contract,image_repository,image_schema,image_maintenance_repository}.go`；可把新增方法拆为 `image_history_repository.go`，保持统一 JSON/错误风格。 |
| CLI 与恢复 IO | 新 `worker/cmd/image-history/main.go`、`worker/internal/worker/image_history.go`；只读 inspector 与 apply writer 分开；复用 `image_local_store.go` / `local-image-store.ts` 的路径/文件身份约束，不复制一个宽松文件删除器。 |
| 引用并发入口 | migration 中 job/alias/cover/generation binding/Canvas adoption bridges；相关业务 transaction 入口包括 `src/app/api/generate/route.ts`、`src/lib/canvas/`、外部生成/gateway 与 Go job 写入路径。先用实际调用链确定共同锁从哪里取得，不能只补 CLI。 |
| 读取/删除兼容 | `src/lib/storage/managed-image-storage.ts`、`worker/internal/worker/image_managed_storage.go`、C2 maintenance storage/executor；SOURCE_RETIREMENT 仍交给原执行器。 |
| probes/发布/回滚 | 两端 readiness/capability 和 rollback preflight；共享 schema fixtures、README/部署文档与镜像/Compose。新增 unresolved history/observation 也进入旧代码回退检查。 |
| 验证 | C3 新真实 DB suite；现有 image-storage/image-retention/Canvas full+additive；Node/Go schema/contract；dry-run 零副作用；真实 LOCAL/模拟 S3 中断与两种拓扑 E2E。 |

先完成独立 observed-object 与保护接管，验证后再实现 copy/reconciliation；source-retirement 只在这些证明完整后接入。不要先写一段直接 S3→LOCAL 复制命令，再尝试补账和根。

## 7. C3 最小验收矩阵

1. 同一源两次/两进程 observe/adopt 只计量一次；错误 bucket、内容冲突、第三方、视频及未知对象明确分类。已知源使总量超过 5GB 仍如实入账，随后 COPY/新增写入拒绝或走原清理 gate。
2. 旧生成、Canvas 原 tuple、普通参考、保存 result/imported、COMMITTED 输入、精选/审核/当前封面分别纳管；身份/冻结快照不变，用户/任务删除后永久根仍可证明。包含“新 job/cover 在 alias 尚不存在时提交”的两连接竞争，以及 adoption hold 与 cleanup 的竞争。
3. 默认 CLI 从初始化至退出都没有 DB mutation、ProbeWritable、PUT/DELETE、卷 marker 或 checkpoint 写入；对 RegisterLocation/NewStorage 的误调用有真实副作用计数断言。
4. 中断点至少包括 grant 前、grant 后/PUT 前、staging 中、发布后/DB ACK 前、READY 后/读回前、读回后/切换前、切换后/proof ACK 前、源退休 ACK 丢失。重入保持同一 target identity；UNKNOWN/missing、遗留 staging、错误内容/版本保持计量。
5. 目标完整读回通过才切换；目标失败仍读源；保留源没有回收字节。显式源退休成功才减源用量，失败/UNKNOWN 保留；逻辑资产、永久根和 Canvas 账户量不被源退休修改。
6. 真实受控卷重建后读取同一内容，embedded/dedicated reader/worker revision 与卷身份一致；旧 Worker drain、schema/DTO gate 和 rollback preflight 生效。模拟存储通过不等于真实 R2 已迁移或站外旧 URL 能继续访问。

交付边界：C2 提供删除、额度、根、别名和源退休消费者；上述 observation/历史范围/写入协调接口仍需 C3 实施与验证。C3 默认保留源，生产迁移和显式源删除仍由用户实际执行/授权。
