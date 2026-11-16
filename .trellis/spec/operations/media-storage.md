# 媒体持久化契约

## 1. 适用范围与触发条件

- 适用于生成结果媒体（`GenerationImage` / `GeneratedVideo`）的持久化、存储形态标记、失败语义与历史回填，以及 Node 参考图上传的存储配置。
- 修改 `worker/internal/worker/storage.go`、`video.go`、`generation.go`、`worker.go` 的媒体写入路径、`src/lib/storage/persist-generated-image.ts`、`GenerationImage`/`GeneratedVideo` 的存储相关列、`contracts/generation/v1/scenarios/media.json` 媒体字段，或 `worker/cmd/backfill-media` 时，必须先读本规范。
- 本规范不授权连接真实 S3/R2、生产批量回填或 CDN 变更；真实环境验证需用户授权并单独记录。

## 2. 接口、配置与存储策略

- Go 入口：`PersistImage(ctx, userID, data, extension, mimeType) (PersistedMedia, error)`；`PersistImageFromURL(ctx, userID, rawURL, client) (PersistedRemoteImage, error)` 下载后复用前者。
- Node 参考图入口：`persistGeneratedImage(input: PersistImageInput): Promise<string>`，接受 buffer、base64 或远程 URL；生成结果的生产策略由 Go 执行。
- `ENABLE_DATABASE_IMAGE_STORAGE` 为 shared runtime boolean，默认 `false`。唯一解析入口是 Node `src/lib/env.ts` 和 Go `worker/internal/worker/config.go`，配置事实源为 `contracts/runtime/v1/environment.json`；Go `LoadConfig` 与 `LoadStorageConfig` 均读取到 `Config.EnableDatabaseImageStorage`。
- 图片在 managed 模式下可使用 LOCAL 持久卷，具体登记/预留/读取与环境契约见 [Image Storage](./image-storage.md)。此模式先于数据库存图与开发回退开关；额度、配置、写入失败都不能回退到未登记的数据库字节。
- 生产环境为 `NODE_ENV=production` 或 `APP_URL` 非 loopback 显式值。未启用 managed 时，生产生成图片可以显式选择数据库存图，否则要求对象存储（`S3_BUCKET + S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY`）。所有视频持久化仍要求对象存储。
- 图片：
  - managed 启用：Node/Go 先申请统一额度、登记具体对象，再按 LOCAL/S3 写入，返回稳定媒体 token URL；`IMAGE_STORAGE_BACKEND=local` 要求 shared 卷和有效身份。两个旧回退开关都不能绕过额度或清单。
  - managed 关闭且有对象存储：`PersistImage`/`PersistImageFromURL` 存 S3，返回公开 URL；优先于数据库存图开关，上传失败不改走数据库回退。
  - managed 关闭、无对象存储且 `ENABLE_DATABASE_IMAGE_STORAGE=true`：生产与非生产均可将完整图片编码为 data URL，标记 `B64`。不依赖 `ENABLE_LOCAL_IMAGE_FALLBACK`，也不需要数据库迁移。
  - managed 关闭且未显式选择数据库存图：仅非生产且 `ENABLE_LOCAL_IMAGE_FALLBACK=true` 才允许生成结果 data URL fallback；生产仅开启旧回退开关仍返回明确错误。
  - Node Web 参考图上传同样支持数据库存图开关；managed 关闭时保留旧参考图回退兼容性，不将它用作绕开 Go 生成结果策略的入口。
- 视频：
  - 有对象存储：`buildVideoResult` 下载上游视频转存 S3，返回 S3 URL。
  - 无对象存储：直接以 `RESULT_PERSIST_FAILED` 失败并给出明确错误，不得回退短期上游 URL。
- 提示词库封面/预览图保持上游 URL，不转存 S3（不在媒体持久化范围内）。
- 数据库存图沿用既有 data URL 形态，会增加数据库、接口响应与备份体积；不因选择此模式更改 `NODE_ENV` 或伪造 loopback `APP_URL`。
- Go `/v1` 内部网关的参考图输入仍只接受 HTTP(S) URL，envelope 还有 1 MiB 请求体上限（`worker/internal/worker/gateway.go`、`contracts/gateway/v1/envelope.json`）。数据库 data URL 不能直接用于该 `/v1/images/edits` 输入；Web 文件参考图经数据库队列处理可以读取 B64。这个图片结果存储开关不扩展网关参考图传输协议，不能据 Node helper 返回成功就宣称所有参考图入口都可用。

## 3. 存储形态元数据

- `GenerationImage`/`GeneratedVideo` 保存 `mediaStorage` 与 `storageKey`（均可空）：
  - `mediaStorage`：`B64`（显式数据库存图或非生产 data URL fallback）| `S3`（对象存储）| `NULL`（legacy 行）；图片增加 `LOCAL`，视频保持原值域。
  - `storageKey`：不可变原始写入 key；managed 图片的实际当前位置以 `mediaAssetId → ImageAsset.activeObjectId → ImageObject/ImageStorageLocation` 为准，不能由当前默认后端推导。
  - `GenerationImage.mediaAssetId` 可空且唯一，managed 写入关联逻辑图片；物理清单不随业务 cascade 消失。
  - 未受管理的 S3 图片保存 object key；数据库存图的 `storageKey` 与 `mediaAssetId` 为 NULL，不伪造已登记副本或计量。
- 写入者（Go worker）在 Persist 成功后带出 `(url, mediaStorage, storageKey)` 并随 INSERT 落库；旧写入者不传字段仍可插入（additive）。
- legacy 行判定（用于展示/回填扫描，不迁移数据）：`data:` 前缀 → B64；其余 http(s) URL 无元数据时保持 `NULL`，不臆断来源。

## 4. 失败语义

- `ResultPersistError` 保持 `RESULT_PERSIST_FAILED`（handoff 已发生，不得盲目重试上游）；v1 UNKNOWN 不自动退款，v0 保持原有兼容退款。图片容量不足属于 provider 前的确定失败，不能误归到 UNKNOWN。
- 存储瞬时故障不做自动重试，以终态失败 + 回填/重跑补偿；运维通过 attempt ledger 的 `providerRequestId` 协调。

| 条件 | 行为 |
| --- | --- |
| managed 启用、额度或持久化失败 | 保留原错误和清单语义，数据库存图及旧回退开关均不能转存 B64 |
| managed 关闭、无 S3、生产、数据库存图显式开启 | 完整 data URL + `B64`；非 S3 `storageKey` 为空并按既有写回约定落库 |
| managed 关闭、无 S3、生产、仅旧回退开关开启 | Go 拒绝生成结果保存，终态 `RESULT_PERSIST_FAILED`；错误提示可配置对象存储或显式启用数据库存图 |
| managed 关闭、无 S3、两个存图开关都关闭 | `当前没有可用的图片存储配置`，不保存临时上游 URL |
| managed 关闭、有 S3、数据库开关任意 | S3 写入；S3 失败保持错误，不转存 B64 |
| 新开关为无效布尔值 | Node loader、Go `LoadConfig() (Config, error)` 与 `LoadStorageConfig() (Config, error)` 均拒绝配置 |
| 无 S3 的视频 | 保持 `RESULT_PERSIST_FAILED`，数据库图片开关和 managed LOCAL 均不提供视频存储 |
| Canvas 原图导入 | 使用 S3 或受管理 LOCAL；数据库图片开关不提供 Canvas 原图存储 |
| `/v1/images/edits` 参考图被上传 helper 转为 data URL | 仍被现有网关 HTTP(S) 输入校验拒绝；数据库存图模式不解除该限制 |

## 5. 历史兼容与回填

- 历史 `GenerationImage.url` / `GeneratedVideo.url`（data URL / S3 / 上游）保持可读，前端 URL 展示契约不变。
- 回填工具 `worker/cmd/backfill-media`：图片扫描同时要求 `mediaStorage IS NULL` 与 `mediaAssetId IS NULL`，视频保持原 NULL 条件。下载前和 PUT 前复核当前 owner/原 URL/NULL 元数据及关联，已被历史纳管的行不得再次复制。非 managed 仍转存 S3，managed 图片遵守新对象预算/身份规则；更新用相同条件 CAS，未确定绑定结果保留已落盘清单。`--dry-run`/`--limit`/`--include-http` 保持，它不是无 PUT 的历史盘点工具。
- `image-history --apply` 前须 drain 所有旧写者和 backfill。上述短查询不是正在进行的 unmanaged S3 IO 可被撤销的保证，不能持有长业务事务跨网络 PUT 来制造并发保证；新的 managed 写入仍由原 reservation/grant/ledger 约束。

## 6. 验证入口

```powershell
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./internal/worker/...
go -C worker build ./...
pnpm verify:worker-contracts:ts
pnpm verify:worker-contracts:go
pnpm verify:worker-contracts:db
pnpm exec vitest run src/tests/contracts/runtime-environment-contract.test.ts src/tests/unit/persist-generated-image.test.ts
```

- 仓库内验证用 disposable PostgreSQL + 模拟 S3；真实 S3/CDN 读写与生产回填演练需用户授权，验证记录单独标注。
- 必测断言：显式数据库存图覆盖两种生产判定、解码后原始字节/MIME/B64/空 storageKey；上游 URL 下载后持久化；S3 优先与默认生产拒绝；Node 参考图在旧回退关闭时仍可存图；manifest 与两个 Go loader、Node 默认值和无效布尔值一致。
- app/Worker health 或 ready 返回 200 不能代替一次存图验证；生产生成验证与本地/模拟验证分开记录，不自动重发已 handoff 的失败任务。

## 7. 使用示例

- Good：自建生产部署显式设置 `ENABLE_DATABASE_IMAGE_STORAGE=true`，沿用完整 data URL、既有成功写回与历史读取格式。
- Base：未设置新开关时保留既有 S3 和非生产回退行为。
- Bad：仅设置 `ENABLE_LOCAL_IMAGE_FALLBACK=true` 就宣称生产生成图片可保存，或修改生产判定绕开存储选择。

```dotenv
# Wrong：仅旧回退开关不足以启用无 S3 的生产生成结果存图。
NODE_ENV=production
ENABLE_LOCAL_IMAGE_FALLBACK=true
ENABLE_DATABASE_IMAGE_STORAGE=false

# Correct：直接选择数据库存图，真实生产模式与 APP_URL 保持原配置。
ENABLE_DATABASE_IMAGE_STORAGE=true
```
