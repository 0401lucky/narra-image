# Research: 图片输出额度预留与上游调用顺序

- Query: 能否在上游生成前按每张 50MiB、请求数量预留输出空间，写入后缩减为实际长度，同时保留现有扣费、退款与未知提交结果语义？
- Scope: internal；仅图片，用户已排除视频及视频专属封面。本文件仅补充额度准入，不重复 `retention-contracts.md`。
- Date: 2026-11-12
- Method: 静态阅读 Node/Go 入口、结果处理及生命周期契约；未访问网络/数据库，未修改产品或 spec。

## Findings

### 结论

可以将存储预留作为独立于积分的资源凭证，在首个生成 POST 之前保证 `已计量物理字节 + 未物化预留 <= 5,000,000,000`，随后把每个输出槽位的预留转换成实际文件计量。但 **`请求 count × 50MiB` 目前不是仓库可证明的输出上界**：base64 结果无单图 50MiB 检查，上游返回数量也未与 count 核对。最终设计必须同时落实这两个界限，不能只新增 SUM/预留表。

### 当前调用及扣费顺序

| 入口 | 当前顺序及证据 | 建议准入接入点 |
| --- | --- | --- |
| Web / Canvas `/api/generate` | Canvas 同 run 重放先返回（`src/app/api/generate/route.ts:74`）；校验后先上传普通参考图（`:189`），再在同一个事务内建 PENDING job、预扣内置渠道积分、commit Canvas run（`:214`、`:291`、`:302`、`:306`）。 | 重放仍最先返回；首个新生成请求在现有创建/扣费事务前取得输出凭证，再在事务内绑定 job。事务失败只释放已明确未绑定的凭证；未知 commit 必须按现有 Canvas recovery 判断，不能盲目释放。 |
| 外部 API legacy | `runExternalGeneration` 事务创建 `workerManaged=false` 的 job 并预扣积分（`src/lib/generation/external-api.ts:193`、`:226`），随后上传参考图、填 URL 并设 `workerManaged=true`（`:250`、`:264`）。入队前失败调用现有退款 helper（`:281`）。 | 在现有建 job/扣费前取得输出额度，在启用 Worker 消费前保证绑定有效；保留当前“上传失败且未交 Worker”的补偿边界。 |
| 外部 API gateway | Next 先预扣（`src/lib/generation/gateway-client.ts:254`），上传参考图，然后产生 jobId/签名 envelope 转 Go（`:257`、`:265`）。Go `INSERT ... ON CONFLICT DO NOTHING` 建 job，不再扣费（`worker/internal/worker/gateway_enqueue.go:35`、`:50`）。 | 提前生成稳定 jobId，在原 precharge 之前申请存储凭证；Go 以 jobId 验证/绑定已有凭证，不能另扣一次存储额度。无需将积分业务移到 Go。 |
| 已排队/旧写入者 job | Worker claim 后开启 heartbeat、处理取消、解析固定渠道，再调用 `generateImages`（`worker/internal/worker/worker.go:591`、`:620`、`:635`、`:680`）。 | Worker 必须有第二道强制校验/获取凭证，覆盖旧队列、Go gateway 和未走新 Node helper 的写入者；无法取得额度时不触发上游。 |

`generateImages` 先下载并校验参考图，然后选择 images/edits/responses 上游调用（`worker/internal/worker/generation.go:59`、`:69`）。统一的生成调用屏障可以放在这里首个 POST 前；同时 `processJob` 是所有当前生成结果的唯一生产调用者（`worker/internal/worker/worker.go:680`）。

实际上游副作用边界是 `doRequestWithClient` 在 `client.Do` 前调用 `markProviderSubmitting`（`worker/internal/worker/generation.go:452`）；2xx 响应后先标 SUBMITTED，再读取/解析响应（`:477`）。`withJobProviderLifecycle` 对 contractVersion=0 直接返回原 context（`worker/internal/worker/job_lifecycle.go:24`），所以不能仅把额度校验塞进 v1 lifecycle callback，否则默认关闭 v1 的生产路径会漏掉。

### 已存在的大小和数量界限

| 内容 | 当前边界 | 对预留的影响 |
| --- | --- | --- |
| Web、外部 images count/n | 公共验证器为 1–4（`src/lib/validators.ts:71`、`:206`、`:209`）；Canvas 文生图最多 4（`contracts/canvas/v1/limits.json:15`）。图生图公共解析/外部入口归一为 1（`src/lib/generation/parse-generate-request.ts:86`、`src/lib/generation/external-api.ts:187`）。 | 使用归一后的有效数量。不要取原始 wire count，也不要把图片额度加到视频分支。 |
| 内部 Go gateway count | 目前只检查 `>=1`，没有与公共 1–4 对齐的上限（`worker/internal/worker/gateway.go:147`）。 | Worker 必须重新验证数量及安全乘法。依赖所有 job 都经过当前 Node schema 不成立；超出允许数量的旧 job 需要明确失败而非溢出。 |
| 上游成功 HTTP body | 每次响应整体 128MiB，Content-Length 和 limit+1 流读取都检查（`worker/internal/worker/generation.go:48`、`:484`、`:497`）。 | 这不是单图 50MiB；单个 b64 字符串理论上可接近 96MiB 解码内容，且 Responses 的 count 次请求各有自己的 body 上限。 |
| 生成 b64_json | 直接 `DecodeString` 后 `PersistImage`，没有 decoded length 50MiB 限制（`worker/internal/worker/generation.go:341`）。`Storage.PersistImage` 也没有输入大小上限（`worker/internal/worker/storage.go:100`）。 | 要采用 50MiB 槽位，需先检查编码长度上界，再有界解码并验证实际长度，存储层再检查凭证/固定长度。不能以 HTTP body 上限替代。 |
| 生成远端 URL | 下载前/后均有 50MiB 上限，采用 limit+1 读取（`worker/internal/worker/storage.go:27`、`:336`、`:340`、`:344`）。data URL 分支也经参考图解析的 50MiB 检查（`:374`、`:382`）。 | 已有远端路径界限可以作为新共享单图上限的依据，但需要与 b64 路径统一。 |
| 上游输出数量 | `generateImages` 遍历所有 `payload.Data`，只检查非空（`worker/internal/worker/generation.go:80`、`:84`）。Responses 对每次调用返回的所有图片追加（`:193`、`:205`）。 | 应在任何物理写入前确认总输出数不超过可消费的槽位。Responses 还应在循环收集时约束，不能误以为一次请求只会返回一张。超量是上游后失败，禁止为拿够/修正结果重试生成。 |
| 参考图下载/Worker 解码 | 每张 50MiB，全部参考图合计 32MiB（`worker/internal/worker/storage.go:27`、`:28`、`:255`）。 | 输出预留不包含新参考文件；新参考文件另按实际已验证长度申请图片存储额度。重用已存对象不再加一份物理用量。 |
| Canvas 原图/请求体 | 原图 8MiB、run JSON 128KiB（`contracts/canvas/v1/limits.json:10`、`:22`）。 | 保留既有更小的输入边界，不能统一放宽成 50MiB。 |
| 普通 Web multipart | 最多 16 个文件/URL，检查 image MIME；这里未发现单文件 byte 上限（`src/lib/generation/parse-generate-request.ts:55`、`:62`、`:66`）。Node helper 的 buffer/b64 分支也没有长度上限。 | 不能仅修 Go 输出；物理写入 gate 必须覆盖已缓冲 buffer，并在写前按实际长度准入。若本轮要改请求流读取，也应控制范围，不顺带重写所有请求解析器。 |
| 外部参考图 | edit/source-images 每张 10MiB；chat/responses 最多 4 个来源（`src/lib/external-api/image-edits.ts:6`、`src/lib/external-api/source-images.ts:6`、`src/lib/external-api/chat.ts:10`、`src/lib/external-api/responses.ts:13`）。 | 属于输入限制，与生成输出限制独立，保留现有验证。 |
| 对用户返回 b64_json | Node/Go 转换输出上限 25MiB（`src/lib/external-api/images.ts:3`、`worker/internal/worker/gateway_response.go:129`）。 | 这是已经生成/存储后的响应格式限制，不是输出持久化的最大文件界限，也不会为图片再增加一份存储预留。 |

Node helper 的远端分支有 50MiB 检查，但读取 `arrayBuffer()` 后才做实际长度检查（`src/lib/storage/persist-generated-image.ts:67`）；这能限制最终接受大小，不能保证读取过程中内存有界。此项无需扩大为网络栈重构，但报告不能声称已存在全链路有界流。

### 必须保留的错误与退款区别

| 失败位置 | 应保留的业务结果 |
| --- | --- |
| 尚未扣费/建 job 的输出额度不足 | 明确的容量不足响应，零上游调用、零积分扣减；可以先尝试有界清理再申请，清理 IO 不占用扣费事务。 |
| 已有 job，但尚未调用上游的额度不足 | 使用明确、不可重试的 pre-handoff 容量错误走现有 finalizer；已预扣积分按现有 CAS 最多退一次。不能抛普通字符串错误，否则通用 classifier 可能归为 HANDOFF_UNKNOWN（`worker/internal/worker/lifecycle.go:157`、`:210`）。新错误需进入共享 generation 契约及 Node/Go 映射。 |
| 已收到生成结果，大小/数量超界或保存失败 | 作为 `ResultPersistError`，而不是安全的 pre-handoff 容量错误。该类型映射 `RESULT_PERSIST_FAILED + HandoffUnknown=true`（`worker/internal/worker/lifecycle.go:165`）。不新增上游重试。 |
| contract v1 的保存失败 | `handleJobFailure` 走 finalizeUnknown：job FAILED + handoff UNKNOWN、attempt UNKNOWN，保留积分且不自动重试（`worker/internal/worker/job_lifecycle.go:249`、`:269`、`:532`）；与 `contracts/generation/v1/errors.json:118` 一致。 |
| contract v0 的保存失败 | **现有兼容路径仍走 finalizeKnownFailure**（`worker/internal/worker/job_lifecycle.go:254`），按 `creditsSpent>0 && !refundAppliedAt` 退款（`:444`、`:496`）。本次存储改造不能把全部 v0 任务偷偷变成 v1 不退款政策，也不应强制开启 v1。 |
| 网关连接/等待不确定 | job 已存在时 Next 不补偿退款；未建 job 才补偿（`src/lib/generation/gateway-client.ts:198`、`:215`）。存储凭证也不能因客户端超时无条件释放，必须依据 job/写入状态回读。 |
| Canvas commit ACK 不确定 | 继续原 run recovery，不换身份/重复扣费；新的额度错误若在事务内抛出，需要被识别为明确 rollback，避免错误落进未知 commit 分支（`src/app/api/generate/route.ts:319`）。 |

### 最小接口/状态建议（待主设计采纳）

1. **先预留整批输出**：`reserveImageOutputs(ownerId, intentId, effectiveCount)` 返回凭证，固定每槽 52,428,800 字节；count=1–4 时最多预留 209,715,200 字节。凭证绑定不可变 intent/job/count，并在 job 创建事务中完成绑定；同一 Canvas/gateway 重放回读已有凭证，不二次分配。积分 `calculateGenerationCost`、扣减量和退款策略保持原样。
2. **Worker 接管**：`acquireOutputReservationForAttempt(jobId, attemptOrdinal, workerToken)` 检查/续租已有凭证，必要时为旧队列申请；使用同一全站 gate，接管失败不进入上游 POST。重试仅沿现有 pre-handoff 规则，不能为每个安全 attempt 累加一整批永久预留。
3. **每个文件只计一次**：`beginImageObject(reservationId, token, slot, exactBytes, immutableKey)` 在写入前原子地把该槽位的最大预留换成 exactBytes 的物理清单计量，释放差额；写入者只能写已声明的固定长度。例：预留 100MiB，两张各 10MiB，第一张开始写后为“10MiB 已计量 + 50MiB 未消费预留”，而不是 10+100。
4. **独立标识不确定状态**：至少区分未绑定 RESERVED、已绑定/使用中的 ACTIVE、禁止新写入的 CLOSED，以及每个物理对象的 NOT_STARTED/WRITING/CONFIRMED/UNKNOWN。租约到期本身不证明无文件。先不可逆地关闭旧 token 的后续写入能力；从未分配到物理对象的槽位才可释放，已经开始或结果未知的 object bytes 保留到对账/删除确认。上游 handoff UNKNOWN 与存储 PUT UNKNOWN 是不同事实，不能互相代替。
5. **多图失败和最终提交**：当前先顺序持久化全部图片，然后 `completeJob` 才在一个事务插入所有 `GenerationImage` 并完成 job/attempt（`worker/internal/worker/generation.go:84`、`worker/internal/worker/worker.go:1016`）。第二张失败时第一张已存在但不会有业务图片行。必须由独立 inventory 留住第一张计量，清理成功后才减；不得在异常路径释放整个 batch。DB 最终提交失败同理，沿原 job/attempt 写回校验，不能重新请求上游。

### 可能跳过校验的入口

- Node `persistGeneratedImage` 被 Web、external legacy、gateway 三处调用（`src/app/api/generate/route.ts:198`、`src/lib/generation/external-api.ts:252`、`src/lib/generation/gateway-client.ts:153`），并递归处理 URL；需要在最终物理写入层强制凭证/登记，不能只给某条路由加检查。
- Go `PersistImage` 也被旧回填直接调用（`worker/internal/worker/backfill.go:198`）。迁移/回填属于已知输入字节的复制准入，必须申请实际写入额度，不能借“不是生成任务”绕过全局配额。
- Canvas 导入使用另一套 adapter（`src/lib/canvas/assets.ts:156`、`:175`），要接同一全站 gate，并保持原来的每用户额度和七天引用契约。
- 存量队列和 Go gateway 能绕过新的 Node 准入，因此 Worker 的 pre-provider guard 和存储层的精确长度 guard 都必须存在。

## Related Specs / External References

- `.trellis/spec/frontend/generation-worker-contracts.md`：新错误/状态要先更新共享 generation contract；默认兼容 v0。
- `.trellis/spec/operations/media-storage.md`：持久化失败终态、历史回填与真实存储操作边界。
- `.trellis/spec/operations/gateway.md`：Next 预扣、Go 建任务、未知转发补偿边界。
- 无外部资料或新依赖；均为当前仓库证据。

## Caveats / Not Found

- 50MiB 的统一生成输出上限是本次需要新增并在最终计划说明的限制；目前 b64 结果可能合法大于它。若必须完全保留现有 b64 接受范围，需改用更大的保守上界并仍限制结果数量，不能声称 count×50MiB 已足够。
- 最坏情况预留会比实际图片更早触发容量清理：四张请求可能需要约 200MiB 可用额度，即使实际结果只有数 MiB。应在规划中披露这项取舍，不能许诺仅清理最终文件超出的精确字节数。
- 增加额度 gate 不需要重新设计计费或改变旧任务版本；网关凭证的 DB 绑定和新 generation 错误是必要跨层接缝。不要为了本地图片存储顺带改视频、公开 Go ingress 或整个生成重试模型。
- 尚未验证真实并发/中断场景；实施后需要针对边界大小、超量输出、两个请求抢最后额度、部分写成功、未知提交及 v0/v1 退款差异的测试。
