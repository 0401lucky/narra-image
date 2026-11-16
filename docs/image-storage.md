# 图片持久化、历史登记与迁移

图片可持久化到同宿主机 LOCAL 卷或 S3/R2；数据库保存身份、副本、引用和用量。
本手册供维护者明确执行操作，不表示真实服务器、数据库或 R2 已完成迁移。
视频、视频专用封面、提示词库第三方图片和数据库无法识别的桶对象不在本工具范围。

## 配置与上线顺序

使用同一提交的 App/Worker 镜像，保留数据库、图片卷及原 Compose project name。
当前图片 storage/reader/executor 和 Canvas storage/GC 修订均为 **3**；场景 wire 仍为1。
部署入口和固定镜像选择见 [生产发布手册](production-operations.md)。

1. 完成数据库和媒体备份。停止新流量和上传，停止旧 App、Worker、backfill、迁移及 GC。
   等待 `worker_drained`，核对旧在途 PUT/DELETE 与 lease/token；仅等待租约到期不能撤销已经发出的 IO。
2. 执行匹配版本的 `migrate deploy`。这次为追加迁移，不修改旧迁移或业务图片 URL。
   新旧 Worker/GC 不能混跑；schema 探针不能收回旧进程手中已经领取的删除 key。
3. 准备下面的持久卷和访问身份，显式初始化一次。先保持破坏性清理停用。
4. 配置匹配的 App/Worker，启用 managed 图片；检查完整 readiness、生成、普通参考上传和 Canvas 原图。
   然后单独执行历史 dry-run，审核来源绑定，再执行登记/复制。

```dotenv
IMAGE_STORAGE_MANAGED_ENABLED=true
IMAGE_STORAGE_BACKEND=local
IMAGE_STORAGE_PATH=/data/images
IMAGE_STORAGE_VOLUME_ID=<为此物理卷生成一次的小写UUID>
```

生产 `APP_URL` 必须是显式、非 loopback 的站点 HTTP(S) origin，不能包含凭据、query 或 fragment。
源 S3 凭据仍由已有 `S3_*` 环境提供；manifest 不包含密钥或本地路径。
迁移期间保留旧 S3 读取权限，视频仍需原 S3 配置。默认后端只影响新写入，已有图片按清单中的位置读取。
`IMAGE_STORAGE_MANAGED_ENABLED=false` 停止新的受管理写入；已经登记的图片仍按逻辑身份读取，
页面和应用内旧 URL 继续解析当前副本，因此不能据此移除原图片卷或读取所需的配置。

### Dedicated Compose

仓库 Compose 已把 `image_data` 同时挂到 App 和 Worker 的 `IMAGE_STORAGE_PATH`。
使用镜像部署时，以下 `dc` 与发布手册保持一致：

```bash
dc() { docker compose -f docker-compose.yml -f docker-compose.images.yml "$@"; }
# 原服务已停止、目标目录为空、运行环境已显式配置 local/managed/UUID 后执行一次。
dc run --rm --no-deps worker /app/narra-worker --init-image-volume
# migrate 成功后，先 Worker 再 App；不要用 up --build 隐式换版本。
dc up -d --no-build --pull never --no-deps --wait worker
dc up -d --no-build --pull never --no-deps --wait app
```

App 与 Worker 必须在同一宿主机使用同一物理卷和 UUID；相同路径字符串不证明同卷。
两个镜像默认使用相同 UID，图片为0600文件。自行改 UID 时先验证两端都可读写并创建硬链接。
重建服务保留卷与 UUID；不要用 `down --volumes`、临时文件系统或容器可写层保存图片。

### Embedded / Zeabur

使用完整 App 镜像，挂载持久卷到 `/data/images`，显式设置上述四项变量，保持
`ENABLE_EMBEDDED_WORKER=true`、`WORKER_RUNTIME_MODE=embedded` 和 loopback Worker HTTP。
首次初始化在平台上用挂载相同卷、相同 UID 和环境的临时命令
`/app/narra-worker --init-image-volume` 执行，成功后恢复 `node scripts/start-prod.mjs`。
初始化命令只准备空卷；它不连接数据库、不启动 Worker/Next，也不需要站点已可访问。
已有标记或非空目录失败时先核对原卷，不能清目录重试。

supervisor 顺序为数据库 → migration → Worker live/ready → Next。
Worker 的卷、schema、维护循环检查不请求 Next 媒体路由，因此初始化和 readiness 没有循环依赖。
普通启动只验证标记及可写能力，不创建卷身份。平台重建或升级后应再次读取一张旧图片确认同卷。

## 默认只读盘点

两个镜像均包含 `/app/narra-image-history`。CLI 默认 dry-run，`--dry-run` 可显式写出；
`--apply --dry-run` 冲突。dry-run 的数据库事务只读，只执行有界源核实和现有卷标记检查，
不登记 location、建 checkpoint、申请额度、写探针、PUT 或 DELETE。
报告的 `targetWritableVerified=false` 表示没有验证目标写权限。

先查看数据库可识别的主体，不提供猜测的来源映射：

```bash
dc exec -T worker /app/narra-image-history --bindings - --limit 100 <<'JSON'
{"schemaVersion":1,"locations":[],"bindings":[]}
JSON
```

Embedded 在 App 容器终端调用相同二进制。`--scope` 为 `ALL`、`GENERATED`、
`CANVAS_IMPORT` 或 `REFERENCE_URL`；`--limit` 为1–1000，默认100。
后续只读分页将报告的 `plan.nextCursor` 和 `plan.upperBound` 分别传入 `--cursor` 和
`--upper-bound`，避免扫描期间新增记录改变范围。
报告只覆盖数据库仍可识别的历史记录；早已删除且未保存输入证据的旧记录无法凭空恢复。
`DATA_URL` 属于需要新 PUT 的旧 backfill 流程，不是已有物理对象登记。

为审核过的每个主体填写 `bindings.json`：

```json
{
  "schemaVersion": 1,
  "locations": [
    {"id":"s3-v1:<原始tuple的64位SHA256>","provider":"S3","endpoint":"https://<account-id>.r2.cloudflarestorage.com","region":"auto","bucket":"<原bucket>","publicBaseUrl":"https://<原公开域名>"},
    {"id":"local-v1:<卷UUID>","provider":"LOCAL","volumeId":"<同一卷UUID>"}
  ],
  "bindings": [
    {"subjectKind":"GENERATED","subjectId":"<原GenerationImage.id>","expectedSnapshotHash":"<本次盘点snapshotHash>","locationId":"s3-v1:<同上SHA256>","key":"<已核实原key>","ownerId":"<原所有者>"}
  ]
}
```

S3 ID 为规范化 `[endpoint origin,region,bucket]` 无空白 UTF-8 JSON 的 SHA-256，加 `s3-v1:`；
CLI 验证 ID 与完整 tuple 相符。Canvas 使用数据库原始 tuple、上传身份与 owner。
仅有 `storageKey`、URL 前缀、当前 S3 默认配置或消费者账户都不足以证明源归属。
普通参考的 `subjectId` 是**精确原 URL** 的 SHA-256，原 owner 要从上传事实人工确认；
不能从脱敏后的 URL 重算身份。绑定后还需实际验证确切 key 的完整大小、SHA256 和无版本状态。
共享一组 S3 凭据必须确实有权访问 manifest 内所有 S3 位置；不同凭据的范围分别执行。

```bash
dc exec -T worker /app/narra-image-history --bindings - \
  --target-location 'local-v1:<卷UUID>' --limit 100 < bindings.json
```

## 显式登记、复制与恢复

`--apply --request-id <新UUID> --actor-id <运维审计身份>` 才创建持久任务。
不传 `--target-location` 只登记已经存在的源；传入目标则登记、预留新副本、复制、完整读回校验后切换。
`request-id` 固定 intent，改变绑定、scope、目标或退休政策必须用新的 request-id。

```bash
dc exec -T worker /app/narra-image-history --bindings - --apply \
  --request-id '<新请求UUID>' --actor-id '<审计身份>' \
  --target-location 'local-v1:<卷UUID>' --limit 100 < bindings.json
# 退出/中断后使用报告 progress.job.id；不要为同一未决副本换 key 或伪造 NOT_WRITTEN。
dc exec -T worker /app/narra-image-history --bindings - --apply \
  --job-id '<progress.job.id>' --actor-id '<原审计身份>' --limit 100 < bindings.json
# 同一任务只读查看（不传 --apply）。
dc exec -T worker /app/narra-image-history --bindings - --job-id '<progress.job.id>' < bindings.json
```

每次 `--limit` 限制本轮工作量；继续原 job 可推进固定扫描范围和 checkpoint。
可加 `--item-id <条目UUID>` 定位原 job 的一个阻塞条目。默认总截止30分钟，`--timeout` 可缩短；
单对象 IO 有30秒上限。退出0为本次完整完成，2为仍有阻塞/未完成工作，1为命令失败；
结合报告和原 job 状态判断，不把退出2当成已迁移全部历史。

旧 Canvas 导入的首次接管还要求兼容 GC 不再持有租约。即使新 Worker 使用 LOCAL、没有可回收原图，
启用 Canvas 的调度器仍会续期这个90秒租约，因此在 dry-run/来源审核后再次停止 App 和全部 Worker，
确认 `worker_drained`，等待最后一次租约自然到期。不能修改数据库时间或租约字段来跳过检查。
在同卷、同配置的临时 CLI 容器中执行已审核的任务，避免启动 Worker/GC：

```bash
dc stop app worker
# 确认全部旧执行者已完成 drain，再等待原 GC 租约自然到期（最后续期后最多90秒）。
dc run --rm --no-deps -T worker /app/narra-image-history --bindings - --apply \
  --scope CANVAS_IMPORT --request-id '<新请求UUID>' --actor-id '<审计身份>' \
  --target-location 'local-v1:<卷UUID>' --limit 100 < bindings.json
dc up -d --no-build --pull never --no-deps --wait worker
dc up -d --no-build --pull never --no-deps --wait app
```

Embedded 同样停止整个 supervisor，再使用同镜像、同卷和配置的独立 CLI 命令完成接管，之后恢复服务。
默认保留源的复制不需要 App 在线。如果首次 intent 已明确添加 `--retire-source`，停站期间可先完成复制和切换，
随后因公开读取证明不可用停在 `IMAGE_READER_INCOMPATIBLE`，源仍保留且计量。
恢复 App/Worker 后以原 `--job-id` 继续，复用同一目标副本并完成公开读取证明；不能换任务或修改原退休意图来重试。

目标 READY/校验之前保留源作为读取位置。已 READY 的目标重放不会再 PUT；
未知 PUT、错内容、版本异常、活动删除、遗留 `.writing` 或原 writer 未确认终止的情况保留身份、保护和计量。
单次 HEAD missing、租约过期或客户端超时不能证明文件永远不会出现。
这类条目需先排查原执行者和存储证据，再重查原 item；工具不按文件年龄清理 staging，也不覆盖已有 key。

### 容量与源退休

默认全站上限为 **5,000,000,000字节**。已存在对象登记按实际量入账，即使历史真实用量已超限；
后续新写入/复制仍检查 `usedBytes + reservedBytes`。一张8MiB图片同时在S3和LOCAL时全站计16MiB；
Canvas 账户仍计一份逻辑原图。容量不足先通过管理员页面预览/清理允许对象或明确调整额度，不能免计复制。

默认完成于 `SOURCE_RETAINED`。计划需要删除源时，在**首次创建该 COPY 任务**时显式添加
`--retire-source`。只有经过内容校验的同图替代副本已经活动、旧链接读取兼容且没有在途使用，
才排入唯一维护执行器的 `SOURCE_RETIREMENT`。CLI 本身不删除源。
管理员还需在图片存储页面启用清理策略；策略关闭时返回 `IMAGE_POLICY_DISABLED`，源和计量均保留，启用后用原 `--job-id` 恢复即可。源退休不要求打开定时清理或容量自动清理。
显式源退休还要求 CLI 能访问任务冻结的 `APP_URL/media/images/<token>`，通过真实应用读取目标完整字节，
校验大小和 SHA256 且不接受重定向；站点不可达或读回不匹配时继续保留源。
这项公开读取证明只在显式退休时执行，普通启动、readiness 和默认保留源复制不依赖站点回环。
任务中的 `RETIREMENT_REQUESTED` 仅表示已排队；维护任务确认 `DELETED/MISSING` 后才实际减源字节。
失败/UNKNOWN 保留全站计量，重试复用原物理记录并在再次领取时取得新的删除 token；旧 token 不能完成新一轮删除。
逻辑图片、永久任务根和 Canvas 账户量保留。
已完成的保留源任务不能通过修改原 intent 变成删源任务；后续操作需重新审核并建立新的明确任务。

应用内精确旧 URL 通过 alias 读取当前副本；生成图片 ID、原 URL/metadata、Canvas 原 tuple/上传ID、
保存场景与冻结任务输入不改写。**站外原 R2 URL 在删源后不保证继续可用**，有外部分享需求时保留源。
管理页面展示真实登记量，未核实历史单列；不能以“复制成功”宣称已释放R2空间。

## 回滚和验证

先用当前二进制 `/app/narra-rollback-preflight` 检查，参见[稳定退出码](production-operations.md#7-回滚预检)。
revision3 的空 schema、LOCAL 对象、未决写入/删除/迁移及历史保护都会阻止旧 Worker 回滚。
保留 additive schema 和全部卷。恢复同版本的 S3 新写入配置不等于移动已有 LOCAL 图片；
仍须保留原卷。切回读取位置必须验证保留副本，不直接 UPDATE activeObjectId 或 Canvas tuple。
已确认删除的源没有恢复承诺。

`pnpm verify:e2e` 默认包含 embedded/dedicated 的实际历史迁移场景：随机 owner-labelled PostgreSQL、
模拟 S3、独立 LOCAL 卷、真实生成/上传/导入、default dry-run、CLI checkpoint、源保留/失败退休/确认退休、
完整字节读回、容器重建与错卷/能力拒绝。测试只删本轮精确核实的测试资源，不读取开发 `.env`。
这些隔离证据不代替真实 R2、服务器磁盘容量或生产上线验收。
