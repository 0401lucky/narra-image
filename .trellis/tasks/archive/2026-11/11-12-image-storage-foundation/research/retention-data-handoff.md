# C1 → C2 图片清理数据交接

状态：接口提案，尚未实施 C2；须由主会话完成 C1 门禁并激活 `11-12-image-retention-management` 后采用。依据该任务已批准的 PRD/design/implement 及父设计第 2、5、6 节。C1 的 `ImageAsset / ImageObject / ImageWriteReservation / ImageReference / ImageQuota / ImageStoragePolicy` 是唯一基础，不再从业务行推算物理量。**受管理物理副本 + 尚未物化的预留**的合计上限默认 5,000,000,000 字节；同图两副本计两份，不是数据库/WAL/日志/缩略图缓存的大小上限。

## 建议的最小持久模型

| 模型 / 增量 | 字段与职责 |
| --- | --- |
| `ImageMaintenanceJob` | UUID id；`mode=MANUAL_AGE/MANUAL_ALL/SCHEDULE/QUOTA/SOURCE_RETIREMENT`；`state=PREVIEW/QUEUED/RUNNING/WAITING/SUCCEEDED/PARTIAL/FAILED/CANCELLED/EXPIRED`；不可变 requester、规范化 intent/hash、policyVersion、createdAt；previewExpiresAt、confirmedRequestId、confirmedAt；ageCutoff、quotaNeededBytes、quotaReclaimTargetBytes；游标 `(assetCreatedAt,assetId)`；workerId/token/leaseExpiresAt/nextAttemptAt/cancelRequestedAt/completedAt。**PREVIEW 行本身就是持久预览**，确认仅转状态，不复制另一份候选清单。 |
| `ImageMaintenanceItem` | UUID id；jobId/assetId/objectId；不可变 objectBytes、assetCreatedAt、expectedActiveObjectId、该资产的完整对象 manifest hash；`state=CANDIDATE/CLAIMED/RETRY/DONE/SKIPPED/FAILED`、skipReason、releasedBytes、completedAt。一条物理对象一项，`UNIQUE(jobId,objectId)`；同一逻辑资产的全部项组成不可拆散的领取组。复用 `ImageObject.deleteToken/deleteExpiresAt/deleteAttempts/nextDeleteAt/deleteOutcome` 作为物理领取事实，不另造一套可独立漂移的 object lease。 |
| `ImageMaintenanceLease` | 单行 scope=`images`、workerId/token/expiresAt。统一执行器持有有界 lease；多 Worker 可接管同一持久任务。先采用单一全站执行者，防多个容量任务各自按同一空闲量过度删除；它与仍只处理未纳管 S3 的 Canvas compatibility GC 不争同一对象。 |
| `ImageReplicaVerification` | 源退休的内部证明：UUID id、assetId/sourceObjectId/targetObjectId、已实际读回的 byteLength/sha256、精确旧 URL 集合及 alias manifest hash、readerProtocolRevision、数据库 verifiedAt；身份/内容不可变，可撤销但不能改成另一副本。C2 定义消费者契约，C3 的受信校验步骤写入，不对管理网页开放“宣称校验通过”的入口。 |
| 原表关联 | `ImageAsset.deleteJobId?` 固定整图清理所有权；`ImageObject.deleteItemId?` 固定物理项所有权，重试不换项。均保留审计，FK 不 cascade 删除原资产/对象；禁止业务 User/Job 删除抹掉清理记录。 |
| 读取 / 复制准备保护 | 建议 `ImageObject.readProtectedUntil?`，由原子读取描述符函数延长；所有 Node/Go 托管读取必须使用并服从更短的 IO deadline。建议 `ImageAsset.copyReservationId?/copyProtectedUntil?`，显式绑定 COPY 准备期；不能从 intentKey 猜所属资产。C1 COPY 只有 begin 后才关联资产，单有未绑定 reservation 并不能证明某资产正在迁移。 |

bytes 均 BIGINT，JSON 均规范十进制字符串；日期采用数据库时钟和 ISO 字符串，ID/摘要沿用严格结尾校验。公共 job DTO 由 item 事实聚合计数和实际释放量；不要让可任意更新的 UI 计数成为另一个计量来源。跳过原因用固定 enum，例如 `REFERENCED/ACTIVE_WRITE/ACTIVE_JOB/READING/COPYING/CANVAS_GRACE/UNKNOWN_PUT/VERSIONED/STORAGE_UNAVAILABLE/SNAPSHOT_CHANGED/POLICY_CHANGED/ALREADY_CLAIMED`。

## 统一 SQL 与两端接口

动作延续 `image_*(jsonb) -> jsonb`，Node/Go 共用契约并只封装参数和 DTO；业务异常仍走精确 SQLSTATE 23514 + 白名单消息。下列名称是建议，不是已存在的 C1 方法。

| SQL / repository 方法 | 输入与返回 |
| --- | --- |
| `image_get_storage_overview` / `getStorageOverview` | 有界查询参数 → C1 usage/policy、可清理量、按原因保护量、最近任务；未纳管条数/已知旧字节单列，未知大小为 null，不能合并到 quota 承诺。 |
| `image_update_storage_policy` / `updateStoragePolicy` | `{expectedVersion,limitBytes,enabled,quotaCleanupEnabled,scheduleEnabled,retentionDays,intervalSeconds}` → 新 policy；CAS，降低上限不直接删对象或改 usedBytes。 |
| `image_preview_cleanup` / `previewCleanup` | `{actorId,previewRequestId,expectedPolicyVersion,mode,retentionDays?}` → `{previewId,policyVersion,expiresAt,assetCount,objectCount,estimatedBytes,truncated}`。服务端生成候选，不接收客户端物理路径或可任意扩大的 ID 清单。 |
| `image_confirm_cleanup` / `confirmCleanup` | `{actorId,previewId,requestId,expectedPolicyVersion}` → 同一个 job DTO；相同请求返回原任务，换 intent/preview 则冲突；过期、未封存或 policy 改变必须重新预览。 |
| `image_get_maintenance_job` / `getMaintenanceJob` | `{jobId,cursor?,limit?}` → job + 有界 items/progress；管理 API 先鉴权，DTO 不暴露服务器目录、凭据或原始错误。 |
| `image_request_quota_cleanup` / `requestQuotaCleanup` | 内部 `{requestId,ownerId,intentKey,neededBytes}` → 去重 job；只在 enabled 且 quotaCleanupEnabled 时排队，仍不足最终使用既有 IMAGE_QUOTA_EXCEEDED。 |
| `image_enqueue_due_cleanup` / `enqueueDueCleanup` | 无客户端时钟 → job/null；policy 行锁、`UNIQUE(schedule policyVersion,scheduledFor)`，一次推进 nextRunAt，重启/多实例不重复排队。 |
| `image_acquire_maintenance_lease` / `acquireMaintenanceLease` | `{workerId,token}` → lease/null；后续 claims 校验有效 token、Worker schema/storage/topology。 |
| `image_claim_maintenance` / `claimMaintenance` | `{executorToken,jobId,limit,verifiedLocationIds}` → 内部 claim DTO；按资产组重新判定并落库 token，返回后才允许 IO。verifiedLocationIds 只能来自 Worker 对确切位置的实际验证，不是管理员传入的布尔开关。 |
| `image_finish_maintenance_object` / `finishMaintenanceObject` | `{jobId,itemId,objectId,deleteToken,outcome:DELETED/MISSING/FAILED/UNKNOWN,errorCode?}` → `{accepted,replayed,releasedBytes,job}`；actual delta 单列，重放为 `"0"`。 |
| `image_cancel_maintenance` / `cancelMaintenance` | `{jobId,requestId}` → job；停止新资产领取，已发出的 DELETE 继续收回执，不能宣称撤销了删除。 |
| `image_close_expired_reservations` / `closeExpiredReservations` | `{limit}` → 关闭数量/释放的未物化预算；只处理已过期且无 PENDING/PROCESSING 输出任务的凭证。保留所有已登记 object 的字节和 UNKNOWN 事实。 |
| `image_begin_read` / `beginRead` | token/精确 alias/受信 assetId → `{image,readExpiresAt}`；与 asset/object 状态共锁，延长 readProtectedUntil，不能读已进入删除的对象。读取的实际期限必须早于保护期限，异常/取消应关闭流及 FD。 |
| `image_prepare_copy` / `prepareCopy` | `{assetId,ownerId,intentKey,byteLength}` → COPY reservation + 准备期限；quota→reservation→asset 原子绑定。后续 beginObject COPY 要验证此绑定，不能先开始 PUT 再补保护。 |

共享 DTO 至少包括 `ImageCleanupPreview`、`ImageMaintenanceJob`、`ImageMaintenanceItem`、`ImageDeleteClaim`、`ImageDeleteReceipt`；Go 同名 PascalCase、首参 context，字节 int64 + JSON string。claim 含确切 location/provider/key/size/hash 与 token/expiry，只交内部执行器；网页只拿逻辑进度。新的策略/预览/lease 冲突错误需先加入 media contract，不能把未知 DB 文本当业务错误。

## 同一个 eligibility，区分新领取与恢复

新领取必须在加锁后以数据库时间重查，预览 SELECT 只是估计：

1. 仅已登记图片；ImageAsset 为 AVAILABLE，或所有物理状态已可证明处理的 QUARANTINED。任何 WRITING、UNKNOWN、needsReconciliation、未知版本、未完成其他删除/迁移使整组受保护；PENDING 不靠年龄直接变成可删。已经 DELETING 的项只能由原 deleteJobId/deleteItemId 的恢复路径继续，不重新作为新候选。
2. **C1 临时准入保护**：所有相关 object.writeExpiresAt 均已到期；相关 reservation 必须先安全 CLOSED；关联 `reservation.outputJobId`，以及仍存在的 `GenerationImage→GenerationJob` 都不得为 PENDING/PROCESSING。即使 object 已 READY、asset 已 AVAILABLE，也不跳过这些条件。删除来源业务行不删除清单，也不自动证明还有在途 PUT 的对象不存在。
3. 无 ImageReference；所有 JOB_INPUT 永久保留，包括原用户/任务删除后。生成来源归属本身不是永久根。预览后新增 saved/job/showcase/site-cover 引用必须胜过旧预览，或者在 claim 已先获锁时让建立引用的事务明确失败，不能让两者同时成功。
4. **C2 启用硬门禁**：C1 的历史 GenerationImage 回填可能晚于已保存 Canvas result/已提交 run result。`GenerationImage.mediaAssetId` 变化目前不会自动重跑这些旧 scene/run bridges；因此 ImageReference 为空不是充分删除证据。C2 必须回查并保护现存 Canvas.scene result、COMMITTED CanvasRun.inputSnapshot result、实际 showcase/cover/可解析任务输入事实；并在 C2 migration/事务桥接中永久补齐历史及未来晚关联。不能等 C3 adoption 才修此安全性，也不能只依赖一次未与并发写入协调的扫描。
5. CANVAS_IMPORT 额外核实原 CanvasImportAsset 关系：原 saved/job 两张根表均为空，state 合法，uploadExpiresAt/preparationExpiresAt 已过期，detachedAt 非空且满 **604800 秒**，没有版本/UNKNOWN/原 GC delete fence。共同根、七天与全站普通年龄筛选同时成立；两处脱离时间都需有证明，存在 NULL 不能当作很早；时间不一致时采用保守的较晚时间或隔离核对。
6. readProtectedUntil、copyProtectedUntil 均不得仍有效；所有参与读/复制的旧版本进程须先 drain。C1 没有读取 lease，不能仅等待一个未经全部调用路径证明的固定秒数就声称读者已经退出。
7. 组内每个仍 accounted 的物理对象都必须 CONFIRMED、可由已验证的确切 provider/location 删除，且 versionId 为空。LOCAL 发现 `.writing`、卷错配或身份不明不是 missing；S3 版本/认证/原始响应证明未知则不领取。操作中能力失效要保持计量并重试/等待，不当成释放。

## 预览、容量与调度

- 手动 PREVIEW 固定全部 asset/object IDs、原 activeObjectId、各资产完整对象 manifest hash、估计字节与 policyVersion。确认只令这份快照 QUEUED；执行时新副本、指针或保护变化使该资产组跳过，不自动扩展到新对象。建议一次最多 1000 个资产，响应显式 truncated；超过上限必须再预览剩余，不能把未展示范围悄悄并入。若实现异步构建更大预览，未封存前不可确认。
- MANUAL_AGE / SCHEDULE 使用固定 ageCutoff；MANUAL_ALL 取消普通年龄筛选；全部保留前述保护。预计与实际分别展示，失败/跳过不能算成功回收。
- QUOTA 才能为当前预算越过普通保留天数。按 `(ImageAsset.createdAt,id)` 从最旧可领取资产开始，**一次只领取一个完整资产组**，真实 finalizer 后重算 `max(0,used+reserved+needed-limit)`。满足即停，最多多释放最后一个不可拆资产组；不预领一大批后继续全删。
- 容量 job 记录首次缺口作为回收目标；并发写入抢走已释放空间时不能无界扩大本次删除量。调用方退出原生成/扣费事务，等待有界时间并重新调用原 reserve；同 intent 重放不重复占量。重试仍不足返回容量错误，不进入 provider、不改变 v0/v1 计费政策。全站 executor lease 串行容量决策，避免多个同意图任务各自删一批。
- 管理员降低 limit，或 C3 按事实接管旧对象后导致 `used+reserved > limit` 时，容量调度器在 enabled 且 quotaCleanupEnabled 下可去重排入 `neededBytes="0"` 的有界 QUOTA 收敛任务；缺口以当前真实总量计算，仍是最旧优先和全部保护。政策关闭时仅拒绝不满足额度的新写入，不发 DELETE；受保护内容占满时保持超额事实并报告无法回收。不得在 policy/quota 锁内同步删文件，也不能为让计数低于上限抹掉历史副本/预留；C3 的已有对象登记不成为新 PUT 免配额通道。
- 保留 C1 默认：limit=5000000000、enabled=false、scheduleEnabled=false、quotaCleanupEnabled=true、retentionDays=30、intervalSeconds=86400。关闭 enabled 只停新的破坏性领取，不取消 quota gate。定时启用后由 DB 计算 nextRunAt；落后一段时间只排一个持久任务，避免补跑洪峰。
- policy 更新/取消后停止新资产组；在途回执仍可安全结算。已有 DELETING 组保留原任务和恢复信息，不能因为 policyVersion 改变而丢失；停用时不再发新的破坏性重试，重新启用后恢复原范围。

## 领取、删除回执与锁序

统一采用短事务；IO 永不进入锁内。建议顺序：**ImageQuota → policy（需要时）→ executor lease/job/items → reservations（稳定顺序）→ CanvasImportAsset（稳定顺序）→ ImageAsset（稳定顺序）→ ImageObject（稳定顺序）**。单纯续执行 lease 不反向请求 quota。C1 Canvas 锁是 CanvasImportAsset→ImageAsset，C2 绝不能先锁 ImageAsset 再补锁 Canvas 原图；不持有 quota 去等已有 Canvas/run/owner 业务锁。

- 整图 claim 设置 ImageAsset.DELETING/deleteJobId（之后禁止新根），再为该组物理项记录 deleteItemId、随机 token、expiry；Canvas 原图已提前锁好，再同步其 DELETING。source retirement 只标记源 object，逻辑图片保持 AVAILABLE。
- 复用已有 30 秒单对象 IO、45 秒单 pass、90 秒 lease 的有界思想；合同中明确最终常量。FAILED/UNKNOWN 仍 accounted，有限指数退避；过期后可以同一 item 新 token 重试确切且从不复用的 key，不能创建另一份释放记录。
- finish 校验 object 当前 token、未过期 lease、item/job 身份与 outcome。只在 `accounted=true → false` 的成功 CAS 上记录 item.releasedBytes；**ImageQuota 只由 C1 accounting trigger 减量**。不可直接再减一次 quota。ACK 丢失后相同回执返回 replay，实际 delta 为 0；旧 token 在被接管后失效。
- PUT 曾 UNKNOWN 或写入未排除的对象，即便一次 DELETE/HEAD 说 missing 也不能释放。C2 不新增“过 N 天即 absent”的协调捷径。过期 reservation 只允许关闭未消费预算，object 字节不受影响。
- 全部副本确认 DELETED/MISSING、无 accounted/reconciliation 后，才将 ImageAsset 置 DELETED、清 activeObjectId、记录原因/时间；保留 GenerationImage/job/提示词/计费事实。Canvas 原图随后一次性清除其逻辑账户计量 bit。原 Canvas guard 要求有效 deleteToken：若处理超过 90 秒，先在锁内单独更新 token 取得新期限，再做终态 UPDATE，不能在同一次 UPDATE 绕过对 OLD expiry 的检查。

## 冗余源副本退休

SOURCE_RETIREMENT 走同一 claim/item/finalizer，但不使用“无引用”作为必要条件：它允许受根保护的逻辑图片迁移，不能删除其最后可读副本。必须是显式源 object；同资产、同 size/hash/MIME 的另一个对象已完成实际读取校验、READY/CONFIRMED/accounted 且为当前 activeObject；source != active；无在途写入/复制/读取，精确旧 URL 别名及所有内部读取入口已覆盖。

退休要绑定持久的副本校验/读取兼容证据，不能接受来自管理页面的 `safeToDelete:true`。C2 可先提供内部 `image_request_source_retirement({requestId,assetId,sourceObjectId,targetObjectId,verificationId})` 和拒绝不充分证据的实现；C3 编排实际 copy/read-hash/alias 校验并写入证明。未接入全部 reader fence 时该入口必须拒绝执行，而不是假设没有读者。读取保护至少同时覆盖 HTTP/HEAD/optimizer、代理、provider 输入与 b64 输出。

退休期间禁止切走其已验证目标或并发整图删除；已领取源的 DELETING 状态和 job/item 归属必须参与 asset guard。退休成功仅释放源 object 字节，ImageAsset、其根、Canvas 原 ID/source tuple 与逻辑账户计量保持。站外原 R2 链接是否保留由 C3 的显式源删除政策说明，不由内部 alias 假装保证。

## 必改契约与验收

- 追加迁移，不改 C1 已交付 SQL。更新 `image_guard_asset`（引用/活跃工作/reader/copy/清理归属与目标保护）、`image_guard_object`（物理 token/lease/归属 CAS），必要时扩展 `image_begin_object` 的 COPY 准备绑定。保留 C1 immutable key、UNKNOWN sticky、reservation balance 与 accounting guards。
- `image_storage_revision()` 升级，media schema 支持有效迁移链及新函数/列/约束/触发器指纹；Node/Go 的严格 DTO 同步新增字段，readiness 明确报告清理 executor revision。Canvas guard/bridge 如变化，更新其有效指纹和必要能力修订；scene/run wire 不改。旧 Canvas GC 始终排除 mediaAssetId 非空的对象。
- C2 DB 套件必须新增：**先保存旧 result / COMMITTED run，再用 C1 backfill 绑定，预览与 claim 均保护**；补齐期间新 Save/Run 与 claim 竞争；预览后新 root/新副本/policy 变化；七天与活跃输出/预留/reader/COPY 栅栏；最旧优先和达到缺口即停；两 Worker/过期 token/ACK 丢失只释放一次；UNKNOWN PUT missing 负例；source retirement 不改逻辑根/Canvas 账户且拒绝最后副本。
- 物理集成测试使用真实临时文件和模拟 S3，分别验证 unlink/GET 在途、错误卷、`.writing`、版本响应、失败重试；保留 full/additive、>2GiB、永久 roots 和视频/未知媒体排除。C2 必须在允许任何 claim 前完成历史绑定保护门禁，C3 不是它的前置替代。
