# 画布账户、生成与原图保留契约

## 1. 适用范围与触发条件

- 修改画布账户 API、`src/lib/canvas/` 服务、生成入口的画布分支、Canvas Prisma 模型、原图 GC 或启用态 readiness 时必读。
- 共享事实源是 `contracts/canvas/v1/`；外部请求校验位于 `src/lib/validators.ts`。生成任务仍复用既有 Node/Go、计费、审核、验证码、取消及退款流程。
- 本规范记录已实现的代码契约，不授权生产迁移、真实 S3 操作或部署；没有 disposable PostgreSQL/拓扑执行证据时不得声称基础设施验收通过。

## 2. 签名

| 入口 | 请求 / 返回 |
| --- | --- |
| `POST /api/me/canvases` | `{id,title}` -> `{data:{canvas}}`，空 metadata shell，不是已保存场景。 |
| `GET /api/me/canvases` | owner 范围、有界 `(createdAt,id)` 游标 -> `{data:{canvases,nextCursor}}`。 |
| `GET /api/me/canvases/:id` | `{data:{canvas,scene}}`，scene 可为 null。 |
| `PATCH /api/me/canvases/:id` | `{title,expectedRevision}` -> metadata ACK，不保存场景。 |
| `PUT /api/me/canvases/:id/snapshot` | `{expectedRevision,saveId,scene}` -> `{data:{canvas,saveId,sceneHash,acknowledgedRevision}}`。 |
| `DELETE /api/me/canvases/:id` | `{expectedRevision}` -> `{data:{id,deleted:true,revision}}`，只移除组织。 |
| `POST /api/me/canvas-assets` | multipart 恰好包含 `uploadId,byteLength,mimeType,sha256,file` -> `{data:{asset}}`。 |
| `GET /api/me/canvas-assets/uploads/:uploadId` | 按原上传 ID 查询结果，不能因 ACK 丢失重新 PUT 同一 key。 |
| `GET /api/me/canvas-runs/:runId` | `{data:CanvasRunLookupDtoV1}`，只读，保留原 origin/job 身份。 |
| `POST /api/me/canvas-runtime/resolve` | 显式 scene IDs -> owned DTO maps 和 missing；不枚举所有 runs。 |

- 数据库辅助：`canvas_save_snapshot`、`canvas_delete_document`、`canvas_reserve_run`、`canvas_commit_run`、`canvas_reject_run`、`canvas_acquire_gc_lease`、`canvas_claim_imports`、`canvas_finish_asset_delete`。精确参数、默认值和函数体指纹由 `schema.json` 持有。
- `CanvasJobAssetUse.runId` 引用内部 `CanvasRun.id`，不是外部 `runId` UUID。
- Prisma 调用 void-returning lock 函数使用 `$executeRaw`，不能通过 `$queryRaw` 解码 PostgreSQL void/OID 2278。
- 本地验证：`LocalDockerSession.pin(probe)` -> `prepare()` -> `command(args, extra)` -> `cleanup()`；共享 PG/worker runner 通过该边界执行 Docker，E2E 复用其 endpoint/env/scratch 校验。

## 3. 请求、存储与运行契约

- `POST /api/generate` 的画布分支必须带 `X-Narra-Canvas-Run: 1`，在缓冲请求体前选中 128 KiB 的计数流读取；无画布的旧 JSON/multipart 不套用新全局限制。
- 唯一画布 wire 是 `canvasRun:{canvasId,nodeId,runId,input:{prompt,references},parameters}`。使用共享 `encodeCanvasRunRequestV1` 和 headers；运行期自定义渠道及验证码是外层瞬时字段，不进入场景/outbox。
- 一个直接提示词、0-16 个 ordinal 明确排序的就绪来源；图片输入固定 count 1，纯文本 count 1-4。连接/编辑/恢复不自动运行；旧稳定结果可反馈到原生成节点，不实施一般 DAG 禁令。
- 同 run 同 intent 的 COMMITTED replay 在验证码、当前余额、渠道和媒体检查之前返回原任务；失联/迟到 ACK 只读恢复，不能新建 run、再次扣费或进入旧 catch 退款。
- 新任务、条件扣费、run commit 和 immutable job-input roots 同事务；canvas/run/admission 及 asset 顺序加锁，时间来自数据库。对象 I/O 不在数据库事务中执行。
- 场景限制 512 KiB/200 nodes/400 edges；每账户 100 live shells；原图 8 MiB、每账户 1 GiB/1000 accounted imports、3 active uploads。数值以共享 `limits.json` 为准，不是容量测量。
- Save 包括所有参考节点原图，不只已连接或提交过的。原图 registry 必须先于 PUT 建立；payload 身份不可变，READY 重试复用，UPLOADING 返回 202，未知 PUT 保留 key、计账和隔离状态。
- S3 location 身份为共享规范化 `[origin,region,bucket]` UTF-8 JSON 的 SHA-256，加 `s3-v1:`；Node/Go 消费同一组向量。URL 前缀不是所有权证明。
- Node 的 `CanvasStorageAdapter.getBucketVersioning(signal)` 与 Go `canvasGCStorage.Verify(ctx)` 按规范化 location 选择探测：普通 S3 使用有界原始 XML 的 `GetBucketVersioning`；官方 R2 使用带认证的 `HeadBucket`。接口名称和 readiness 的 `storage: "unversioned"` 不变。
- R2 专用证明仅适用于 `https://<32 位十六进制账户 ID>[.eu|.fedramp|.us].r2.cloudflarestorage.com`，且同一请求对确切 bucket 返回原始 HTTP 200、没有版本 / delete-marker 响应头、未取消或重定向。官方服务端点范围与认证成功缺一不可；不接受单纯域名猜测、SDK 空字段或权限错误。
- R2 不实现 `GetBucketVersioning` / `PutBucketVersioning`，不能把该接口的 403 当作凭据失效，也不能对任意服务把 403 / 501 转为无版本成功。HTTP、非默认端口、自定义域名、尾点和类似后缀不享有 R2 例外，仍须通过普通 S3 证明。事实依据为 [R2 S3 API 兼容表](https://developers.cloudflare.com/r2/api/s3/api/) 与 [地域端点说明](https://developers.cloudflare.com/r2/reference/data-location/)。
- saved-snapshot roots 与所有已提交任务 roots 保护原图，包括完成任务。只回收新登记、无根且脱离满 604800 秒的 IMPORT；作品、旧未登记媒体永不进入此 GC。
- 删除 canvas/node/result 不删除生成任务、媒体对象、不取消或退款。账户/管理员删除保留 immutable principal/job/key inventory，通过 nullable live FK 兼容既有删除规则。
- 单一 Worker GC loop 在 schema/storage/topology 就绪后运行；60 秒默认/最小间隔、20 默认/100 最大批次；单对象 30 秒、单 pass 45 秒；90 秒 singleton lease 和逐 asset token。七天不是可缩短的环境参数。
- `CANVAS_ENABLED=false` 默认。启用 Node 必须验证自身 canvas schema/storage，以及 Worker `capabilities.canvas` 精确 v1 DTO；即使 `WORKER_READINESS_REQUIRED=false` 也不能接受旧 Worker generic ready。
- 验证 runner 必须先只读解析并固定 local unix/npipe endpoint；仅保留 OS 环境，镜像 preflight 后创建 owner-marked 空 Docker config。容器创建/清理不能随 active context 改变或继承 auth/proxy；精确 ID/名称/owner 检查后才删除，不附带卷。worker/canvas Prisma 配置和 `.env` 读取独立隔离，旧 migration wrapper 需另加外层保护。

## 4. 校验与错误矩阵

| 条件 | 行为 |
| --- | --- |
| 未登录 / 功能关闭 | 稳定 401 / 404，不缓冲原图或执行任务。 |
| 旧 revision / changed same-run intent | 409，保留本地草稿，不自动 rebase/强制覆盖。 |
| deleted canvas / missing live job | 不复活；只读 ledger 保留原 job ID，生成 replay 返回 unavailable。 |
| 请求体/数量/原图额度超限 | 在有限缓冲/事务额度保护下拒绝，不静默丢弃来源。 |
| 不可用原图、错误 owner、未完成结果 | Save/Run 失败并保留组织，不用全局媒体替换。 |
| GetBucketVersioning 200 空正文或错误根 | UNKNOWN，不能从 SDK 空 Status 推断 UNVERSIONED。 |
| 合法空 VersioningConfiguration | 仍需准确 location、HTTP 200、单请求 raw-wire 证明；正文上限 16 KiB。 |
| 官方 R2 账户端点的认证 HeadBucket | 仅确切 bucket 的原始 HTTP 200 可用；单次请求、禁止重定向、不写入测试对象。 |
| R2 HEAD 失败 / 无原始响应证明 / 取消 / 超时 / 版本相关头 | `CANVAS_STORAGE_CAPABILITY_INVALID`，不执行导入或 GC 领取；不能回退为成功。 |
| 类似 R2 的非官方域名 / HTTP / 非默认端口 | 普通 S3 XML 校验，不能仅依据域名后缀放行。 |
| XML 非法字符（包括注释）、未知根/属性/namespace、DTD、Status 子节点 | fail closed，不导入/领取回收。Node/Go 对齐测试。 |
| 已知版本或迟到 version receipt | 隔离/永久版本栅栏，保留计账；禁止无版本删除确认或 READY 复活。 |
| 远端删除失败/未知 | 保留 inventory、deleting fence、有限退避，不能上报回收字节。 |
| 未知数据库/SDK 异常 | 安全稳定错误，不向客户端或结构化日志倾倒 SQL、DSN、正文。 |
| 远端 Docker context / 缺本地镜像 / daemon 超时 | 前置条件退出2，无拉取、建库或真实存储兜底；缺镜像应先于 scratch/容器创建，不能当成已通过 SQL/E2E。 |

错误定义以 `errors.json` 为准。`canvas_raise` 实际发出 SQLSTATE `23514`，MESSAGE/CONSTRAINT 为精确 `CANVAS_*` 代码；Node 同时兼容 `P0001`，但两者都必须命中完整消息白名单，不能将任意 check-constraint 或包含代码的原始错误文本当成业务错误。Prisma raw query 包装和 CRUD 的独立 `DriverAdapterError.cause` 都需精确识别；只重试已知回滚的 40001/40P01/P2034。

## 5. Good / Base / Bad

- Good：显式保存一个尚未运行的原图，成功 snapshot 原子建立 saved root；以后 Save/Run 复用 asset ID。
- Base：功能关闭时旧对话 JSON/multipart、生成作品、取消/退款契约保持兼容。
- R2 Good：官方 HTTPS 账户端点的带签名 HEAD 成功，Node / Go 都报告同一 bucket 已验证；R2 Bad：将任意 `AccessDenied` 或 `NotImplemented` 解释为无版本存储。
- Bad：HTTP 200 加 SDK 零值 Status 就报告存储能力已验证；按 key 前缀清空对象；删除布局时自动取消或退款；丢 ACK 后换 run ID。

## 6. 必需测试

- `canvas-contract`、`canvas-schema-probe`：完整函数体/参数默认值/索引/触发器/约束；结构表达式比较保留优先级、操作符和引用名称，不能用丢弃括号的正则制造 false-ready。
- `canvas-*-api`、`canvas-generate-*`：owner/CAS、上传重放、捕获快照、早期 replay、未知 commit、正常扣费/退款兼容、稳定错误；真实 Prisma adapter + fake driver 覆盖 void 和独立错误包装。
- SQL 错误映射回归从实际 canvas migration 的 `canvas_raise` 提取 SQLSTATE，再穿过真实 Prisma adapter 的 raw/CRUD 包装和路由/fence 分支；不能只用手写 `P0001` mock。非白名单 `23514` 必须保留安全未知错误行为。
- 真实 `pg` 夹具若把同一个参数同时用于 `VARCHAR` principal 字段和 `TEXT` 外键/存储字段，显式写 `$n::text` 后交给目标列转换，避免 PostgreSQL 42P08 在测试构造阶段提前失败。该修复只改变 fixture 参数类型，不应通过改生产 schema 或移除实际锁/CAS断言来规避。
- Node/Go raw storage wire：合法与非法 XML、16 KiB 限制、超时、迟到 receipt、版本状态、空/错误根 SDK 成功反例。
- Node/Go R2 探测测试复用 `storage-location.json` 的 `probeVectors`；通过真实 SDK + 模拟传输核验规范化端点、签名、确切 bucket、HEAD / GET 选择、单次请求、版本头、失败和取消。Go 的默认 HTTP 客户端可能跟随 307 / 308，专用探测客户端必须禁用并测试重定向目标零访问；不改变普通媒体客户端的配置。
- Go `canvas_*`：共享 grammar/location/retention vectors，实际 Worker.Run 的多消费者单 scheduler、drain/panic/topology loss、有界 join。
- 独立 `verify:canvas-contracts:db`：完整与 additive migrations、真实 catalogue、锁/lease/CAS/GC 竞争；必须有 runner sentinel 和 disposable localhost，缺基础设施明确未通过。
- `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts` 的跨模式回归使用真实 Prisma/会话 loader 与 GET：超过一页的旧任务必须在更多新画布/孤儿任务干扰下完整、有序恢复，更新 `updatedAt` 不改变创建游标；foreign/missing parent、跨 owner/parent/scope 游标不得回退到全局内容。
- 同一 SQL 套件通过实际会话 DELETE、`deleteCanvas` 事务和 `listUserWorksPage`/作品 GET 验证删除只移除组织。PENDING/PROCESSING 删除前后完整任务/图片、余额、run ledger 和 job-input roots 保留，后续模拟完成可读且不复活组织。仅身份可 mock；应用 Prisma 还需独立验证 runner sentinel。模拟完成不等于 Worker/provider 执行，修改该套件必须重跑完整与 additive histories，不能沿用旧用例计数作通过证明。
- `verify:e2e`：先安全 preflight，再启用态 embedded/dedicated/mismatch；mock S3，不使用真实对象存储。普通 Vitest 或 hidden-feature build 不能替代这些门禁。
- 两种启用拓扑都要通过实际认证 API 创建/上传/重放/保存/冲突/owner 隔离，并在同一组新导入原图上观察真实 Worker loop 的失败删除、数据库退避、精确 key 成功重试；最近孤儿、saved root、completed-job root、已删组织的作品及未登记 legacy/generated key 必须保留。不能直接调用 claim/finalizer 再声称调度器已验证。
- 测试时间只在 sentinel/owner/精确 ID 验证后的隔离数据库播种；随后实际 claims/finalizers 使用所有生产 guards 和数据库时间。只有四个 fixture import 的时间参与播种，不改保留期限/生产时钟。
- 用 SQL 播种 COMMITTED 任务时，快照先经真实 `canvasRunSchema`，intentHash 使用 `canonicalCanvasJson({canvasRun: normalizedRun, credentialFingerprint:null})`；错误的 `sha256(JSON.stringify(wire))` 会导致真实 HTTP replay 冲突。实际 `/api/generate` 重放前后必须仍是原 job/run/冻结输入/余额，且显式 run lookup/runtime IDs 可读；这不是新 provider 生成或真实付费验收。
- `local-docker-safety`：两种 DB runner 的实际命令入口都固定本地 endpoint/config；remote/changed context、hostile env、缺镜像、错误 scratch/container owner 和 exact-ID/no-volume cleanup 用 fake transport 回归，正向容器验收仍需真实本地基础设施。

## 7. 错误与正确示例

```ts
// Bad: a successful SDK decode can represent an empty/wrong-root response.
const unversioned = response.$metadata.httpStatusCode === 200 && !response.Status;

// Good: reuse the bounded, raw-envelope-verified adapter contract.
await verifyCanvasStorageCapability(adapter, adapter.location, timeoutMs);
```

```ts
// Bad: an unsupported operation or denied credential proves no capability.
if (error.name === "AccessDenied") return { verified: true };

// Good: the adapter selects an authenticated HEAD only for official R2 origins;
// all other providers still require a verified unversioned S3 XML response.
await verifyCanvasStorageCapability(createCanvasStorageAdapter(environment));
```

```ts
// Bad: replay discovers its existing job after another charge or CAPTCHA failure.
await chargeAgain();
await findPriorRun();

// Good: the original run identity selects replay before fresh business checks.
const reservation = await reserveCanvasRun(frozenAttempt);
if (reservation.kind === "replay") return canvasRunResponse(reservation.lookup);
```

```sql
-- Bad: one untyped parameter is inferred as VARCHAR and TEXT in the same query.
INSERT INTO "Canvas" (id, "ownerId", "userId", title) VALUES ($1, $2, $2, 'fixture');

-- Good: the real PostgreSQL fixture fixes parameter typing, not the contract.
INSERT INTO "Canvas" (id, "ownerId", "userId", title) VALUES ($1, $2::text, $2::text, 'fixture');
```
