# Database Image Storage Design

## Boundary and Data Flow

保留原生成链路：上游图片 bytes / URL → Go `PersistImage` / `PersistImageFromURL` → `PersistedMedia` → 现有成功写回事务 → `GenerationImage` → 原图片展示与下载。

新增共享布尔环境变量 `ENABLE_DATABASE_IMAGE_STORAGE`，默认 `false`。Node 在 `src/lib/env.ts` 解析，Go 在 `worker/internal/worker/config.go` 的运行与存储 loader 解析；`contracts/runtime/v1/environment.json` 是配置契约事实源。

## Storage Selection

1. 已配置 S3 时，继续走现有 S3 分支。
2. 无 S3 且 `ENABLE_DATABASE_IMAGE_STORAGE=true` 时，允许生产环境返回完整 data URL，`mediaStorage=B64`、`storageKey` 空。
3. 未启用数据库存图时，`ENABLE_LOCAL_IMAGE_FALLBACK` 继续只允许非生产回退。原 production 拒绝与缺配置失败语义保留。

复用同一 data URL 编码路径，不复制生成或写回逻辑。不修改视频、Canvas、退款、handoff 或任务重试策略。

现有 `/v1/images/edits` 参考图 envelope 只允许 HTTP(S)，并限制请求体 1 MiB；不因启用数据库图片结果存储就放宽该输入协议。Web 文件参考图经 Node 上传与数据库队列进入 Go，可继续读取 B64；`/v1` 参考图仍受独立限制。

## Compatibility

- 无 schema 迁移：已有 URL 与媒体元数据列支持 B64。
- 不改变默认生产行为，不自动迁移历史媒体。
- 保留 `NODE_ENV=production` 与真实 `APP_URL`，通过存储配置选择实现需求。
- Node/Go/Compose/文档同步新变量；运行时 manifest 的配置审计与自动隔离环境必须兼容默认值。

## Rollout and Rollback

- 用户已授权先推送 GitHub 再部署；等待对应 CI/镜像发布成功后，固定到发布 app digest，上线仍只变更 app image 与数据库存图开关。
- 当前生产镜像 digest 和 Compose/.env 状态记录在只读诊断中；生产文件修改前保留有权限限制的备份。
- 不写入旧任务、用户余额或媒体记录。助手只完成就绪检查，真实生成验收由用户自行执行。
- 回滚恢复先前镜像与配置，保留 PostgreSQL volume；新增 B64 数据属于既有读取格式，旧版本可读取，但旧版本恢复后无法继续无 S3 的生产存图。
