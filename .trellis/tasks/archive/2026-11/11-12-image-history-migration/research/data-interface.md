# C3 数据接口（实施中）

Owner: `/root/c3_data`。追加迁移 `20261115180000_image_history`；storage/reader/executor 与 Canvas storage/GC revision **3**，scene/run wire 仍为 1。此文固定 runtime/ops 的接口；实现和实际验证状态另行报告，不把接口文档当作通过证据。

media schema readiness 同时核实完整 Canvas 存储依赖：CanvasGcLease、所有 Canvas 表字段/索引/约束、四种 enum、canvas_* 函数和 trigger。enum 在 media catalogue 中使用 `{labels:[按 enumsortorder 排列的名称]}`，Node/Go 同样按精确定义比较。独立 CLI、受管理写者及维护器即使没有启用 Canvas runtime，也不能绕过这些依赖的 catalogue 验证；两份 schema manifest 及实际 capture 现由 root 唯一维护。

## 数据格式

以下方法均已在现有 Node `ImageRepository` / Go `*ImageRepository` 上实现，仍待完整验证。Node 使用 camelCase，Go 使用下列 PascalCase 和 `ctx` 首参。Go bytes 是 `int64` + `json:",string"`；历史 DTO 的可空 ID/日期为指针。为兼容既有写者，Go `ImageObjectRecord` 的四个写身份字段保留 scalar，但 `UnmarshalJSON` 先严格核实 OBSERVED 的实际 JSON null，再以零值表示缺失；`MarshalJSON` 还原 null，绝不能把零值解释为写授权。JSON 日期来自数据库。

- `ImageHistoryScope = ALL | GENERATED | CANVAS_IMPORT | REFERENCE_URL`。
- `ImageHistorySourceBinding = {subjectKind,subjectId,expectedSnapshotHash,locationId,key,ownerId}`。每条明确绑定一个扫描主体，绝不从当前默认后端、URL 前缀或消费者推测所有者。`REFERENCE_URL.subjectId` 是精确 URL 的 SHA256；普通引用对象的 owner 由显式 manifest 指定。
- `ImageHistoryCandidate = {subjectKind,subjectId,ownerId:string|null,exactUrl:string|null,snapshot:object,snapshotHash,createdAt,classification}`。分类 `SOURCE_BINDING_REQUIRED | ALREADY_MANAGED | DATA_URL | THIRD_PARTY_OR_UNKNOWN | CANVAS_UNCERTAIN | VIDEO_EXCLUDED`；分类不是所有权证明。`snapshotHash` 为 SQL 对规范 jsonb 的 SHA256，运行层原样传回。
- `ImageHistoryScanPage = {candidates:ImageHistoryCandidate[],nextCursor:string|null,upperBound:string}`。游标是返回的不透明字符串；首次无 upperBound 使用 DB clock，随后传回同一 upperBound。稳定 `(subjectKind,subjectId)` 排序；limit 默认100，最大1000。视频不进入 apply 候选；只读扫描输出明确排除记录。
- `ImageHistoryObjectDescriptor = {asset:ImageAssetRecord,object:ImageObjectRecord,location:ImageLocation}`，可表示尚未活动的目标，不能调用普通 `beginRead` 代替目标协调保护。
- `ImageHistoryItem = {id,jobId,subjectKind,subjectId,ownerId:string|null,snapshot,snapshotHash,exactUrl:string|null,sourceBinding:ImageHistorySourceBinding|null,state,token:string|null,leaseExpiresAt:string|null,sourceObservationId:string|null,assetId:string|null,sourceObjectId:string|null,targetObjectId:string|null,reservationId:string|null,attempt:number,intentKey:string|null,targetKey:string|null,replicaVerificationId:string|null,retirementJobId:string|null,errorCode:string|null,createdAt,updatedAt,source:ImageHistoryObjectDescriptor|null,target:ImageHistoryObjectDescriptor|null}`。
- item state: `PENDING | OBSERVED | ADOPTED | COPYING | RECONCILING | BLOCKED | SOURCE_RETAINED | RETIREMENT_REQUESTED | EXCLUDED`。UNKNOWN/BLOCKED 仍持久且仍计量，不自动重新 PUT。
- `ImageHistoryJob = {id,requestId,actorId,mode:ADOPT|COPY,scope,planDigest,publicUrlBase,sourceBindings:ImageHistorySourceBinding[],targetLocationId:string|null,retireSource:boolean,upperBound,cursor:string|null,scanComplete:boolean,state:PLANNED|RUNNING|WAITING|SUCCEEDED|PARTIAL|CANCELLED,totalItems:number,completedItems:number,blockedItems:number,createdAt,updatedAt}`。`publicUrlBase` 是受信 APP_URL 的固定公开基址；接管在解除 hold 前登记当前 token URL，未来输入该 URL 同样获得永久根。

`completedItems` 与 job.state 使用相同的完成条件：显式 `retireSource=true` 时，已切换但尚无 `retirementJobId` 的 SOURCE_RETAINED 仍未完成。切换后进程中断、原 item lease 仍有效、另一个 token 暂时无法 claim，也不能把该任务报告为已完成。

## 方法

| 方法 | 输入 → 输出 |
| --- | --- |
| `ScanImageHistory` | `{scope?,cursor?,upperBound?,limit?}` → `ImageHistoryScanPage`；纯 SELECT，不登记 location，不建 job/探针。 |
| `BeginImageHistoryApply` | `{requestId,actorId,planDigest,publicUrlBase,scope,sourceBindings,targetLocationId?,retireSource,upperBound}` → `ImageHistoryJob`；intent 精确重放，改变任一字段冲突。先由 apply 注册真实位置。 |
| `GetImageHistoryJob` | `{jobId? ,requestId?}` 恰好一个 → `ImageHistoryJob|null`；requestId 查回 Begin ACK 丢失后的原始范围。 |
| `ListImageHistoryItems` | `{jobId,cursor?:UUID,limit?}` → `{items:ImageHistoryItem[],nextCursor:string|null}`。 |
| `ClaimImageHistoryItem` | `{jobId,workerId,token,itemId?:UUID}` → `ImageHistoryItem|null`；自动扫描并持久下一页及 job 游标，每页最多100；90秒 item lease，重入不改变已授予的 writer token/expiry。显式 itemId 可恢复 BLOCKED。 |
| `GetImageHistoryItem` | `{itemId}` → `ImageHistoryItem|null`。 |
| `GetImageHistoryAliases` | `{assetId}` → `string[]`；只读、按精确 URL 排序的完整别名集合，用于切换证明。 |
| `BlockImageHistoryItem` | `{itemId,token,errorCode}` → `ImageHistoryItem`；安全固定 errorCode，保留目标与所有计量，不释放写授权。 |
| `RecordImageObjectObservation` | `{requestId,itemId,token,kind:SOURCE|TARGET_READBACK|WRITE_RECONCILIATION,sourceSnapshotHash,locationId,key,readResult:FULL|DECLARED|MISSING|FAILED|UNVERIFIED,byteLength?:string,sha256?,mimeType?,versionEvidence:UNVERSIONED|VERSIONED|UNKNOWN,versionId?,etag?,lastModified?,writerEvidence:NOT_APPLICABLE|QUIESCED|UNKNOWN,originalWriteToken?,writerProofSha256?}` → `{id}`；追加不可变观察，SOURCE 对 binding，目标对原物理行；FULL 必须完整大小/hash/MIME，QUIESCED 必须原 token 和证明摘要。 |
| `AdoptObservedImageObject` | `{itemId,token,observationId,expectedBusinessSnapshotHash}` → `{item:ImageHistoryItem,replayed:boolean,accountedDelta:string,overLimit:boolean}`。正向观测计真实量；超50MiB、Canvas未知/versioned 为受保护 inventory，不发布不可用 alias。SOURCE 没有 PUT/reservation。 |
| `PrepareImageMigrationCopy` | `{itemId,token,expectedSourceObjectId,targetLocationId}` → `{item:ImageHistoryItem,reservation:ImageReservation,ticket:ImageWriteTicket}`；DB 原子创建 attempt/intent/key + C2 PrepareCopy + C1 BeginObject；重放 ticket.writeGranted=false。另一显式任务可复用已在目标 location 的 READY 当前副本，仍须重新完整读回和取得退休证明，不增加物理计量。 |
| `PrepareImageCopyReconciliation` | `{itemId,token,expectedTargetObjectId}` → `{item:ImageHistoryItem,readExpiresAt:string}`；仅观察授权，无 PUT/DELETE 授权。 |
| `FinishImageCopyReconciliation` | `{itemId,token,observationId,expectedOriginalWriteToken}` → `{accepted:boolean,state:string,byteDelta:"0",item:ImageHistoryItem}`；仅 FULL+相同 payload+UNVERSIONED+QUIESCED 接受；UNKNOWN 原事实保留，独立 reconciliationObservationId。负面/未决保持 BLOCKED。 |
| `CommitImageMigrationSwitch` | `{itemId,token,targetReadbackObservationId,expectedActiveObjectId,aliasUrls:string[],readerProtocolRevision:3}` → `{switched:boolean,replayed:boolean,replicaVerificationId:string,item:ImageHistoryItem}`；实际 readback 先行，原子 CAS 再 C2 RecordReplicaVerification。 |
| `RequestImageHistorySourceRetirement` | `{itemId,token}` → `{item:ImageHistoryItem,job:ImageMaintenanceJob}`；仅 frozen retireSource=true，以 item ID 作为稳定 requestId 调同一个 C2 SOURCE_RETIREMENT。默认停止于 SOURCE_RETAINED。 |

## 持久保护与恢复

新增 `ImageHistoryJob/ImageHistoryItem/ImageObjectObservation/ImageHistoryReference/ImageHistoryHold`。`ImageHistoryReference` 永久保存精确 JOB_INPUT URL（无业务 cascade），未绑定时也写；SITE_COVER 是当前集合。holds 保留未决来源、原 Canvas ID 与已登记 asset，最终 alias/根接管完成前拒绝清理。全站引用协调 gate 在额度、业务行和 asset 锁之前；业务生产入口及 SQL mutation 共同参与，不能只在 adoption 尾部锁。

共同 gate 是 `image_lock_reference_epoch() RETURNS VOID`，固定 advisory xact key `(182736,3)`。业务事务必须先调用，再锁 User/Canvas/run/GenerationImage。所有 quota 动作和原生 Canvas 入口也先调用；相关直接 DML 由 BEFORE STATEMENT trigger 加锁。GenerationJob 只覆盖 INSERT、sourceImageUrls UPDATE 和 DELETE，不为普通状态 heartbeat 添加反序 gate；User/Conversation DELETE 在 cascade 之前持有 gate。hold 解除 guard 独立核对 canonical/原始 aliases、全部已知未绑定 URL 根、业务绑定及 COPY proof，不能仅靠把 item.state 改成完成来释放。

GENERATED snapshot 包含 `id/jobId/ownerId/url/urlHash/mediaStorage/storageKey/mediaAssetId`；超过2048字节的原 URL 不进入报告，只保留摘要。Canvas snapshot 固定原 provider/tuple/upload/payload/state/outcome/版本/绑定；REFERENCE_URL snapshot 为精确 `{url}`。独立未纳管 URL 只有与显式 source location 的完整 `publicBaseUrl/key` 或 `endpoint/bucket/key` 相等才可纳管；不删 query、不猜 basename、不将第三方 URL 绑定到另一对象。

上述 URL 证明同时约束新建 observed object 和复用既有 physical object；物理键或 owner 相同本身不证明 URL 归属。已存在且精确指向该 physical object 所属 asset 的 alias 可作为证明，使已登记的 canonical token URL 能继续复用原对象。

GENERATED 原 URL 超出2048字节或无法成为受支持的精确 HTTP URL 时，snapshot 只保留摘要，正向观察仍诚实计量并保留 hold；不标为接管完成、不授予 COPY，也不能解除 hold。这同样约束已存在的 READY physical object，不能借其已登记的另一条 canonical alias 绕过未能保护的原输入 URL。

业务输入和当前 cover 可接受的 token URL 拼写由读者解析器决定。`bindManagedImageInputAliases` 在业务事务的同一引用 epoch 内，把同源 host/默认端口等有效拼写按原字符串登记 alias，再写入业务根；永久 input 根因而能按用户提供的原字符串保留。其他 origin 下恰好同 token 的 URL 不会绑定。DB race 用实际 helper、真实两连接与 cleanup snapshot 核实该顺序。

每个 item 的 target identity 一旦建立便不可替换；UNKNOWN 的有效恢复依赖正向完整证据，否则保持 BLOCKED。明确未写入的失败需要以新 request 开启新目标，旧 key 不复用。已经完成默认保留的 COPY，可用新请求显式选择 `retireSource=true`，复用相同 READY 目标并重新验证。历史扫描无法恢复启用永久根之前已 cascade 消失、没有任何数据库证据的旧上传，报告范围只涵盖可识别业务事实。

`ImageObject.provenance=WRITE|OBSERVED`。OBSERVED 的 reservationId/slot/writeToken/writeExpiresAt 全部 NULL，sourceObservationId 必填，原生确认源使用 NOT_APPLICABLE outcome。WRITE 保留原必填形状；reconciliationObservationId 是独立不可变证据。所有旧 READY/清理/源退休查询会显式区分 observed 与 reconciled。新上传仍50MiB；观察可保存真实 BIGINT，超过复制上界只计量和保护。实际未核实大小不填零。

C1 已有 `WRITE + CONFIRMED + versionId` 的 READY 行保留按具体版本读取的兼容性；它们不满足 `image_object_verified` / `ImageObjectVerified`，不会用于迁移或无版本删除，清理分类为 VERSIONED。新 observed/reconciled READY 必须证明 UNVERSIONED；新 PUT finish 返回 versionId 时进入隔离，不能借旧行兼容规则发布。Canvas 接管继续要求没有有效的 `CanvasGcLease`，部署和验收须真正停止并排空旧 GC，不以修改 lease 到期时间代替协调。

显式请求退休源之前，runtime 在目标完整读回和身份核对之外，还检查 frozen `publicUrlBase` 下当前 canonical public GET 能返回同一 payload。读者不兼容以固定 `IMAGE_READER_INCOMPATIBLE` 阻塞并保留源；默认保留源的路径不执行该退休检查。普通 token 读取不依赖新写入功能开关。

## 验证交接

仅 root 运行 frozen workspace 的编译/DB/capture；此 agent 不运行 pnpm/go/docker。新 DB suite 加入 Canvas wrapper full/additive 固定清单。media/Canvas objects 指纹必须由实际 PostgreSQL capture 更新；不手写猜测函数 MD5。

root 的 `20261115T150935-history-catalog-b04c61` catalogue-only receipt 已覆盖迁移 checksum `04eea8ce2b67ffb8dffa2fa28a876cde3c6763b645be8665cb500d37e1b3062d`，实际捕获 media 636 / Canvas 201 个 catalogue 对象。该结果只证明追加迁移可执行且 catalogue 可捕获，不代表业务 DB suite 通过。先前 `20261115T144229-canvas-db-c42e9d` 的触发器 record 字段、PL/pgSQL 别名歧义及新引用 gate 下的原 Canvas 竞争测试已修复，待 root 重新运行 full/additive；完整验收以任务 verification 的最终 receipt 为准。

后续 `20261115T151307-canvas-db-e6600c` full 为 75 passed / 2 failed：仅新 Canvas 测试受到先前串行 suite 留存的 GC fixture lease 影响。已在 sentinel 验证的 rollback fixture 内按 epoch→lease row→精确 token CAS 清理上个 suite 的测试状态，并新增独立断言证明真实 acquire 的有效 lease 仍阻塞接管；这不是生产 drain 的替代品。此后补充了复用 URL 归属、退休中断计数、长原 URL 的新建/复用对象保护和 token 拼写的 input/cover 并发回归。SQL checksum 保持 `12459548628adecd2f1cde186c0485ebe52d3dd5e44eb5f1b44abafe7ae1eecd`。

`20261115T152439-canvas-db-984854` 中当时的19个 C3 case 全通过，但10个 C2 case 受到 C3 并发测试已提交、尚无永久根的 READY fixture 影响。已按本 suite 创建的精确 GenerationImage ID，在 afterAll 给仍存活的 AVAILABLE fixture 写入使用既有 canonical alias 的永久 JOB_INPUT 根；不删除或改写不可变 ledger，也不依赖 suite 执行次序。该隔离修复与上述4个新增 case 一同待重跑。

`20261115T153942-canvas-db-adeb58` full 为 82 passed / 1 failed，C2 隔离问题已消除；剩余 Canvas case 源于测试 helper 仅查首1000条，而原 Canvas quota suite 已提交1128条记录。helper 现沿游标查询并严格保留首次 upperBound，另有小页、确定落在下一页的回归；生产 Canvas insert guard 实际把 createdAt 截断到毫秒，未修改 SQL cutoff，也没有用 sleep 掩盖失败。新增边界回归用原始 GenerationImage 的0.4ms/0.6ms输入验证存储精度及固定 cutoff 排除行为。

root 的 `20261115T155128-history-catalog-d4acb5` 已实际捕获扩展后的 media 820 / Canvas 201 项，media catalogue SHA256 为 `e8983c905bd04acd02272b31f21efb528de29daeff087347ca73108bff8e5b7b`。当前27个 C3 DB case 还包含真实 Canvas GC body 与 enum DDL 漂移的 media readiness 拒绝证明，待 root full/additive 和 Node/Go conformance 运行。
