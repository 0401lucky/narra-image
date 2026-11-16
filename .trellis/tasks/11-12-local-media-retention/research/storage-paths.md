# Research: 本地媒体存储的读写入口、部署与历史兼容

- Query: 在现有 S3/R2 之外增加生产 LOCAL 存储，需要接入哪些入口；哪些约束影响公开读取、内部消费、历史迁移和视频范围。
- Scope: internal；只读代码和项目规范，输出仅在本任务 research 目录。
- Date: 2026-11-12
- Status: 规划证据；用户后续已明确仅做图片、排除视频及视频专用封面。下文视频增量比较保留为调研记录，不属于本轮实施范围。

## Findings

### 1. 文件位置与职责

| 文件 | 作用 |
| --- | --- |
| `src/lib/storage/persist-generated-image.ts` | Node 的普通参考图写入，返回 URL；目前只有 S3 与 data URL 回退。 |
| `src/app/api/generate/route.ts` | 网页生成入口，上传参考图、写入任务与输入 URL，覆盖图片及视频。 |
| `src/lib/generation/external-api.ts` / `gateway-client.ts` | 外部 API 的两条参考图上传与提交路径。 |
| `worker/internal/worker/storage.go` | Go 图片/视频持久化与参考图下载。 |
| `worker/internal/worker/generation.go` / `video.go` | 上游结果下载和持久化；视频首帧交给上游的 URL 语义。 |
| `worker/internal/worker/worker.go` | 生成完成后写入 `GenerationImage` / `GeneratedVideo`。 |
| `src/lib/canvas/assets.ts` / `storage.ts` / `inputs.ts` | 画布导入登记、S3 能力检查、位置解析和生成输入解析。 |
| `worker/internal/worker/canvas_gc_storage.go` | 画布 GC 的存储抽象，当前构造器仅接受 S3。 |
| `src/app/api/proxy-image/route.ts` / `proxy-video/route.ts` | 已登录用户的远端下载代理，不是本地文件服务。 |
| `src/lib/server/safe-remote-url.ts` | 公网 HTTP(S)、DNS/IP 固定与重定向限制。 |
| `src/lib/prisma-mappers.ts` / `image-url.ts` | URL 序列化及 Next 图片优化 URL 包装。 |
| `src/lib/external-api/images.ts` / `worker/internal/worker/gateway_response.go` | 对外 `b64_json` 响应会重新读取已存储的图片 URL。 |
| `worker/internal/worker/backfill.go` | 旧媒体转存到 S3 的工具逻辑；不是现成的 S3→LOCAL 迁移器。 |
| `contracts/runtime/v1/environment.json` / `src/lib/env.ts` / `worker/internal/worker/config.go` | 跨 Node/Go 的环境契约与唯一配置读取边界。 |
| `docker-compose.yml` / `docker-compose.images.yml` / `scripts/start-prod.mjs` | dedicated 与 embedded 发布拓扑。 |

### 2. 图片写入至少有四条必须覆盖的路径

1. **网页参考图**：`src/app/api/generate/route.ts:189` 将上传文件读成 Buffer，`:196` 调用 `persistGeneratedImage`，`:206` 合并上传结果 URL 与用户给出的 URL，`:250` 写入 `GenerationJob.sourceImageUrls`。上传发生在创建任务事务之前；创建失败并不会通过此调用点回滚文件。若容量只统计 `GenerationImage`，此类文件会漏算。
2. **外部 API 参考图**：`src/lib/generation/external-api.ts:193` 先创建暂不由 Worker 消费的任务，`:250` 上传文件，`:260` 更新输入 URL；启用 gateway 的路径则在 `src/lib/generation/gateway-client.ts:254` 预扣积分、`:257` 上传、`:261` 提交签名 envelope。两条路径都复用 `persistGeneratedImage`，但任务绑定时点不同。
3. **Worker 生成结果**：`worker/internal/worker/generation.go:341` 支持上游 base64 与 URL 两类结果；分别在 `:351`、`:360` 持久化。`storage.go:100` 返回 `PersistedMedia{URL, MediaStorage, StorageKey}`，随后 `worker.go:1016` 的完成事务在 `:1030` 插入图片记录。结果文件先于最终数据库事务存在；事务失败与多图中途失败都需要可追踪的未绑定物理对象。
4. **画布导入**：`src/lib/canvas/assets.ts:128` 校验上传声明、摘要和内容，`:143` 验证存储能力，`:144` 起事务预先登记 inventory 与账户额度，`:175` 才 PUT。此路径已有上传身份、未知结果隔离和重放语义，应保持其保证，而不是替换为普通“写文件后插一行”。

`src/lib/storage/persist-generated-image.ts:118` 当前只返回字符串 URL，`:132` 自行生成文件 key，`:136` 上传 S3，`:153` 的 `ENABLE_LOCAL_IMAGE_FALLBACK` 产生 base64 data URL。这个配置名并不表示落盘。Go 的同名回退另有生产拒绝检查（`worker/internal/worker/storage.go:126`）；添加 LOCAL 不能把回退开关重新解释为生产文件模式。

### 3. 本地文件仍需要可用的 HTTP(S) 媒体地址

| 消费方 | 当前约束与影响 |
| --- | --- |
| 网页图生图、画布输入 | `src/app/api/generate/route.ts:42` / `:159` 通过公网地址检查；`src/lib/canvas/inputs.ts:17` 只接受绝对 HTTP(S) 或指定 data URL。不能把文件绝对路径、`file://` 或只有 `/media/...` 的相对地址写进现有任务 wire。 |
| Go 图生图 | `worker/internal/worker/generation.go:60` 调用 `loadSourceImages`；`storage.go:261` 起的来源读取及 `:397` 起的 HTTP 客户端执行公网 IP 和重定向检查。任意内网 URL 不能因 LOCAL 功能而全局放行。 |
| Go gateway | `worker/internal/worker/gateway.go:141` 要求输入 URL scheme 为 HTTP(S)，data URL 也不属于此 envelope 的既有范围。 |
| 图生视频上游 | `worker/internal/worker/video.go:93`–`:98` 把 `job.SourceImageURLs[0]` 原样作为 `input_reference` 交给上游；上游不会拥有本站登录 cookie，也不能读服务器文件路径。即使视频结果暂不迁移，改为本地的图片首帧也必须可供上游获取。 |
| `b64_json` 输出 | Node 的 `src/lib/external-api/images.ts:24`、Go 的 `gateway_response.go:129` 重新通过 HTTP GET 读取结果 URL；两侧均有 25 MiB 结果转换上限。只验证浏览器显示不足以验证 LOCAL。 |
| 下载代理 | `src/app/api/proxy-image/route.ts:70`、`proxy-video/route.ts:70` 要求本站登录，但随后以服务端身份读取公网目标，不转发用户 cookie；目标不能是任意内部路径。 |
| 缩略图 | `src/lib/image-url.ts:43` 包装 `/_next/image`；`next.config.ts:7` 定义优化选项。带登录 cookie 的文件 route 不能直接假设与优化器兼容。 |

建议设计时分开两个概念：**网页/外部 provider 可取得的媒体 URL**，以及**服务内部基于已验证媒体记录的读取能力**。可以从受信配置的 `APP_URL` 生成绝对 URL；内部读本地字节必须从登记对象和受控根目录解析，而非对用户输入 URL 增加“允许 localhost”的例外。若引入短期签名 URL，需要处理排队任务、provider 拉取时间及保存场景的失效语义，不能直接把短期 URL 当永久身份。

### 4. 本地服务的权限与缓存边界

- 现有 S3 URL 从 `S3_PUBLIC_BASE_URL` 或 endpoint/bucket 拼接（`worker/internal/worker/storage.go:192`、`src/lib/storage/persist-generated-image.ts:146`），代码没有在此生成按用户鉴权的读签名。
- 作品页面有 owner/精选权限判断（`src/app/works/[id]/page.tsx:27`、`:50`），但 serializer 仍输出文件原 URL（`src/lib/prisma-mappers.ts:259`、`:292`、`:445`）。作品列表的 PRIVATE 状态不能被当作“当前文件字节受 cookie 保护”的证明。
- LOCAL route 需要明确读取政策：兼容当前拥有不可猜 URL 即可读取的模式，或提供 owner/公开状态检查并为 provider 发行可独立访问的 URL。后一项会扩大到认证、缓存和任务 URL 生命周期。规划中应明确选择，不要不自觉地把本地图片全部公开，也不要只加 cookie 检查后破坏 provider。
- 路由应以媒体 ID/不可猜 token 查 inventory，再由受控 key 读取；不接受用户给出的磁盘路径，不枚举目录，不从 URL 路径直接拼任意本地文件。MIME、`nosniff`、清理态和读取失败需要一致响应。
- `proxy-image` 当前缓存 `private, max-age=86400, immutable`（`:113`），Next 缩略图亦可缓存副本。5GB 原文件额度不等于数据库、日志、Next 优化缓存及客户端缓存的总磁盘占用；删除原文件也不能撤回已缓存副本。使用独立媒体根目录有利于正确计量。

### 5. Canvas 的存储位置和迁移存在硬约束

- `src/lib/canvas/storage.ts:204` 用规范化 S3 location 验证能力，`:215` 解析 URL 时要求登记位置与当前 S3 endpoint/region/bucket 相同；删除 S3 配置或切换 bucket 会使旧导入素材返回 `null`。
- `worker/internal/worker/canvas_gc_storage.go:39` 的接口已经有 `Verify/Delete/Location`，但 `:60` 的工厂依赖 S3 凭据、S3 location 和 S3 client 类型。LOCAL 必须同时适配 Node 导入与 Go 回收，不是只新增 `PersistImage` 分支。
- `prisma/migrations/20261029090000_canvas_v1/migration.sql:525`–`:530` 明确禁止更新现有 inventory 的 physical location/key、字节数、摘要、上传身份。不可直接 UPDATE 旧 asset 的 S3 key 为本地路径。
- 同一迁移的 `:531`、`:542` 保留引用检查和七天宽限。全站容量压力不能直接绕过这些 guard。
- `src/lib/readiness.ts:219`–`:230` 在 canvas 启用时验证真实 schema 和 app 自己的存储能力；Go 的 `canvas_runtime.go:57` 也做依赖探测。应扩展共享 location/provider/capability 契约，保留 S3 的原探测及未知状态拒绝语义，并让 LOCAL readiness 验证真实卷而非假报 S3 无版本。
- 保持旧 asset ID 和业务引用稳定的可行方向，是增加独立“逻辑媒体 → 当前可读副本/物理位置”的登记层，旧 S3 inventory 保留其不可变事实；该方向需要 additive migration 和 Node/Go 契约同步。不能为了省一张映射表解除既有 immutable guard。此处仅记录设计边界，具体 schema 待范围确定。

### 6. 生成媒体历史兼容与迁移工具缺口

- `prisma/schema.prisma:544` / `:569` 的生成媒体只有 `mediaStorage`、`storageKey`、URL；没有每行 endpoint/bucket、已核实字节数和统一删除状态。不能根据部署“当前 S3 配置”直接认定任意旧 key 的物理位置。
- `worker/internal/worker/backfill.go:39` 要求目标 S3；`:145` 仅扫描 `mediaStorage IS NULL`，`:198` 写入新 S3 对象后条件更新媒体行。它不会迁移已标记 S3 的历史媒体，也不会覆盖普通上传参考图、Canvas inventory 或所有引用 URL。
- 普通任务在 `GenerationJob.sourceImageUrls` 中保留字符串 URL；新页面、历史任务、Canvas 导入与生成结果对 URL 的处理不同。只更新 `GenerationImage.url` 无法覆盖“旧结果后来被用作参考图”的所有读取路径。
- 建议迁移先显式登记来源位置并核实大小/摘要，再复制到 LOCAL、验证内容、原子切换逻辑读取位置；旧源保留到验证和处理引用完成。迁移副本、临时文件及尚未完成删除的源都需要保留物理计量，不能只按逻辑图片数宣布释放空间。
- Legacy 只有 URL 的记录可以继续按原 URL 展示，或者走显式来源核对；不可仅凭 URL 前缀归属推断就删除 bucket 对象。旧外部分享的 R2 URL 是否长期保留还取决于 CDN/域名及源对象策略，当前仓库不能保证外部链接在删源后继续工作。

### 7. 部署接入点

| 拓扑 | 仓库证据 | LOCAL 最小要求 |
| --- | --- | --- |
| embedded / Zeabur | `scripts/start-prod.mjs:231` 派生 Worker 并传同一运行环境，`:247` 等 Worker ready 后 `:260` 才启动 Next；`Dockerfile:62` 包含 Worker。 | 单应用容器挂载独立持久化卷，Node/Go 使用相同根目录和 location ID；升级后的代码目录与数据目录分开。存储探针不能依赖尚未启动的 Next 媒体路由，否则启动死锁。 |
| dedicated / Compose | `docker-compose.yml:66` 的 Worker 与 `:102` 的 app 是不同容器；目前只有 db 在 `:41` 挂卷。 | app 和所有参与生成/回收的 Worker 挂载同一个媒体卷并具备相应写入权限；单宿主机先满足共享文件系统语义。容器内部路径可以一致，但身份不能只凭路径字符串。 |
| 预构建镜像 overlay | `docker-compose.images.yml:1`–`:10` 只重置 build 和替换 image，继承基础 Compose。 | 在基础 Compose 添加卷后验证 overlay 合并配置；不要在 overlay 复制另一套容量参数。 |

`contracts/runtime/v1/environment.json:172`–`:260` 将现有存储配置标记为 shared，允许读路径仅为 `src/lib/env.ts` / `worker/internal/worker/config.go`。新增 provider、媒体根目录、location ID 等运行参数需要在 manifest、两侧 loader、示例环境和 README 中一致落地；Go 的 `LoadStorageConfig` 运维工具入口（`config.go:157`）也要覆盖。

启动/重启验证应覆盖文件真实持久化、卷身份匹配、空间不足、写权限失败，以及 Node/Go 同时访问。LOCAL 模式不具备跨主机自动共享能力；多主机部署需共享文件系统或继续 S3，不能依赖同名 Docker volume 当作跨主机存储。

### 8. 视频范围的独立增量

目前视频是完整功能，不只是未使用的 schema：`video.go:60` 执行提交/轮询/下载，`:224` 强制对象存储，`:235` 持久化 MP4，`worker.go:1083` 完成入库；作品页和视频工作台会播放原 URL。

若视频一起迁移并共用额度，除了通用 LOCAL adapter 还需：

- 将 `buildVideoResult` 的 S3-only 能力检查替换为明确支持视频的持久化能力，保持 `RESULT_PERSIST_FAILED` 不返回短期上游链接的语义。
- 把视频实体、大小和状态纳入同一清单及清理预览；视频的体积会影响图片可用容量，不应自动扩大用户同意的删除范围。
- LOCAL 服务支持 MP4 正确 MIME、HEAD/Range/206 及有界流式读取，验证拖动进度和下载；`proxy-video` 当前仅是下载代理，不能被视为现成本地播放器服务。
- 保持现有大小边界：Go 上游视频下载最大 **128 MiB**（`video.go:15`、`:277`），网页视频下载代理最大 **512 MiB**（`proxy-video/route.ts:6`）；它们不是全站存储额度。
- `VideoResult.PosterURL` / `GeneratedVideo.posterUrl` 存在，但 `buildVideoResult:240` 当前没有设置生成封面。历史已有封面仍需按实际来源登记，不能假定每个视频都有额外一张本地封面。

若本轮只改图片，视频结果可继续走原 S3；但是图生视频对本地首帧图片可公开取得的要求仍属于图片存储兼容工作，不能遗漏。

## Related Specs

- `.trellis/spec/operations/media-storage.md`：结果持久化、历史 fallback、明确失败与回填边界。
- `.trellis/spec/operations/canvas-contracts.md`：不可变 inventory、业务引用、七天宽限、Node/Go location 与能力探针。
- `.trellis/spec/operations/release-hardening.md`：两种拓扑、启动顺序、共享环境 manifest、additive migration 和隔离验证。
- `.trellis/spec/frontend/public-work-data.md`：公开作品 DTO 白名单，后续 LOCAL 元数据不得旁路公开内容限制。
- `.trellis/workflow.md`：当前仍在规划，未做实现或生产验证。

## External References

本次结论全部来自仓库代码和规范，未调用外部 API、未核查 Cloudflare 实时价格、未获取任何生产凭据或桶清单。没有基于第三方文档假定新的库 API。

## Caveats / Not Found

- 未发现生产落盘 adapter 或统一普通参考图物理 inventory；不能将 `ENABLE_LOCAL_IMAGE_FALLBACK` 当作已经支持本地文件。
- 未连接实际服务器、数据库、S3/R2；实际媒体量、现有 bucket 映射、磁盘/卷配置和 CDN 域名可控性尚无外部证据。
- 用户已排除视频。图片读取的最终方案见父 design.md：保持不可猜 HTTP(S) 链接的既有兼容语义，内部按受信登记对象读取；不新增 cookie-only 文件权限模式。
- 这是研究输出，未执行测试；所列验收点是后续实施必须验证的行为，不是已通过的结果。
