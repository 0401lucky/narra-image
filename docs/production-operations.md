# 生产发布、就绪与回滚手册

本文只描述仓库内已经固化的发布边界，不授权连接或修改真实生产数据库。
对非 disposable 数据库执行 baseline、prehistory 或 repair 前，必须先完成备份、
核对目标身份并取得明确操作确认。

## 1. 发布前配置

- 共享和发布关键变量以
  `contracts/runtime/v1/environment.json` 为事实来源。
- 生产环境必须显式设置非 localhost/loopback 的 HTTP(S) `APP_URL`；
  `http://localhost:3000` 默认值只用于 development/test。
- `AUTH_SECRET` 在生产环境必须至少 32 位，且不能使用示例占位值。
- `DATABASE_URL` 必须完整注入。用户名或密码中的 `@ : # ? /` 等字符必须
  百分号编码；禁止通过 Compose 字符串拼接生成连接串。
- contract v1 的 `WORKER_CONTRACTS_V1_ENABLED` 默认保持 `false`。
- Worker 必须显式设置 `WORKER_RUNTIME_MODE=embedded` 或
  `WORKER_RUNTIME_MODE=dedicated`。

示例：密码 `pa@:#?/ss` 应写成 `pa%40%3A%23%3F%2Fss`，不要把完整 DSN
复制到日志、工单或聊天记录中。

## 2. 两种运行拓扑

### Embedded

- `ENABLE_EMBEDDED_WORKER=true`
- `WORKER_RUNTIME_MODE=embedded`
- `WORKER_HTTP_ADDR=127.0.0.1:8081`
- `WORKER_INTERNAL_URL=http://127.0.0.1:8081`

supervisor 的顺序是：数据库可连接、`prisma migrate deploy`、Worker
`/healthz` 可达、Worker `/readyz` ready、最后启动 Next。单次 readyz 请求由
`WORKER_READINESS_TIMEOUT_MS` 控制；总启动等待由
`WORKER_READY_TIMEOUT_MS` 控制。

### Dedicated

- app 设置 `ENABLE_EMBEDDED_WORKER=false`
- Worker 设置 `WORKER_RUNTIME_MODE=dedicated`
- Worker 容器内监听 `WORKER_HTTP_ADDR=:8081`，但不发布公网端口
- app 使用服务发现地址，例如 `WORKER_INTERNAL_URL=http://worker:8081`
- app 保持 `WORKER_READINESS_REQUIRED=true`

多个 dedicated Worker 可以共享服务地址；Next 不依赖 `worker_id` 等扩展字段，
只以 HTTP 200 且 JSON `status=ready` 判断至少一个副本可用。

## 3. 平台探针

- Liveness：`GET /api/healthz`。仅表示 Next 进程可响应，不查询数据库或
  Worker。
- Readiness：`GET /api/readyz`。检查环境配置和数据库；启用 Worker 依赖时，
  再请求内部 Worker `/readyz`。

平台必须把 liveness 和 readiness 分开配置。`CONFIG_INVALID`、
`DATABASE_UNAVAILABLE`、`WORKER_UNAVAILABLE`、`WORKER_NOT_READY` 均应阻止
新流量，但不应把依赖故障误判为进程存活失败。

## 4. 普通 migration

普通发布只执行前向迁移和只读状态校验：

```powershell
node scripts/migrate-deploy.mjs
```

该入口不会自动执行 `db push`、baseline、`migrate resolve` 或手写 repair。
如果历史库缺失迁移历史或存在 failed migration，普通发布应失败，再进入下面的
显式只读检查流程。

## 5. 历史库显式接管

以下命令先生成报告，不修改数据库。报告包含脱敏数据库身份、schema hash、
migration checksum、有效期和 digest。

### 完整连续前缀 baseline

```powershell
node scripts/migrations/baseline.mjs inspect `
  --prefix <从首个 migration 开始的逗号分隔连续前缀> `
  --output baseline-report.json
```

只有在完成备份、人工核对报告并取得明确确认后，才可设置以下一次性 sentinel
与 allowlist，再执行 apply：

```powershell
$env:MIGRATION_BASELINE_APPLY_CONFIRM="APPLY_APPROVED_BASELINE"
$env:MIGRATION_ALLOWED_DATABASE_IDENTITIES="<report.identity.digest>"
node scripts/migrations/baseline.mjs apply `
  --prefix <与报告完全一致的前缀> `
  --report baseline-report.json `
  --digest <report.digest>
```

### 缺失初始 pre-history migration

```powershell
node scripts/migrations/prehistory.mjs inspect --output prehistory-report.json
```

apply 还必须显式 allowlist 报告中的 schema hash：

```powershell
$env:MIGRATION_PREHISTORY_APPLY_CONFIRM="APPLY_APPROVED_PREHISTORY"
$env:MIGRATION_ALLOWED_DATABASE_IDENTITIES="<report.identity.digest>"
$env:MIGRATION_PREHISTORY_ALLOWED_SCHEMA_HASHES="<report.snapshot.schemaHash>"
node scripts/migrations/prehistory.mjs apply `
  --report prehistory-report.json `
  --digest <report.digest>
```

报告默认 15 分钟过期。apply 会重新 inspect；数据库身份、schema、migration
行或 checksum 任一变化都会拒绝执行。

## 6. Failed migration repair

先生成只读报告：

```powershell
node scripts/migrations/repair.mjs inspect --output repair-report.json
```

只有 migration ID、数据库 checksum、本地 checksum、日志 hash 和精确 repair
allowlist 全部匹配时，报告才会给出可执行建议。人工审批后：

```powershell
$env:MIGRATION_REPAIR_APPLY_CONFIRM="APPLY_APPROVED_REPAIR"
$env:MIGRATION_ALLOWED_DATABASE_IDENTITIES="<report.identity.digest>"
$env:MIGRATION_REPAIR_ALLOWED_SCHEMA_HASHES="<report.snapshot.schemaHash>"
node scripts/migrations/repair.mjs apply `
  --migration <精确 migration ID> `
  --report repair-report.json `
  --digest <report.digest>
```

repair 完成后必须再次通过 deploy、migration 状态和 schema diff 校验。不要把
repair 入口放进普通容器启动命令。

## 7. 回滚预检

回滚代码前运行：

```powershell
go -C worker run ./cmd/rollback-preflight
```

稳定退出码：

- `0`：`ROLLBACK_SAFE`
- `2`：`ROLLBACK_UNSAFE`，存在活动 contract v1 任务或未决 handoff
- `3`：配置无效
- `4`：数据库不可用
- `5`：预检查询失败

返回 `ROLLBACK_UNSAFE` 时，不得启动旧 Worker/finalizer。应先停止新 claim，
排空任务或使用兼容终结器；additive schema 不随代码回滚删除。

## 8. 日志与指标

- `/metrics` 只允许容器内网访问；设置 `WORKER_METRICS_TOKEN` 后必须使用
  Bearer token。
- Node 日志脱敏契约位于 `contracts/runtime/v1/redaction.json`，覆盖 DSN、
  Authorization/API Key、provider body 和签名媒体 URL。
- 日志不得输出完整 `DATABASE_URL`、`AUTH_SECRET`、API Key、上游原始正文或
  带签名查询参数的媒体 URL。
