# Research: 全站媒体计量、保留引用与可恢复清理

- Query: 在现有画布保留契约和生成任务生命周期下，怎样增加全站 5GB 额度、一键/定时/容量清理，并保留历史记录？
- Scope: internal；聚焦图片。用户后续明确排除视频及视频专用封面；下文视频增量分析只保留为调研记录。
- Date: 2026-11-12
- Method: 静态阅读代码、migration、共享契约和既有研究；未连接数据库/S3，未运行测试或修改产品代码。

## Findings

### 1. 找到的关键文件

| 文件 | 作用 |
| --- | --- |
| `prisma/schema.prisma` | 生成图片/视频、画布原图、引用关系、任务和用户的 FK/cascade。 |
| `prisma/migrations/20261029090000_canvas_v1/migration.sql` | 原图状态、计量、不可变清单、引用锁、GC claim/finalize 的实际执行约束。 |
| `contracts/canvas/v1/retention.json` | 七天宽限、长期任务根、删除后保留 inventory、未知 PUT 继续计量的事实源。 |
| `src/lib/canvas/assets.ts` | PUT 前登记原图、大小/摘要校验、重放与未知上传隔离。 |
| `src/lib/canvas/inputs.ts` | 导入原图与生成图片两类输入的解析、可用性校验、提交期锁。 |
| `src/lib/canvas/documents.ts` | 手动保存快照和删除画布；原图引用写入由 SQL 完成。 |
| `src/lib/canvas/run-submission.ts` | run 重放、提交前重校验与原任务身份保留。 |
| `src/app/api/generate/route.ts`、`src/lib/generation/external-api.ts` | 普通参考图上传与 `GenerationJob.sourceImageUrls` 的不同入库时序。 |
| `src/app/api/me/works/[id]/route.ts`、`src/app/api/admin/users/[id]/route.ts` | 删除作品/用户的现有物理 DB 删除入口。 |
| `src/app/api/admin/generations/route.ts`、`cleanup-failed/route.ts` | 管理员删除任务及对契约任务/attempt 的保护。 |
| `worker/internal/worker/canvas_gc*.go` | 有界后台 GC、已登记 key 删除、回执归类与完成确认。 |
| `worker/internal/worker/backfill.go` | 旧 `mediaStorage IS NULL` 行转存 S3 的工具；不是 S3→LOCAL 迁移。 |
| `src/lib/prisma-mappers.ts` | 历史媒体 DTO 目前总是输出 URL，尚无“已清理”状态。 |

### 2. 当前计量覆盖范围很窄

- `GenerationImage` 和 `GeneratedVideo` 只有 `url/mediaStorage/storageKey`，缺少真实字节数、物理 location、在途预留、删除结果与回收状态（`prisma/schema.prisma:544`、`:569`）。`src/lib/canvas/inputs.ts:54` 也明确说明生成/旧图片无已验证 byte-length。
- 普通 Node 上传只返回 URL（`src/lib/storage/persist-generated-image.ts:118`）；Go 结果写入后才返回对象 key（`worker/internal/worker/storage.go:100`）。因此统计生成记录条数或把已删除 DB 行当作已释放文件，均不能得到物理用量。
- `CanvasImportAsset` 已有 `byteLength`、完整 location/key、PUT/delete outcome、租约、重试时间、`physicalBytesAccounted`、`needsReconciliation`（`prisma/schema.prisma:618`）。它的计量范围只限导入原图，不能当作全站用量。
- 原图插入先取得 owner 锁，检查每用户 1GiB/1000 accounted imports 和 3 个活动上传；插入后即计量，上传租约 120 秒（`prisma/migrations/20261029090000_canvas_v1/migration.sql:499`）。新 5GB 全站 gate 必须与这个既有每用户 gate 协同，不能用“每个用户各自未满”推导全站未满。
- 5GB 已超过 32 位有符号整数。全站总额/预留额使用 PostgreSQL `BIGINT` 和 Go `int64`；跨 JSON 的值必须定义精确编码及安全范围。单个原图 8MiB 的既有 `Int` 不要求因此扩大。最终设计应明确 GB 对应字节常量并与 UI 单位一致。

### 3. 当前引用保护的精确边界

| 用途 | 当前可查询事实 | 对新清理的含义 |
| --- | --- | --- |
| 已保存画布的导入原图 | `CanvasSavedAssetUse`，保存所有 reference 节点，不只连线中的节点（migration `:728`、`:734`）。 | 只要最后一次账户快照仍引用，就不能清理。浏览器本地改动不解除服务端 root。 |
| 已提交任务的导入原图 | `CanvasJobAssetUse` 只登记 `kind=imported`（migration `:801`、`:804`），禁止 DELETE，liveJobId 只允许变 NULL（`:645`）。 | **任务成功、失败、删任务、删用户后仍保护**；不能只检查 PENDING/PROCESSING。事实源明确列出这些情况（`contracts/canvas/v1/retention.json:8`）。 |
| 画布里的生成结果 | `Canvas.scene.nodes` 的 `kind=result/jobId/imageId`；保存时锁住并校验 `GenerationImage`/所属任务（migration `:694`）。 | 现有 saved-root 表不覆盖生成结果，新增生成图片回收需要增加这种持久化引用索引/锁协议。 |
| 作为画布任务输入的生成结果 | `CanvasRun.inputSnapshot.input.references` 中的 `kind=result`；提交前 `FOR SHARE OF j,i` 并重读 URL（`src/lib/canvas/inputs.ts:60`、`src/lib/canvas/run-submission.ts:90`）。 | 当前锁只保护提交事务；提交后没有与导入原图相当的生成媒体 root。清理不能仅查两张现有 root 表。 |
| 普通/外部 API 的参考图 | `GenerationJob.sourceImageUrls` 是 URL 数组（`prisma/schema.prisma:470`）；普通 Web 上传后建任务（`src/app/api/generate/route.ts:196`、`:217`）；外部入口先建任务再上传/更新数组（`src/lib/generation/external-api.ts:193`、`:250`）。 | URL 本身不能证明对象归属。需要登记上传并将可识别的受管理输入绑定到任务；上传成功而后续建任务失败的对象也必须计量并进入可恢复状态。 |
| 精选/审核流程 | `FEATURED` 是公开状态；首页和公开详情并不将 `TAKEDOWN_PENDING` 视为公开（`src/lib/server/works.ts:248`、`src/lib/work-showcase.ts:189`）。审核还存在 PENDING/TAKEDOWN_PENDING。 | 至少保护 FEATURED，且审核/公开切换必须与清理 claim 协同锁定。对待审核状态做保守保护是可推荐的政策，不能误报为当前已实现的保留机制。 |
| 点赞 | `WorkLike` 关联生成图片/视频，媒体删除会 cascade（`prisma/schema.prisma:339`）。 | 仓库没有独立“永久收藏/锁定”语义；不能把点赞保护当作已确认需求。 |
| 在用网站封面 | 主代理另行查到 `LoginCoverConfig.customUrl` 可指向任意选中 URL（`src/lib/server/login-cover.ts:12`、`:23`）。 | 对明确解析到受管理媒体 ID 的当前封面建立保护；任意远端 URL 不成为对象所有权证据。详见同任务管理员研究。 |

仅“图片产生于某任务”的 output 归属不应被实现成永久输入 root，否则所有生成图片都不可清理。应区分生成来源、后续被任务作为输入使用、已保存画布展示和公开用途。

### 4. 删除组织、删除数据库行、回收文件是三个现有行为

- `canvas_delete_document` 删除 saved roots 并将画布 scene 清空/标记删除，不删任务或图片（migration `:740`）。提交过的任务 roots 仍存在。
- 用户删除作品只执行 `db.generationImage.delete`，不调用对象删除（`src/app/api/me/works/[id]/route.ts:19`）。
- 管理员删除用户执行 `db.user.delete`（`src/app/api/admin/users/[id]/route.ts:25`）；User→GenerationJob→GenerationImage/GeneratedVideo 是 cascade（`prisma/schema.prisma:481`、`:560`、`:587`）。Canvas 的 owner/key 清单则保留 immutable owner 和 nullable live FK（migration `:187`、`:190`、`:205`、`:214`）。
- 管理员批量删除保护 `contractVersion >= 1` 或已有 attempt 的任务（`src/app/api/admin/generations/route.ts:90`）；失败清理只删旧契约、无 attempt 的 FAILED 任务（`cleanup-failed/route.ts:11`）。新空间清理不应调用这个入口，否则会混入删任务/退款语义。
- 结论：新物理 inventory 不能跟随媒体、任务、用户行 cascade 消失。需要保留不可变的原始 owner/asset/job 身份和 location/key；当前行关联可为 nullable live FK。否则既不能算实际用量，也无法在 DB 删除后安全回收文件。

### 5. 现有原图 GC 可以复用的机制和不能放宽的条件

- 保留规则是七天无根宽限、数据库时钟、只登记 IMPORT、从精确 key 删除、删除后留 inventory（`contracts/canvas/v1/retention.json:4`）。这个 GC **明确排除 GENERATED/LEGACY**。
- SQL claim 取得 sweep lease，再用 `FOR UPDATE SKIP LOCKED` 领取有界批次；加锁后重查 roots 和租约，并写入删除 token（migration `:827`）。当前排序按 asset id，不是新产品要求的生成时间从旧到新（`:843`）。
- 对象 IO 发生在查询行消费/关闭后，事务锁不跨远端 IO（`worker/internal/worker/canvas_gc_repository.go:46`）。删除后凭 token 完成，失效 token 不得修改结果（migration `:855`）。
- 已确认 PUT 的 DELETED/MISSING 才允许减计量；FAILED/UNKNOWN 退避且仍占用。**PUT 曾为 UNKNOWN 的对象即使删请求确认，也继续占用并进入 reconciliation**，防迟到 PUT 重新出现（migration `:560`、`:862`）。不能把上传租约过期直接当成文件不存在。
- 当前 S3 删除器接受确切注册 location/key，拒绝任意 URL/目录前缀；200/版本标记/超时等不会伪装成功（`worker/internal/worker/canvas_gc_storage.go:327`、`:355`）。普通 S3 若有版本，不应宣称 DeleteObject 已释放该对象的全部存储。
- 新全站清理宜沿用短事务领取、精确删除、带 token 完成、失败退避这一模式，但不能把 Canvas 类型检查改成“所有媒体”或降低七天/长期 roots 的已有约束。原图 GC 和新额度清理必须共享同一物理对象的删除所有权，避免双重领取/双重计量。

### 6. 建议的最小实现边界（尚未批准的技术方案）

1. **登记所有写入**：一份可存活于业务行删除之后的物理对象清单，记录逻辑媒体 ID、原始归属/用途、storage provider+location+key、已验证长度、创建时间、写入状态/租约和删除状态。一个物理位置只计一次；复制迁移产生第二个位置时另有记录。
2. **全站容量事务 gate**：所有 Node/Go 上传、结果持久化、迁移复制经过同一个数据库 gate；在写文件前原子预留字节。以已计量物理字节和未物化预留求和，禁止内存进程锁或单纯 `SUM` 后无锁 INSERT。已转为物理计量的预留不能再重复相加。
3. **预留和结果分开**：保留写入 identity、token、状态及结果不确定标志；同一次写入确认只转换一次计量。lease 到期不证明没有文件，需确认不存在、清理或 reconciliation 后才释放；支持进程中断后的恢复。
4. **一个清理候选/领取实现**：手动、保留天数、容量压力三种入口复用保护检查。容量模式按 `(createdAt,id)` 从旧到新选取足够字节；预览不提供删除锁，真正执行时重新在事务中确认 eligibility。候选不足返回容量不足，而不是突破引用保护。
5. **所有新增引用与清理使用同一套锁/状态**：保存画布、提交任务、使用受管理 URL、公开/审核操作均在同一事务中验证媒体未在删除并建立引用。先确认无根再无锁删除仍会与保存/提交竞争。原有 Canvas 锁顺序要纳入全站 gate 设计，避免 Node 和 Go 各自不同顺序。
6. **保留媒体记录并增加可用性状态**：成功清理后保留原 `GenerationImage` ID/任务来源和删除原因/时间，返回明确的已清理状态。当前 `serializeGeneration`/work serializers 无这一投影（`src/lib/prisma-mappers.ts:259`、`:370`、`:436`）。画布输入校验当前只看成功任务和 URL（`src/lib/canvas/inputs.ts:25`），要同步拒绝已清理媒体，不能保留一个看似可下载的死链接。
7. **量与物理容量分开说明**：5GB 是约定管理范围的文件额度，不能用它承诺数据库/WAL/日志/FS 开销也在 5GB 内。迁移时源/目标副本、临时文件仍真实占空间；设计必须明确这些计量，不能仅切 URL 就报告空间释放。现有文件已经超额时，读历史仍可用，新写入须先成功回收足够空间。

### 7. 历史清单和迁移的限制

- 旧 `mediaStorage=S3` 行保存 key，却没有 endpoint/bucket 等历史 location。只有当前配置恰好正确不足以证明所有历史 key 都属于当前桶；迁移清单需显式绑定经过确认的源 location。NULL 元数据的 HTTP URL 可能是第三方源，不应凭前缀推导可删除对象。
- 既有回填仅扫描 `mediaStorage IS NULL` 并向 S3 转存，dry-run/limit 可作 CLI 模式参考；它不是旧 S3 图片搬往本地的工具（`worker/internal/worker/backfill.go:36`、`:145`、`:204`）。
- Canvas 的 location、bucket、key、byteLength 和 upload identity 都由触发器禁止修改（migration `:525`）。同时 `canvasAssetUrl` 只接受与当前 location 匹配的记录（`src/lib/canvas/storage.ts:215`）。**因此画布原图不能只执行 UPDATE storageKey/endpoint 就迁移，也不能直接换配置维持混合历史可读。**需要有经过审阅的定位间接层/副本记录及 additive 契约升级，保持逻辑 asset ID、引用和不可变上传清单。
- 推荐迁移按登记对象复制→长度/摘要确认→原子切换逻辑读取位置→另行确认源删除的状态推进；中断可重入，清理与迁移互斥领取同一物理对象。切换前必须能读取源，切换失败保留源；复制阶段需要明确额外空间。
- 执行前应为旧 Canvas.scene/result、CanvasRun.result input、普通任务 sourceImageUrls、精选和在用封面补齐受管理引用，未知/无法验证的行保持不可自动清理并显示未纳管状态。无需扫描/删除桶内所有对象来“补齐”本应用拥有的对象。

### 8. 视频范围的实际增量

- 视频是独立的 `GeneratedVideo`，有独立 `url`、可空 `posterUrl`、showcase 和 likes（`prisma/schema.prisma:569`），不是给图片过滤条件增加一个后缀就完成。
- Worker 视频上限为 128MiB，结果也持久化到 S3（`worker/internal/worker/video.go:15`、`worker/internal/worker/storage.go:166`）。它更容易影响 5GB 总额的保留时间和写入预留。
- 如果用户同意纳入，需要把视频本体、受管理封面/参考帧、播放/下载历史状态、迁移与共享计量一起接入；任意第三方 poster URL 本身不代表应用可删除的物理文件。前端需有视频已清理状态，不能只改图片占位。
- 如果本轮仅做图片，需明确视频依然沿现有 S3 持久化，不纳入图片 5GB 的计量和自动删除范围；避免暗示切换本地图片后就能撤掉全部 S3 配置。

### 9. 实施后需要的针对性证据

- 两个写入者竞争最后一段额度；统计包含预留且不重算已物化字节；超过 2GiB 的全站计数无溢出。
- 保存/提交/精选状态切换与 cleanup claim 竞争，任何已建立的引用都不会被物理删除；生成结果作为输入与 IMPORT 分别覆盖。
- 同一对象重复清理、删除成功但 DB ACK 丢失、lease 过期、进程重启和未知 PUT；不虚减字节，不复活旧身份。
- 原图已完成任务 root、已删用户/任务 root、七天内无根原图仍保留；容量不足时清晰拒绝写入。
- 旧作品/user cascade 后物理清单仍可计算；主动空间清理保留任务/扣费事实与历史占位。
- 本地/R2 混合副本、迁移中断、源位置不明、未登记 legacy、版本对象不误删；真实删除回执前不报已释放。
- 如纳入视频，增加 128MiB 级受限夹具、封面定位和已清理播放状态。所有基础设施验证仍用 disposable DB 和模拟存储。

## Related Specs

- `.trellis/spec/operations/media-storage.md`：生产媒体、存储类型、失败和旧行回填。
- `.trellis/spec/operations/canvas-contracts.md`：原图长期 roots、七天宽限、Node/Go/SQL 同契约和 disposable 验证。
- `.trellis/spec/operations/release-hardening.md`：additive migration、环境变量唯一入口、运行拓扑及生产操作边界。
- `.trellis/spec/frontend/public-work-data.md`：公开媒体 DTO 的白名单与提示词权限；加入已清理状态不能顺带泄露历史私有字段。
- `.trellis/tasks/archive/2026-10/10-28-studio-dual-mode-canvas/research/canvas-reference-retention.md`：此前选定长期任务引用、七天宽限和本地草稿恢复取舍。当前实现以上面的 migration/共享契约为准。

## External References

无新增外部依赖或外部资料检索。本研究的结论来自仓库，不声称 Cloudflare 当前价格、真实桶大小或生产存储配置已核实。

## Caveats / Not Found

- 没有找到生成图片/视频与普通上传共用的物理 inventory、全站字节 gate 或全站媒体删除器。
- 本轮视频范围已明确排除；最终设计由父 design.md 收敛，仍需用户最终规划审阅。研究结论不构成生产迁移/删除授权。
- 不能把现有所有生成任务行都当成永久 output 保留根；也不能将导入素材的已有永久 input roots 擅自缩成仅活动任务。
- 真实已用量、孤儿对象规模、旧 key 对应的源桶和历史迁移所需空间仍未知，需要后续受控盘点；本报告没有作生产验证。
