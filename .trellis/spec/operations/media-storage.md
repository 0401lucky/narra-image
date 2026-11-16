# 媒体持久化契约

## 1. 适用范围与触发条件

- 适用于生成结果媒体（`GenerationImage` / `GeneratedVideo`）的持久化、存储形态标记、失败语义与历史回填。
- 修改 `worker/internal/worker/storage.go`、`video.go`、`generation.go`、`worker.go` 的媒体写入路径、`GenerationImage`/`GeneratedVideo` 的存储相关列、`contracts/generation/v1/scenarios/media.json` 媒体字段，或 `worker/cmd/backfill-media` 时，必须先读本规范。
- 本规范不授权连接真实 S3/R2、生产批量回填或 CDN 变更；真实环境验证需用户授权并单独记录。

## 2. 存储策略

- 图片在 managed 模式下可使用 LOCAL 持久卷，具体登记/预留/读取与环境契约见 [Image Storage](./image-storage.md)。未启用 managed 的生产图片与所有视频持久化仍要求对象存储（`S3_BUCKET + S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY`）。
- 图片：
  - managed 启用：Node/Go 先申请统一额度、登记具体对象，再按 LOCAL/S3 写入，返回稳定媒体 token URL；`IMAGE_STORAGE_BACKEND=local` 要求 shared 卷和有效身份。
  - 有对象存储：`PersistImage`/`PersistImageFromURL` 存 S3，返回公开 URL。
  - 无对象存储：仅非生产且显式 `ENABLE_LOCAL_IMAGE_FALLBACK=true` 时才允许 data URL fallback；生产即使显式开启也拒绝并返回明确错误，禁止大 base64 进数据库。
- 视频：
  - 有对象存储：`buildVideoResult` 下载上游视频转存 S3，返回 S3 URL。
  - 无对象存储：直接以 `RESULT_PERSIST_FAILED` 失败并给出明确错误，不得回退短期上游 URL。
- 提示词库封面/预览图保持上游 URL，不转存 S3（不在媒体持久化范围内）。

## 3. 存储形态元数据

- `GenerationImage`/`GeneratedVideo` 保存 `mediaStorage` 与 `storageKey`（均可空）：
  - `mediaStorage`：`B64`（data URL fallback）| `S3`（对象存储）| `NULL`（legacy 行）；图片增加 `LOCAL`，视频保持原值域。
  - `storageKey`：不可变原始写入 key；managed 图片的实际当前位置以 `mediaAssetId → ImageAsset.activeObjectId → ImageObject/ImageStorageLocation` 为准，不能由当前默认后端推导。
  - `GenerationImage.mediaAssetId` 可空且唯一，managed 写入关联逻辑图片；物理清单不随业务 cascade 消失。
- 写入者（Go worker）在 Persist 成功后带出 `(url, mediaStorage, storageKey)` 并随 INSERT 落库；旧写入者不传字段仍可插入（additive）。
- legacy 行判定（用于展示/回填扫描，不迁移数据）：`data:` 前缀 → B64；其余 http(s) URL 无元数据时保持 `NULL`，不臆断来源。

## 4. 失败语义

- `ResultPersistError` 保持 `RESULT_PERSIST_FAILED`（handoff 已发生，不得盲目重试上游）；v1 UNKNOWN 不自动退款，v0 保持原有兼容退款。图片容量不足属于 provider 前的确定失败，不能误归到 UNKNOWN。
- 存储瞬时故障不做自动重试，以终态失败 + 回填/重跑补偿；运维通过 attempt ledger 的 `providerRequestId` 协调。

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
```

- 仓库内验证用 disposable PostgreSQL + 模拟 S3；真实 S3/CDN 读写与生产回填演练需用户授权，验证记录单独标注。
