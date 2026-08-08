# 媒体持久化契约

## 1. 适用范围与触发条件

- 适用于生成结果媒体（`GenerationImage` / `GeneratedVideo`）的持久化、存储形态标记、失败语义与历史回填。
- 修改 `worker/internal/worker/storage.go`、`video.go`、`generation.go`、`worker.go` 的媒体写入路径、`GenerationImage`/`GeneratedVideo` 的存储相关列、`contracts/generation/v1/scenarios/media.json` 媒体字段，或 `worker/cmd/backfill-media` 时，必须先读本规范。
- 本规范不授权连接真实 S3/R2、生产批量回填或 CDN 变更；真实环境验证需用户授权并单独记录。

## 2. 存储策略

- 生产环境（`NODE_ENV=production` 或 `APP_URL` 非 loopback 显式值）强制配置对象存储（`S3_BUCKET + S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY`）。
- 图片：
  - 有对象存储：`PersistImage`/`PersistImageFromURL` 存 S3，返回公开 URL。
  - 无对象存储：仅非生产且显式 `ENABLE_LOCAL_IMAGE_FALLBACK=true` 时才允许 data URL fallback；生产即使显式开启也拒绝并返回明确错误，禁止大 base64 进数据库。
- 视频：
  - 有对象存储：`buildVideoResult` 下载上游视频转存 S3，返回 S3 URL。
  - 无对象存储：直接以 `RESULT_PERSIST_FAILED` 失败并给出明确错误，不得回退短期上游 URL。
- 提示词库封面/预览图保持上游 URL，不转存 S3（不在媒体持久化范围内）。

## 3. 存储形态元数据

- `GenerationImage`/`GeneratedVideo` 保存 `mediaStorage` 与 `storageKey`（均可空）：
  - `mediaStorage`：`B64`（data URL fallback）| `S3`（对象存储）| `NULL`（legacy 行）。
  - `storageKey`：S3 object key，用于审计、回填和 CDN 刷新；非 S3 行为 NULL。
- 写入者（Go worker）在 Persist 成功后带出 `(url, mediaStorage, storageKey)` 并随 INSERT 落库；旧写入者不传字段仍可插入（additive）。
- legacy 行判定（用于展示/回填扫描，不迁移数据）：`data:` 前缀 → B64；其余 http(s) URL 无元数据时保持 `NULL`，不臆断来源。

## 4. 失败语义

- `ResultPersistError` 保持终态失败（handoff 已发生，不得盲目重试上游）；任务走 `RESULT_PERSIST_FAILED`，用户可新建任务重试。
- 存储瞬时故障不做自动重试，以终态失败 + 回填/重跑补偿；运维通过 attempt ledger 的 `providerRequestId` 协调。

## 5. 历史兼容与回填

- 历史 `GenerationImage.url` / `GeneratedVideo.url`（data URL / S3 / 上游）保持可读，前端 URL 展示契约不变。
- 回填工具 `worker/cmd/backfill-media`：仅处理 `mediaStorage IS NULL` 的行，转存 S3 后在事务内更新 `url`+`mediaStorage`+`storageKey`；`--dry-run`/`--limit`/`--include-http`；幂等（已处理行跳过）。

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
