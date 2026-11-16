# yunyou .22 Rollout Plan

最终授权：用户要求先推送 GitHub 再部署，真实生图由用户自行验证。以下本地候选用于已有检查证据；实际部署改用该工作提交的已发布 GHCR app digest。

## Candidate

- 应用目录：`/home/ubuntu/apps/narra`，Compose project `narra`，服务 `narra`，容器 `narra-app`。
- 候选本地镜像：`narra-image-app:db-storage-c8d5df6b2894`。正式应用时固定到检查通过的 `build-result.json` 中 `image_id`，避免可变标签漂移。
- 源码快照：`c8d5df6b289416708f5255c5664b6924c1df72dc36cb861cf904c970bdd4c455`。完整 Node 改动、三项 Go 运维/Worker 二进制均包含在候选镜像中；不发布到 registry。
- 当前生产镜像：`sha256:53417173c98e66c2f8d0033a6501f305e8807b39c063f3efcd3f122eabf17be1`。

## Configuration Difference

仅变更应用服务的 `image` 和新增环境变量：

```yaml
services:
  narra:
    image: narra-image-app:db-storage-c8d5df6b2894
    environment:
      ENABLE_DATABASE_IMAGE_STORAGE: "true"
```

其余实际配置保持原值：生产模式、域名、内置渠道、既有旧回退开关、数据库连接、端口与 PostgreSQL volume。无需 schema 迁移。审批前只做 Compose 合并 dry-run，不写生产配置。

## Authorized Rollout Sequence

1. 审批后重新核对候选 image ID/平台/来源哈希、旧应用身份及 Compose/.env 哈希，运行当前运维二进制的只读 rollback preflight。
2. 在服务器保存权限为 0600 的原 Compose 备份；仅定向修改 image 与新增开关，原 `.env` 无需改动。先解析并比较新旧 Compose，确认只有上述差异。
3. 有界 graceful stop 应用（45 秒），以固定镜像、`--pull=never --no-build --no-deps` 重建应用。数据库服务不重启，不删除 volume。
4. 检查 app `/api/healthz`、`/api/readyz` 及 embedded Worker ready，确认环境开关解析为 true、三项二进制身份正确。
5. 真实生成由用户自行验收。助手只确认 app/Worker 就绪、部署镜像身份与数据库存图开关，不创建测试账户、会话或付费生图任务。
6. 就绪失败时，先停止新应用、恢复本次原配置备份，再用保留的旧镜像启动并复验。回滚不改数据库；旧版本能读取 B64，但恢复旧 Worker 后将重新具有无 S3 生产存图限制。

## Limits

- 本次恢复普通图片生成结果保存与 Web 文件参考图的数据库队列路径。
- 视频、Canvas 原图及历史失败任务恢复不在范围内。现有 `/v1/images/edits` 网关参考图输入仅允许 HTTP(S) 且 envelope 限制 1 MiB，数据库 data URL 不解除该限制。
- 当前候选是本地修复镜像；正式 GHCR 发布须另走仓库的 CI/发布门禁与用户发布授权。
