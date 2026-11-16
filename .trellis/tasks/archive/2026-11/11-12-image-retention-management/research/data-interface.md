# C2 数据接口（实施合同）

Owner: `/root/c2_data`。2026-11-15 固定给 runtime/UI 集成。所有动作继续由 `ImageRepository` / Go `*ImageRepository` 提供，SQL 状态机拥有数据库时钟、锁、租约和实际计量。C1 API 保留。

## 模块与公共类型

- 浏览器可用的纯类型/常量：`src/lib/storage/image-maintenance-types.ts`。
- 服务端响应校验：`image-maintenance-contract.ts`；方法在现有 `image-repository.ts` 中。
- Go 对应 `image_maintenance_repository.go`，方法 PascalCase、首参 context；`ID`/`URL` 使用 Go 缩略词命名。
- byte/count 物理统计统一十进制字符串；有界 job/item 数量为 number/int。
- `ImageMaintenanceMode = MANUAL_AGE | MANUAL_ALL | SCHEDULE | QUOTA | SOURCE_RETIREMENT`。
- `ImageMaintenanceState = PREVIEW | QUEUED | RUNNING | WAITING | SUCCEEDED | PARTIAL | CANCELLED | EXPIRED`。
- `ImageMaintenanceItem`: `{id,assetId,state:CANDIDATE|CLAIMED|RETRY|DONE|SKIPPED,byteLength,releasedBytes,reason:string|null}`。
- `ImageMaintenanceJob`: `{id,mode,state,policyVersion,createdAt,confirmedAt:string|null,expiresAt:string|null,completedAt:string|null,nextAttemptAt:string|null,estimatedBytes,releasedBytes,totalItems,completedItems,skippedItems,failedItems,pendingItems,truncated,items:ImageMaintenanceItem[],nextCursor:string|null}`。failedItems 包括待退避 RETRY，不将 UNKNOWN 算已释放。recentJobs 的 items 为空，详情分页最多 100 项。
- `ImageCleanupPreview`: `{previewId,policyVersion,expiresAt,assetCount,objectCount,estimatedBytes,truncated}`。
- `ImageStorageOverview`: C1 usage 全部字段 `{policy,usedBytes,reservedBytes,assetCount,objectCount}` 加 `{cleanableBytes,cleanableAssetCount,cleanableObjectCount,protectedBytes,unmanagedImageCount,locations:[{id,provider,objectCount,usedBytes}],recentJobs:ImageMaintenanceJob[]}`。未核实历史图片仅单列数量；不猜文件大小。所有位置省略路径/凭据/endpoint。

## 管理方法

| Node / Go 同名 PascalCase | 输入 → 输出 |
| --- | --- |
| `getStorageOverview()` | → ImageStorageOverview |
| `updateStoragePolicy(input)` | `{expectedVersion,limitBytes:string,enabled,quotaCleanupEnabled,scheduleEnabled,retentionDays,intervalSeconds}` → C1 ImagePolicy；完整字段，CAS，retentionDays 1..3650，intervalSeconds 60..31536000，limitBytes 1..9007199254740991。 |
| `previewCleanup(input)` | `{actorId,previewRequestId:UUID,expectedPolicyVersion,mode:MANUAL_AGE|MANUAL_ALL,retentionDays?}` → ImageCleanupPreview；最多 1000 资产，10 分钟有效。 |
| `confirmCleanup(input)` | `{actorId,previewId:UUID,requestId:UUID,expectedPolicyVersion}` → ImageMaintenanceJob；相同请求精确重放，确认只使用预览固定对象。 |
| `getMaintenanceJob(input)` | `{jobId:UUID,cursor?:UUID,limit?:number}` → ImageMaintenanceJob|null；默认 20、上限 100。 |
| `cancelMaintenance(input)` | `{actorId,jobId:UUID,requestId:UUID}` → ImageMaintenanceJob；停止新领取，在途回执仍可结算。 |

Node 管理服务负责每个入口的管理员鉴权和 API 输入 Zod 校验。SQL 返回稳定 `IMAGE_POLICY_CONFLICT`、`IMAGE_PREVIEW_EXPIRED`、`IMAGE_MAINTENANCE_CONFLICT`、`IMAGE_POLICY_DISABLED`（全部 HTTP 409）以及 C1 错误。UI 可将 `DELETED→cleaned`、其他非 AVAILABLE→unavailable、legacy 未纳管→available 投影为 `availability`，无需改变 SQL 状态。

## Worker / 容量 / 读取

| 方法 | 输入 → 输出 |
| --- | --- |
| `requestQuotaCleanup(input)` | `{requestId:UUID,ownerId,intentKey,neededBytes:string}` → ImageMaintenanceJob|null；policy 未启用或无需空间返回 null。同请求同 payload 幂等；每次缺口上限冻结，达到需求即停。 |
| `enqueueDueCleanup()` | → ImageMaintenanceJob|null；DB 时钟推进 schedule，并为策略下降后的超额排 QUOTA 收敛。 |
| `listMaintenanceLocations()` | → ImageLocation[]，仅 Worker 内部；仅在策略开启时返回已到领取时间的待执行对象位置，最多 1000 个，空闲轮询不探测所有存储。 |
| `releaseMaintenanceLease(input)` | `{workerId,token:UUID}` → boolean，仅释放本执行者当前 lease。 |
| `acquireMaintenanceLease(input)` | `{workerId,token:UUID}` → boolean；90 秒全站单执行者，重复 token 续租。 |
| `claimMaintenance(input)` | `{executorToken:UUID,verifiedLocationIds:string[]}` → ImageDeleteClaim[]；一次至多一个完整资产组（同组的全部对象）；空数组表示当前无可执行项。Worker 先验证位置再传入，不能用管理端参数。 |
| `finishMaintenanceObject(input)` | `{jobId,itemId,objectId,deleteToken,outcome:DELETED|MISSING|FAILED|UNKNOWN,errorCode?:string}` → `{accepted,replayed,releasedBytes:string,job:ImageMaintenanceJob}`；只在一次 accounted true→false 更新中减空间，重放 delta=0。 |
| `closeExpiredReservations(input?)` | `{limit?:number}` → `{closed:number,releasedBytes:string}`；只释放安全终态/未绑定凭证的未物化预算，不释放对象字节。 |
| `beginRead(input)` | `{assetId?:UUID,publicToken?:64hex,url?:string,ownerId?:string}`（三个定位项恰好一个）→ `{image:ManagedImage,readExpiresAt:string}|null`。未登记返回 null；存在但不 AVAILABLE/READY 返回 IMAGE_UNAVAILABLE。45 秒读保护，调用方 IO 必须在 30 秒内结束，取消时关闭流。 |
| `prepareCopy(input)` | `{assetId:UUID,ownerId,intentKey,byteLength:string,leaseSeconds?:number}` → ImageReservation；原子绑定 COPY reservation 与 asset，后续 beginObject 必须匹配此绑定。 |

`ImageDeleteClaim`: `{jobId,itemId,mode,object:ImageObjectRecord,location:ImageLocation,deleteToken,deleteExpiresAt}`。`ManagedImage` / `ImageObjectRecord` 保留 C1 DTO；新增的删除归属、COPY 和读保护列不直接透出，读/删除期限由独立返回字段承载。公开页面仅取上述 public job DTO。

共享时限：`IMAGE_MAINTENANCE_LEASE_SECONDS=90`，`IMAGE_READ_LEASE_SECONDS=45`，`IMAGE_READ_TIMEOUT_MS=30000`；单对象删除 30 秒，pass 45 秒。源码共享事实放 `contracts/media/v1/maintenance.json`，Node/Go loader 读取同一份。

## C3 受信副本证明消费者

- `recordReplicaVerification({assetId,sourceObjectId,targetObjectId,byteLength,sha256,aliasUrls:string[],readerProtocolRevision:2}) → {id}`。仅内部调用，证明者必须已实际读回目标并核对内容、精确 aliases；SQL 再核对内容/活动目标/别名集合。C2 不对管理员 API 暴露。
- `requestSourceRetirement({requestId,assetId,sourceObjectId,targetObjectId,verificationId}) → ImageMaintenanceJob`。仍由同一 claim/finalizer 删除源 object；不改变逻辑图片/根/Canvas 账户。不存在完整持久证明、最后副本、未满足 reader/copy/writer/version 栅栏均拒绝或跳过。
- media storage revision 升至 2，reader/executor revision 2；scene/run wire 保持 1。严格 catalogue 基于 C1 两段历史 + 新 `20261115090000_image_retention` 迁移，已从实际 PostgreSQL capture 同步。
- 上述两个方法只核对并消费受信校验结果，本身不读取远端内容。C3 仍须实现独立 observed-object 登记、COPY 恢复编排、原子保护接管和实际目标读回，不能以 C2 接口存在推断这些能力已经完成。具体缺口与最小提案见 [C3 数据交接](./c3-data-handoff.md)。

## 数据层验证交接（2026-11-15）

- 当前 C2 migration SHA-256：`2d65ec945b167fac0df3a8e08d6f6d92cbdcf9545dd23b5eaa05d978ecf2bdcb`。实际 capture 为 `20261115T073350-retention-catalog-56af4a`（07:33:22 冻结，5.0 秒）；其 `sourceBefore`、`sourceAfter` 与当前 SQL 的 SHA 完全一致。
- capture 文件位于 C1 `checks/.runtime/storage-4e37900e/receipts/`：media 为 `1794728034638-media-catalog-867ae1.json`，417 个对象，SHA `22019c06daaabcf147a43942df7b4ff42e8d2786615526c74cf5b220a57a21aa`；Canvas 为 `1794728034780-canvas-catalog-1f16f2.json`，196 个对象，SHA `7355a52e4cb01fabe273cb104ae3f8d075812224f21a0c6ee862520834d7ef5c`。两份 `schema.json.objects` 已与实际数组逐项 `assert.deepEqual`，migration chain 及 media primary SHA 均已同步。
- 最终数据回归为主会话执行的 `20261115T073819-canvas-db-0941d9`（07:37:59 冻结，53.534 秒）：完整历史与追加升级分别通过三套 suite、各 60 个 case，包含 C2 的 **14 个**真实 DB 用例。原有 11 个用例之外，新增托管 Canvas 的七天/永久根保护、双副本完成后才释放逻辑账户量、UNKNOWN 接管与过期逻辑 token 续期。
- 新增恢复用例曾在 `20261115T072815-canvas-db-2fb293` 揭示真实 `CANVAS_LEASE_LOST`：旧 finalizer 先将 `ImageAsset` 置 `DELETED`，再续期仍为 `DELETING` 的 Canvas token，违反原 guard 的关联状态要求。已改为**确认物理副本全部完成 → 在两层仍为 DELETING 时续 Canvas token → ImageAsset 终态 → Canvas 终态/账户减量**。保留原 guard、锁顺序、UNKNOWN 和重放断言；实际函数 body MD5 为 `52d187a9be96aa5ef871d4d59f9afd6c`，上述最终 DB 回归已通过该分支。
- 历史 Canvas 时间夹具只在 sentinel 核验的测试事务内，按精确 fixture IDs 播种 `CanvasImportAsset.uploadExpiresAt/detachedAt` 与 `ImageAsset.detachedAt`；立即恢复并断言 `session_replication_role=origin`，核对其他完整行字段不变。全部候选/claim/finalizer/重放运行生产 guard。恢复用例的可变重试/删除期限也在 origin 状态下修改。
- 这些是隔离 PostgreSQL 的数据层证据，不代表真实 R2、生产迁移或 C2 整体质量 gate 已完成。CI、真实后台 IO、浏览器和父验收的最终结论由主会话维护的 `verification.md` 汇总。C3 仍待主会话通过质量 gate 后正式激活。
