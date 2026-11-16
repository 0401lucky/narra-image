# Research: Canvas LOCAL 与不可变历史 inventory 的兼容演进

- Query: 新增本地 Canvas 导入与旧 S3→LOCAL 副本迁移，如何保留素材 ID、历史位置、引用、账户额度，并由一个执行器回收实际文件。
- Scope: internal；仅技术方案比较与代码证据，复用全站媒体设计，不提出另一套产品架构。
- Date: 2026-11-12
- Settled scope: 仅图片；视频文件与视频专属封面不在本轮，不重新讨论范围。

## Findings

### 1. 当前事实与定位

| 证据 | 约束 |
| --- | --- |
| `prisma/schema.prisma:618` | `CanvasImportAsset` 同时承担上传身份、逻辑素材生命周期、S3 原始位置和额度计量。 |
| `prisma/schema.prisma:663`、`:706` | saved/job roots 通过 `(assetId, ownerId)` 指向同一素材行，不能换 ID 后期望引用自动迁移。 |
| `prisma/migrations/20261029090000_canvas_v1/migration.sql:499` | 上传 guard 禁止删除 inventory；插入时按 owner advisory lock 串行校验数量、字节和并发上传。 |
| 同上 `:508`–`:510` | 每账户额度是 `physicalBytesAccounted=true` 的行数及 `sum(byteLength)`：1000 份、1 GiB、3 个活动上传。 |
| 同上 `:525`–`:530` | 摘要、大小、上传身份、原始 location/endpoint/region/bucket/key 不可修改。 |
| 同上 `:531`–`:562`、`:645` | roots 保护逻辑素材，任务 roots 不可删；无引用满七天才允许逻辑删除；UNKNOWN PUT 即使 DELETE 返回缺失也保留计量和对账。 |
| 同上 `:827`、`:855` | 旧 claim 按原始 S3 location 领取整行，旧 finalizer 以素材级 token 更新删除结果与额度。 |
| `src/lib/canvas/storage.ts:215` | 当前读取要求原始 S3 tuple 与当前配置一致，不能直接支持 LOCAL 或迁移后的读取副本。 |
| `worker/internal/worker/canvas_gc_repository.go:46`、`canvas_gc_storage.go:327` | 旧 Go executor 读取完整原始 tuple，按确切 bucket/key 删除，根本不知道副本映射。 |

特别注意旧 `canvas_claim_imports` 在按 location 选择可删对象之前，会先隔离**所有位置**的过期 UPLOADING 行（migration `:835`）。因此仅让 LOCAL 使用不同 location 前缀，并不足以让旧 GC 无害。

### 2. 可选路径的技术判断

| 方案 | 判断 |
| --- | --- |
| 用 `endpoint=http://local`、伪 bucket/region 把磁盘伪装成 S3 | 不采用。位置身份、S3 能力探测、物理唯一性及删除协议均会失真。 |
| 新建独立 `CanvasLocalAsset`，让 saved/job roots 同时适配两套素材表 | 不建议作为最小方案。会扩大 root FK、场景验证、任务快照和多态查询的改造面。 |
| 保留 `CanvasImportAsset` 的逻辑 ID 与 roots，增加 provider 区分和全站逻辑媒体/物理副本关联 | 推荐。原始位置保持 provenance；读取位置和实际删除状态由物理副本清单管理。普通图片和 Canvas 复用同一物理对象表及删除执行器。 |

### 3. 推荐的最小 schema 边界

下述 `MediaAsset`、`MediaObject` 为职责名称；实施时使用父任务全站媒体模型的统一名称。

1. **保持 Canvas 的逻辑锚点。** 保留 `CanvasImportAsset.id/ownerId/uploadId/sha256/byteLength/mimeType`、scene 中的 asset ID 以及两张 root 表。给该行增加唯一的 `mediaAssetId` 关联；跨行同 owner、同摘要/大小必须受 FK/guard 约束，不能只靠应用代码约定。历史登记允许先关联，再启用新写入；新版本写入需原子建立素材与物理写入预留。
2. **新增不可变来源 provider。** 在 Canvas 原始位置组增加 `sourceProvider: S3 | LOCAL`，历史行归为 S3；该值表示最初写入的来源，不是“当前读取位置”。`storageLocation` 与 `storageKey` 可继续存不可变的真实 provider location 和相对 key；`storageEndpoint/storageRegion/storageBucket` 改为可空：S3 必须全部存在，LOCAL 必须为空，LOCAL 的 `storageVersionId` 必须为空。LOCAL location 使用共享卷身份，不伪造 HTTP endpoint 或 S3 tuple。
3. **副本实际状态放全站物理表。** 每条 `MediaObject` 记录逻辑媒体 ID、provider/location、不可变 key、写入/校验/删除结果、字节数、token/lease 与是否仍计量。历史原始 S3 对象也登记为一条真实 `MediaObject`，与 Canvas 原始 tuple 核对后绑定。唯一性必须防止同一物理 key 被重复登记：维持现有 S3 `(endpoint,bucket,key)` 的唯一约束语义，并给 LOCAL 加 `(volumeIdentity,key)` 的唯一性；不能只让 nullable endpoint 的旧索引负责 LOCAL 去重。
4. **读取指针独立于原始位置。** `MediaAsset` 指向经过验证的当前读取副本，指针必须引用同一逻辑媒体的 READY 对象。旧 S3→LOCAL 复制仅新增物理行、校验内容、切换读取指针；不更新原 `CanvasImportAsset.storage*`，也不修改 `sourceProvider`。`canvasAssetUrl` 从逻辑媒体解析，不再要求原始位置等于当前全局 S3 配置。
5. **更新 guard 时保留原保证。** roots、上传幂等、素材 payload 和原始 tuple 继续不可变；只是写入、删除和计量证明扩展到副本集合。字段改可空后，原有 `NEW.field <> OLD.field` 必须改为 `IS DISTINCT FROM`，否则 NULL 的三值逻辑会绕过不可变比较；provider CHECK 也必须显式使用 `IS [NOT] NULL`，不能只写 `length(nullableField)>0`。

此演进需要**追加迁移**，包括受控调整 nullable 列、CHECK/函数体及增加表/关联；“additive”不表示可以不改变旧 guard。已发布 `20261029090000_canvas_v1/migration.sql` 及其校验和应保持原样。

### 4. 账户 1 GiB 与全站物理额度必须分开

- **账户额度：每份逻辑导入计一次。** 保持每账户 1 GiB/1000 份的用户可见语义，迁移副本不应让用户的一张 8 MiB 图片突然变成两份素材。可保留 `CanvasImportAsset.physicalBytesAccounted` 为兼容账户计量 bit，但新契约必须明确它表示“这份素材仍占用或可能占用存储”，不能将它当副本字节总量。
- **全站额度：每个物理副本都计。** 同一 8 MiB 素材同时存在 S3 与 LOCAL 时，账户计 8 MiB/1 份，全站真实副本计 16 MiB；复制前的新副本预留也需计入准入。全站 ledger 只汇总 `MediaObject` 与预留，不能再加一遍 Canvas 行的 `byteLength`。
- **迁移不释放账户额度。** 切换读取指针、删除旧冗余副本都不改变 Canvas 行的 READY 状态，也不清除账户 bit。只有整份逻辑素材已获清理资格、全部物理副本确认删除/缺失且没有未排除的迟到写入，才能最终清除一次账户计量。
- **UNKNOWN 仍保守。** 旧 `putOutcome=UNKNOWN` 的素材迁入新表时，原物理副本继续计量/对账，不能因另一份 LOCAL 副本已存在就抹去未知 S3 风险。原有迟到 version receipt 也必须落到原副本而非当前读副本（capability.json `latePutVersionReceipt`；migration `:520`–`:524`）。
- **素材级 state 与副本 state 区分。** `CanvasImportAsset` 保持逻辑上传/可引用/删除状态；新物理对象可以独立 COPY/READY/DELETE。素材级 `DELETED` 和 accounting check 需要以副本集合的证明为依据，不能继续直接调用旧 `canvas_finish_asset_delete` 减额。

如为避免历史字段命名歧义增加 `ownerQuotaAccounted`，必须一次性明确其唯一权威来源及旧字段兼容映射；不建议让两个可独立写入的 bool 同时决定额度。

### 5. 版本与 schema 指纹需要显式演进

**只加表不会使旧 Worker 自动失效。** TS probe 按 expected objects 循环（`src/lib/canvas/schema-probe.ts:197`），Go 同样如此（`canvas_schema.go:290`）；测试明确允许无关附加对象（`src/tests/unit/canvas-schema-probe.test.ts:14`、`canvas_schema_test.go:80`）。

建议保留场景/请求的 `schemaVersion:1` 和现有 asset IDs，独立升级**存储/GC 协议 revision**，避免为磁盘后端重写 scene/run wire。可采用明确的 storage revision 2 子契约或 capability 的 `storageVersion:2` 扩展；该选择是协议实现细节，不改变产品范围。必须同时覆盖：

| 边界 | 所需变化与证据 |
| --- | --- |
| provider/location | 保留 S3 原 `s3-v1:` tuple 规范；增加真实 LOCAL volume identity 规范及共享向量。`contracts/canvas/v1/capability.json:10`、`canvas_contract.go:409` 当前硬编码单一 S3。 |
| capability/readiness | LOCAL 报告已验证的托管存储能力，不冒充 S3 `unversioned`；包含新存储/GC revision。`src/lib/readiness.ts:97` 精确比较字段数和值，`:219` 同时检查自身 schema/storage；`src/lib/validators.ts:432` 是 strict v1 DTO；Go `canvas_contract.go:71`、`:406` 也硬编码 v1。新 Node 必须拒绝旧 Worker，旧 Node 也应拒绝新能力而非部分兼容。 |
| loader 的版本拆分 | Node `src/lib/canvas/contracts.ts:19` 把所有 fixture 版本捆为 1；Go `canvas_contract.go:221`、`:404` 亦共用 `canvasContractVersion`。需显式拆分 scene/run 与 storage/schema revision，不能只改一个 JSON 数字。 |
| schema catalog | `contracts/canvas/v1/schema.json:7` 的查询硬编码六张表，并记录完整函数体 MD5、列 nullability、FK/索引/触发器。新 catalog 要包含新增关联、物理对象、provider CHECK、读指针和新 claim/finalize guard；新版本仍严格校验每个 required object。 |
| 指纹来源 | TS 测试 `canvas-schema-probe.test.ts:11`、`:46` 与 Go `canvas_schema_test.go:283` 都从单个旧 migration 计算 digest/函数体。需支持基础迁移+追加迁移的有效定义或独立新 schema 契约，保留每个迁移 digest，不修改旧 SQL 迎合测试。 |
| DB 验证 runner | `scripts/verify-canvas-contracts-db.mjs:20`、`:55` 固定旧 canvas migration 和 schema 文件；后续执行计划需更新新修订目标并覆盖完整历史与追加升级。 |

**数据库也必须拒绝旧 mutation 协议。** 新模式激活后，旧 `canvas_acquire_gc_lease` / `canvas_claim_imports` / `canvas_finish_asset_delete` 不能继续独立改变新管理的对象。建议旧签名保留为明确拒绝旧 revision 的兼容栅栏，新执行器调用新的带 revision/epoch 的 claim/finalize；修改已知旧函数体还会使旧 schema probe 失败。仅新增一个旧 probe 不认识的版本表不够。

**版本检查不能撤回已领取的删除。** 旧 `canvas_gc.go:152` 取得整批 key 后，`:167` 执行对象删除，`:184` 才 finalizer。升级数据库或使下一次 readiness 失败，均不能阻止手上已有 key 的旧进程完成当前 I/O。切换到副本管理之前必须停止并 drain 旧上传/GC/迁移执行者，核对活动 lease/token；完成新 inventory 接管后再开放新写入。不能宣称一次数据库 migration 足以安全滚动混跑新旧 GC。

### 6. 一个物理删除执行器，两个清理原因

统一的媒体回收 owner 应接管 Canvas 原始对象与新副本；现有 `canvasGCScheduler` 可收敛为资格提供者/兼容状态上报，但不能继续对同一批 S3 key 独立删除。原有 `CanvasGcLease` 与新全站 lease 需要明确接管关系，禁止两个互不知情的 singleton 各自都认为自己唯一。

共享流程应为：数据库以固定顺序锁定清理请求、逻辑素材、对应物理行，复查资格并取得**物理对象级** token → 事务外由正确 provider 执行确切 key 删除 → 数据库 CAS finalizer 一次性记录结果、释放该物理计量 → 所有副本满足条件时再完成素材级 tombstone 与账户减额。未知结果保留计量，重试复用同一物理记录，key 永不复用。

| 原因 | 删除资格 |
| --- | --- |
| `RETENTION`：整份 Canvas 导入被清理 | 保留原有 saved/job roots、准备/上传 lease、七天无根宽限；先把逻辑素材置为不可建立新引用的清理状态，再逐副本删除。 |
| `MIGRATION_SOURCE_RETIREMENT`：只删除已替代的旧副本 | 必须有同摘要/大小、已确认 READY 且当前被选为读取位置的替代副本，相关旧 URL/任务读取兼容已就绪，且没有依赖旧副本的在途读取/写入。逻辑素材仍 READY，roots 原样保留；绝不能走“假装删除整个 Canvas 素材”的旧 finalizer。此动作使用父任务明确的迁移执行政策。 |

复制阶段先只处理来源明确、READY、CONFIRMED、无版本异常、无活动删除 token 的资产。已有 UNKNOWN、DELETING、迟到版本隔离行要按原事实接管到新清单并继续保守对账，不作为普通迁移成功案例。已知副本重复登记由物理唯一约束阻止；重试造成重复 DELETE 可幂等处理，但计量 finalizer 必须只成功一次。

## Related Specs

- `.trellis/spec/operations/canvas-contracts.md`：保留引用、不可变库存、七天宽限、能力探针与指纹证明。
- `.trellis/spec/operations/media-storage.md`：全站媒体持久化、结果失败和历史兼容。
- `.trellis/spec/operations/release-hardening.md`：追加迁移、版本部署、readiness、drain、隔离验证。
- 同目录 `storage-paths.md`：读取 URL、公开访问和两种容器拓扑的证据。

## External References

无；结论来自仓库 SQL、TypeScript、Go 和共享契约，未访问外部服务。

## Caveats / Not Found

- 以上是技术推荐，不是已实现 schema，也不是生产迁移授权；没有运行测试或连接实际数据库/存储。
- provider 字段变可空和逻辑/物理删除拆分必须更新完整 guard，不能通过绕开 trigger、伪造根、缩短七天期限或直接覆盖旧位置实现。
- 用量上限是父任务的全站媒体契约；本文只说明 Canvas 账户额度与副本物理计量如何不重计、不漏计。
- 旧 S3 URL 的外部分享兼容仍受源对象/域名控制约束；副本校验通过不等于可以立即删除所有旧源 URL 对应对象。
