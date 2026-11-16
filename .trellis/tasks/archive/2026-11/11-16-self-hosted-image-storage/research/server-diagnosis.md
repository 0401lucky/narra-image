# yunyou .22 Read-only Diagnosis

2026-11-16，通过已有 SSH alias `yunyou` 连接 `64.83.25.22`。本记录不含密钥、DSN、用户提示词或原始上游正文。

- 目录 `/home/ubuntu/apps/narra` 仅有 Compose/.env 与 2026-11-15 的原 S3 配置备份；应用源码位于发布镜像，本地仓库与镜像 source revision 一致。
- `narra-app`：固定 app digest `53417173c98e66c2f8d0033a6501f305e8807b39c063f3efcd3f122eabf17be1`，source revision `a8c2bc9b3d65fc6970fc895f109aec9728b10290`；embedded Worker。
- `narra-postgres`：`postgres:18`，命名卷 `narra-pg` 挂载 `/var/lib/postgresql`。应用自身无文件存储挂载。
- `NODE_ENV=production`，`ENABLE_LOCAL_IMAGE_FALLBACK=true`，`ENABLE_EMBEDDED_WORKER=true`，`CANVAS_ENABLED=false`，`GATEWAY_ENABLED=true`；S3 的 endpoint/bucket/access-key/secret 全部缺失。
- 定向提取最近 24 小时日志（最多 2000 行）找到 24 条相关失败日志行，不能将日志行数直接等同独立任务数。最新原因是 `RESULT_PERSIST_FAILED` / `生成结果写回存储失败：生产环境禁止 data URL 图片存储，请配置对象存储（S3/R2）`。
- `/api/healthz` 与 `/api/readyz` 均为 200；存储政策不在当前普通生成就绪检测中。
- `worker/internal/worker/storage.go:127` 的显式 production 拒绝分支与 `storage_test.go:68`、`:79` 的测试解释当前行为。
- 已运行并通过：`go -C worker test -count=1 -timeout=50s -run 'TestPersistImageProductionRejectsFallback|TestPersistImageDevelopmentFallbackIsB64|TestPersistImageWithoutStorageAndWithoutFallbackFails' ./internal/worker`。
- 用户先确认创建 Trellis 任务，随后明确选择“是，直接存入当前数据库”。

实施时注意：原媒体规范禁止生产 data URL；这是本次已确定需求要扩展的契约，而不是应保留为全局限制的产品决策。保持未显式启用时原策略，并由主会话在完成阶段更新规范。
