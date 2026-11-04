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

### Node.js 安全更新

Dockerfile、生产 Compose 与 E2E Compose 的默认 Node 基础镜像统一固定为
`node:24.22.1-alpine`，包含 2026-10-21 的 Node.js 安全修复。自定义
`NODE_BASE_IMAGE` / `E2E_NODE_BASE_IMAGE` 时，须使用同分支中包含这些修复的版本。
已运行容器不会随基础镜像标签自动更新；更新时须重新拉取基础镜像、重建应用镜像，
核对候选镜像中的 `node --version` 后再替换应用容器。保留旧镜像作为回滚点，
上线后验证 `/api/healthz`、`/api/readyz` 及实际登录、生成流程。

本次运行时修补应使用当前已部署的应用源码和锁文件，避免夹带未发布代码或新迁移。
只升级宿主机 Node 或只重启旧容器不能修补容器中的 Node；Go Worker 无需因本次
Node.js 公告更换运行时。

## 2. 两种运行拓扑

### 预构建镜像与后续更新

镜像发布附加在现有 `verify` 工作流中，仅 `0401lucky/narra-image` 的 main push 且
三个验证 job 全部成功时运行。PR、fork、失败或跳过验证都不能发布。构建目标是
`linux/amd64`，沿用当前 Dockerfile/runtime；GitHub job token 仅在发布 job 具有
packages write 权限，不需要维护 Docker Hub/PAT secret。

| 镜像 | 用途 |
| --- | --- |
| `ghcr.io/0401lucky/narra-image-app` | Next.js、Embedded Worker、迁移和运维二进制 |
| `ghcr.io/0401lucky/narra-image-worker` | Dedicated Go Worker 和运维二进制 |

每次成功发布给出 `sha-<40位完整提交号>` 与两份 `@sha256:...` 内容地址。已存在且身份
正确的 SHA 镜像会在重跑时复用，不覆盖其 digest。`latest` 只在两个固定镜像及匿名
访问都验证后更新，并在更新前检查 main 仍指向本次提交。两个仓库的 alias 更新不是
事务：中途网络故障会标红并留下部分状态，修复后重跑即可；部署不要单独拉两个 latest。
选择同一成功摘要中的固定 SHA 配对，或直接使用两份 digest。

#### 首次公开发布

GHCR 首次创建的 package 默认可能是 Private，即使源码仓库公开。两个 SHA 镜像上传
后，工作流会以不带 GitHub 凭据的 registry token 检查匿名访问；私有/不可访问时停止
latest promotion，不能把登录后的 push 成功当作公开发布成功。

维护者打开以下包的 Package settings，检查仓库访问授权并执行
`Change visibility > Public`，然后在对应 Actions run 选择 `Re-run failed jobs`。
已有 SHA 镜像保留，重跑不重写其 digest。不需要把 PAT 放进仓库。

- https://github.com/users/0401lucky/packages/container/narra-image-app/settings
- https://github.com/users/0401lucky/packages/container/narra-image-worker/settings

首次 registry 权限/网络错误应按日志明确处理；不能把 401/403 或超时当成镜像不存在，
也不能为通过发布而绕过验证或删除旧镜像。公开包允许无登录拉取。

#### Dedicated 镜像部署

使用 Docker Compose v2.24.4+。保留原部署目录、Compose project name 与 `.env` 的
真实运行配置，不要复制一个新的 project name 导致另建数据库卷；首次部署先按第1节
配置秘密及完整 DATABASE_URL。只需配套的两个 Compose 文件，不需要源码构建上下文。
从成功发布的 Actions 摘要复制两份镜像身份，加入现有环境配置，例如：

```dotenv
APP_IMAGE=ghcr.io/0401lucky/narra-image-app:sha-<同一40位提交号>
WORKER_IMAGE=ghcr.io/0401lucky/narra-image-worker:sha-<同一40位提交号>
```

也可分别填写摘要中的 `ghcr.io/...@sha256:...`。以下 Bash 函数始终使用镜像 overlay；
它要求两个 selector，缺失时失败，并移除 base 的 build 配置。`config --quiet` 不输出
含密钥的完整配置。

```bash
set -e
dc() { docker compose -f docker-compose.yml -f docker-compose.images.yml "$@"; }
dc config --quiet
dc pull migrate worker app
```

首次安装还需显式 `dc pull db`，随后 `dc up -d --no-build --pull never --wait db`。
后续更新不要顺带升级数据库镜像。开始更新前完成数据库及原图存储备份，记录当前
App/Worker digest 和当前环境/Compose 版本，确认备份可恢复，然后按顺序执行：

```bash
# stop honors the existing graceful shutdown periods; no volume is removed.
dc stop app worker
dc up --no-build --pull never --no-deps --force-recreate \
  --exit-code-from migrate --abort-on-container-exit migrate
# Only continue after the migration command exits successfully.
dc up -d --no-build --pull never --no-deps --wait worker
dc up -d --no-build --pull never --no-deps --wait app
dc ps
```

迁移失败必须停下，不启动新旧混合版本，不自动 baseline/repair/seed，不删除数据库卷。
启动后检查 `/api/healthz`、`/api/readyz`、实际登录与生成流程；仅镜像构建成功不等于
生产验收。不要把 `latest` 的变化交给后台 watcher 自动更新运行容器。

#### 镜像回滚

保留上一份配套 digest。回滚前先停止接收新流量，在当前版本容器仍可运行时执行：

```bash
dc exec -T worker /app/narra-rollback-preflight
```

只有退出0且完成第7节的安全核对才可以将两个 selector 一起切到旧版本并重建服务；
新旧 schema 必须兼容。固定镜像版本不会回退数据库 schema，迁移造成的不可逆变更不能
靠拉旧镜像修复。保留 database volume 和 additive schema，不使用 `down --volumes`。
若预检失败或当前容器不可用，先人工排查，不用旧二进制强行绕过预检。

Embedded/Zeabur 只需选用固定版本的完整 App 镜像，并保持下一节的运行配置；平台仍由
维护者显式更新，不增加 SSH、自动部署或生产数据库操作。

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
