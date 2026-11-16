# C1 图片数据层实施接口

数据层 owner：`/root/image_data_core`。本文件先固定接口，随后实现相应 SQL、Node 与 Go 代码。状态：实施中。

## 文件与命名

- 共享事实：`contracts/media/v1/contract.json`，图片专用、contract version 1；不等于 Canvas 存储协议 revision。`schema.json` 持有 storageRevision 1、完整目录与函数指纹；`scenarios/input-boundaries.json` 固定两端均拒绝的非规范标识/数字边界。
- Node：`src/lib/storage/image-contract.ts`、`image-repository.ts`、`image-schema.ts`。
- Go：`worker/internal/worker/image_contract.go`、`image_repository.go`、`image_schema.go`。
- 数据迁移：`20261112090000_image_storage`。Canvas 行为/旧 GC 栅栏由 integration 的 `20261112100000_canvas_image_storage` 完成。
- 建议 runtime 名称采用 integration 的 `IMAGE_STORAGE_BACKEND=s3|local`、`IMAGE_STORAGE_PATH`、`IMAGE_STORAGE_VOLUME_ID`；数据层不直接读取环境。

## Schema 约定

- `ImageAsset`：UUID `id`，不可变 `ownerId`、`purpose`（GENERATED/REFERENCE/CANVAS_IMPORT）、`originId?`、`byteLength`、`mimeType`、`sha256`；64 位 hex `publicToken`；`state` PENDING/AVAILABLE/QUARANTINED/DELETING/DELETED；`activeObjectId?`。
- `ImageStorageLocation`：`id` 文本（现有 s3-v1 SHA256 或 local-v1:UUID）、`provider` S3/LOCAL、nullable endpoint/region/bucket/volumeId/publicBaseUrl、非空 physicalNamespace。S3 namespace 不含 region，保证同一 endpoint/bucket/key 不会因 region 改变而重复计量。
- `ImageObject`：UUID id/assetId/reservationId；slot；locationId/physicalNamespace/key；固定 byteLength/sha256/mimeType；state WRITING/READY/UNKNOWN/DELETING/DELETED；writeToken、putOutcome、deleteToken/lease/outcome、versionId、accounted、needsReconciliation。物理 namespace/key 唯一，reservation/slot 唯一。
- `ImageWriteReservation`：UUID id/token、ownerId、intentKey、kind OUTPUT/INPUT/COPY、slotBytes bigint[]、remainingBytes、state ACTIVE/CLOSED、outputJobId?、leaseExpiresAt。ownerId+intentKey 唯一，outputJobId 唯一；不 FK 到会被 cascade 删除的业务 job/user。
- `ImageQuota`：scope=images、usedBytes/reservedBytes。`ImageStoragePolicy`：scope=images、version、limitBytes 默认 5,000,000,000、enabled 默认 false、quotaCleanupEnabled=true、scheduleEnabled=false、retentionDays=30、intervalSeconds=86400、nextRunAt?。
- `ImageReference`：assetId、ownerId、kind JOB_INPUT/CANVAS_SAVED/SHOWCASE/SITE_COVER、referenceKey、permanent；同 asset/kind/key 唯一，JOB_INPUT 只能追加。ownerId 表示引用者，不必等于图片的不可变原 owner；普通持链接读取/复用跨账户，Canvas 自身仍保留账户边界。引用以逻辑图片为准。
- `ImageUrlAlias`：精确 URL 唯一、assetId，禁止按 URL 前缀推断归属。
- `GenerationImage` 新增 `mediaAssetId String? @unique @db.Uuid`、关系名 `mediaAsset`。
- `CanvasImportAsset` 新增 `sourceProvider String @default("S3") @db.VarChar(8)`（不是 Prisma enum）、`mediaAssetId String? @unique @db.Uuid` / `mediaAsset`；storageEndpoint/Region/Bucket 改为 nullable。数据层第一迁移负责列/FK，integration 第二迁移负责 provider CHECK、旧 immutable guard 的 IS DISTINCT FROM、状态桥接与旧 GC 协议栅栏。

## Node API

`new ImageRepository(queryer?)`，queryer 是具有 Prisma `$queryRaw` 的 client 或 TransactionClient；默认应用 db。绑定/引用操作可以 `new ImageRepository(tx)` 与业务事务一起调用。额度 reserve/begin/finish/close 不在持有业务锁的长事务里调用。

- `verifySchema(): Promise<void>`：只读 pg_catalog，对照共享 schema 的表/列/nullability/约束/索引/trigger attachment 与全部 image_* 函数体和签名；缺失/漂移统一 IMAGE_STORAGE_UNAVAILABLE。即使 Canvas 关闭也要验证。`getUsage()` 不能替代此检查。
- `registerLocation(location: ImageLocationInput): Promise<ImageLocation>`
- `reserveOutputs({ownerId,intentKey,count,leaseSeconds?}): Promise<ImageReservation>`
- `reserveInput({ownerId,intentKey,byteLength,leaseSeconds?,kind?:"INPUT"|"COPY"}): Promise<ImageReservation>`
- `bindReservation({reservationId,token,ownerId,jobId}): Promise<ImageReservation>`：在创建/扣费事务内绑定 OUTPUT 凭证；检查 job owner/type/count。
- `acquireForJob({jobId,workerId,leaseSeconds?}): Promise<ImageReservation>`：Worker 强制屏障，验证当前 job claim，复用/接管或为旧图片队列分配 OUTPUT；同 worker 且未过期时续当前 token，接管/过期则更换 token。已创建对象的 writeExpiresAt 不可改变；C1 管理模式 JobTimeout ≤3480 秒，外加 120 秒余量不超过 3600 秒租约。
- `getReservationByJob(jobId): Promise<ImageReservation|null>`
- `closeReservation({reservationId,token}): Promise<boolean>`：只能释放未消费槽位；绑定的 PENDING/PROCESSING job 拒绝关闭；已分配 object 的实际量不释放。
- `beginObject({reservationId,token,slot,locationId,key,byteLength,mimeType,sha256,purpose,originId?,assetId?}): Promise<ImageWriteTicket>`：slot 0-based。`writeGranted=true` 仅首次领取；重放不得再次执行物理 PUT。`assetId` 可为预先分配 UUID 或已有同内容逻辑图片的 UUID。
- `finishObject({objectId,writeToken,outcome:"CONFIRMED"|"UNKNOWN"|"NOT_WRITTEN",versionId?,errorCode?}): Promise<ImageObjectReceipt>`：CONFIRMED 才 READY；未知/过期写入继续占量，NOT_WRITTEN 要求调用者有“从未写入”的确定证据。
- `getByToken(publicToken): Promise<ManagedImage|null>`
- `getByAssetId(assetId,ownerId?): Promise<ManagedImage|null>`
- `resolveUrl(url,ownerId?): Promise<ManagedImage|null>`：只查精确 alias。
- `registerAlias({assetId,url}): Promise<void>`
- `replaceReferences({ownerId,kind,referenceKey,assetIds}): Promise<void>`：锁住所有新/旧逻辑资产；JOB_INPUT 仅增加，其他类型替换该 owner/kind/key 集合。
- `getUsage(): Promise<ImageUsage>`：包括 policy、used/reserved 的十进制字符串及数量。
- `activateObject({assetId,objectId,expectedObjectId}): Promise<boolean>`：只允许相同资产/字节/摘要的 READY 对象，CAS 活动读取指针。

`ImageWriteTicket` 含 `{asset,object,writeGranted}`；`ManagedImage` 含 `{asset,object,location}`，无 READY 可读副本时 object/location 为 null。所有 wire 字节数为十进制字符串；内部必要时用 BigInt。

INPUT 的 GENERATED 是狭窄的旧回填兼容：originId 必须为已存在、尚未关联 mediaAssetId 且 mediaStorage 为 NULL 的 GenerationImage；原任务必须是图片且 owner 匹配，intentKey 必须精确为 `backfill-image:<imageId>`。它仍申请实际长度的新写入预算并只授权一次 PUT；不允许借此登记已存在物理对象或绕过额度。完成后的业务更新还须 CAS 原 URL、mediaStorage NULL、mediaAssetId NULL；失败/未知回执保留对象和计量。

`image-contract.ts` 导出 `IMAGE_CONTRACT_VERSION`、`DEFAULT_IMAGE_QUOTA_BYTES`（bigint）、`MAX_IMAGE_BYTES`（number）、`MAX_IMAGE_OUTPUT_COUNT`、`imageOutputBudget(count):bigint`、`imageLocalLocation(volumeId)`、`imageS3Location({endpoint,region,bucket,publicBaseUrl?})`、`imagePublicUrl(appUrl,publicToken)`、`ImageStorageError`、`isImageErrorCode` 及上述 DTO/Input 类型。

## Go API

`NewImageRepository(queryer)`；queryer 使用 pgx `QueryRow(ctx,sql,...args)`，pool 或 transaction 都满足。方法为同名 PascalCase，首参数 context.Context，Input 为相应 exported struct（ImageReserveOutputsInput、ImageReserveInput、ImageBindReservationInput、ImageAcquireForJobInput、ImageCloseReservationInput、ImageBeginObjectInput、ImageFinishObjectInput、ImageReferenceInput、ImageActivateObjectInput）。字节内部 int64，JSON DTO 中字符串。location 构造用 `NewImageLocalLocation(volumeID)` / `NewImageS3Location(endpoint,region,bucket,publicBaseURL)`；公开 URL 用 `ImagePublicURL(appURL,token)`。

Go 缩略词拼写：`GetByAssetID(ctx,assetID,ownerID)`、`ResolveURL(ctx,url,ownerID)`、`RegisterAlias(ctx,assetID,url)`。`VerifySchema(ctx) error` 与 Node 同义，成功为 nil。制品 loader 选最近的 `contracts/media/v1` 目录；近目录不完整时直接拒绝，不回退到更远的制品。

## SQL 入口

除 resolve/read 外的业务动作统一以 jsonb 参数承载，返回 jsonb；TS/Go 使用完全相同的字段名，不复制状态机：

`image_register_location(jsonb)`、`image_reserve_write(jsonb)`、`image_bind_reservation(jsonb)`、`image_acquire_for_job(jsonb)`、`image_close_reservation(jsonb)`、`image_begin_object(jsonb)`、`image_finish_object(jsonb)`、`image_replace_references(jsonb)`、`image_register_alias(jsonb)`、`image_activate_object(jsonb)`。

读取：`image_get_asset(p_asset_id uuid,p_owner_id text DEFAULT NULL)`、`image_get_by_token(text)`、`image_resolve_url(text,text DEFAULT NULL)`、`image_get_reservation_by_job(text)`、`image_get_usage()`；都返回 jsonb/null。SQL 字节输入接受十进制字符串并验证范围。

公开稳定错误：IMAGE_INVALID_INPUT、IMAGE_QUOTA_EXCEEDED、IMAGE_RESERVATION_CONFLICT、IMAGE_RESERVATION_EXPIRED、IMAGE_WRITE_CONFLICT、IMAGE_UNAVAILABLE、IMAGE_LOCATION_CONFLICT、IMAGE_REFERENCE_CONFLICT、IMAGE_STORAGE_UNAVAILABLE、IMAGE_INTERNAL_ERROR。DB 使用 SQLSTATE 23514 且 MESSAGE/CONSTRAINT 精确等于 code，未知 DB 错误不转换成可公开消息。

额度/对象变更锁序以 scope quota 行为首；再 reservation、asset、object（若需要）。引用变更只锁稳定排序的资产，不请求 quota 锁。IO 永远在 DB 操作返回之后；业务 bind/reference 事务不能调用 reserve/begin/finish/close。

## 验证与下游边界

- `schema.json` 的目录查询复用现有 Canvas pg_catalog 结构，媒体独立要求 263 项（12 张表含桥接表、106 列、64 约束、26 索引、39 函数、16 触发器）。函数 MD5 只规范化 CRLF→LF；复杂 CHECK/default 保持 PostgreSQL 17 的确切渲染，不删除括号、操作符或类型转换。未知等价表达式也需复核，不自动 ready。
- 当前首迁移 LF SHA256 为 `1f00a61347254be77261bae54cc58ae968b4193d5c433ab98c4779d6b87a46b8`。最终 backfill/严格边界代码已通过 20 条迁移冷建及图片/Canvas joint smoke（`20261112T051538-media-canvas-db-smoke-479fb7`，exit0，6.129s）；新 PG17 capture 的 media263/Canvas196 required objects 与共享契约逐项完全一致。
- 正式 `canvas-db` full/additive 两种历史均为 2 files、46/46 cases（37 Canvas +9 图片），回执 `20261112T051840-canvas-db-156b29`，exit0，25.228s。包含 Prisma validate/generate、实际 owner sentinel、当前 worker/未知回执/回填 CAS 和真实多连接竞争；sourceChanges 与 snapshotModifications 均为空。新图片 Node 专项 58/58 也已通过（34 contract、4 repository、20 schema）。
- 可重复数据用例位于 `src/tests/integration/canvas-contracts/image-storage-db.test.ts`，由现有 Canvas runner 执行 full/additive histories。测试使用真实 Prisma/pg 和实际 owner sentinel；大多数 fixture 事务回滚，多连接用例比较原用量差值并恢复策略，绝不以删除不可变清单或永久 roots 做 teardown。
- C2 的删除 claim 必须保护尚在写入/预留租约内或仍有 PENDING/PROCESSING 输出任务的图片。刚发布 AVAILABLE 不等于已无准入保护；生成来源本身也不应变成永久输入 root。
- C3 尚需专用“核实并接管已存在对象”原语：现有 OUTPUT/INPUT/COPY 都代表新写入，不能用伪造在途任务或新 PUT receipt 采纳旧 S3 库存。旧库存可能已超限；盘点事实与未来写入额度应分别处理，任何计量例外只能限定于已核实存在对象。本阶段没有增加该例外，也没有 UNKNOWN 写入对账执行器。
