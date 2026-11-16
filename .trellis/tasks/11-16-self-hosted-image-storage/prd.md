# Fix self-hosted image persistence without S3/R2

## Goal

恢复 yunyou（64.83.25.22）上 narra 的图片生成与保存：用户已放弃 S3/R2，并于 2026-11-16 明确选择将生成图片直接保存到当前 PostgreSQL 数据库。

## Background

- 服务器部署目录：`/home/ubuntu/apps/narra`。应用为 `narra-app`，数据库为 `narra-postgres`（PostgreSQL 18）；应用使用 embedded Go Worker。
- 应用镜像固定到 `ghcr.io/0401lucky/narra-image-app@sha256:53417173c98e66c2f8d0033a6501f305e8807b39c063f3efcd3f122eabf17be1`，源码 revision 为 `a8c2bc9b3d65fc6970fc895f109aec9728b10290`。
- 当前 `NODE_ENV=production`、`ENABLE_LOCAL_IMAGE_FALLBACK=true`，四项 S3 配置均未设置。Go 的 `PersistImage` 在 production 分支仍拒绝 data URL（`worker/internal/worker/storage.go:127`），因此上游已出图后发生 `RESULT_PERSIST_FAILED`。
- 已确认 `/api/healthz`、`/api/readyz` 都返回 200，但这不能证明图片保存可用。定向 Go 测试已通过，证明当前的生产拒绝行为是既有契约。

## Requirements

- R1：支持明确选择数据库存图的生产部署，无需配置 S3/R2；继续使用现有数据库与生成流程。
- R2：复用现有 `GenerationImage.url` / `mediaStorage=B64` 形态，保存完整图片并兼容历史展示、下载和后续参考图读取；无需 schema 迁移。
- R3：使用默认关闭的显式数据库存图选项。未选择数据库存图的生产部署继续遵守原来的存储要求；已有 S3 配置保留现有优先级。
- R4：同步共享环境契约、Node/Go 配置 loader、Compose 与配置文档，并进行针对性测试。
- R5：按用户最终授权，先提交并推送 GitHub，再使用对应发布镜像部署 .22；保留原镜像及配置回滚信息，不修改数据库已有记录。助手只验证部署/就绪，真实生图由用户自行验收。

## Acceptance Criteria

- [x] AC1（R1/R2）：生产环境、无 S3、显式选择数据库存图时，base64 结果和上游 URL 结果都可生成完整的可读 data URL，并标记 `B64`。
- [x] AC2（R3）：未显式选择数据库存图时，现有生产拒绝回退测试保持通过；已配置 S3 的图片仍按原方式保存。
- [x] AC3（R2/R4）：图片字节、MIME、存储元数据和配置默认值通过定向测试；环境 manifest 与 Node/Go loader、文档一致；相关契约检查、lint、类型检查与 Go 构建通过。
- [ ] AC4（R5）：修复提交已推送 GitHub，对应发布镜像在 .22 部署且 app/Worker 就绪，数据库存图开关显式启用；真实生图由用户自行验收，不由助手创建付费测试任务。

## Key Decisions and Limits

- 用户确认沿用当前 PostgreSQL 直接存图，不新增 SQLite、外部对象存储或文件服务器。
- 此次只覆盖普通生成图片。视频、Canvas 原图导入/GC 与历史失败任务恢复不属于本次范围。
- 代码审核确认现有 `/v1/images/edits` 网关参考图输入仅支持 HTTP(S) URL，且 envelope 限制 1 MiB；本次结果存储修复不扩展该协议。Web 文件参考图入队可沿用 B64，但不承诺 `/v1` 参考图在无 S3 的数据库模式下可用。
- data URL 的 base64 编码会增加数据库与备份体积；本次使用项目已有兼容格式，暂不引入二进制媒体表或独立媒体 API。
- 2026-11-16 用户明确授权“先推送到 github 再部署”，并要求“验证我自己去验证”；助手不进行真实生图，不自动重发已失败任务。
