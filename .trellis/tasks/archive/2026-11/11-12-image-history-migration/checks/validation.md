# C3 ops 验证入口

仅 root 在 C1 `isolated.py` 管理的 frozen workspace 中调度；实现/复核代理不运行测试、构建或 Docker。
以下是可复用的验证入口与断言边界；实际通过、失败、输入hash和剩余门禁以 [verification.md](../verification.md) 与 `gates.json` 为准，静态检查不能替代实际回执。

- 早期测试：`canvas-e2e-runner.test.ts`、`canvas-e2e-http-fixture.test.ts`、`canvas-object-store-fixture.test.ts`、`image-history-e2e-safety.test.ts`；`scripts/tests/migration-safety.test.mjs`；Go `cmd/rollback-preflight`。
- H2 定向回归：`image-presentation.test.ts`、`login-cover-presentation.test.ts`、`login-cover-form-projection.test.tsx`；以及 managed-image-storage/route/consumers、external-v1-routes/source-images、proxy-image-route、canvas-runtime-api。覆盖稳定公开 URL、精确历史来源批量投影、不可变输入/封面配置、已清理屏蔽及关闭新写入后仍可读。
- Worker DB wrapper 的 `runRollbackStorageDBTests` 新增：真实 pending history job/item/observation/hold，在没有新 object/reservation 时仍报告；历史库安全查询保留，部分新表/函数 fail closed。
- `verify:migrations` 仍执行完整空库、升级和 Prisma diff；pgx URL 直接执行新 preflight 二进制，空 revision3 schema 返回退出2和完整追加字段。
- 最终 `pnpm verify:e2e` 默认11场景，包含 `image-embedded`、`image-dedicated`。总截止40分钟，图片单场景10分钟，清理独立120秒；CI step原有50分钟足够覆盖。所有场景串行。
- 可先执行 `node .trellis/tasks/11-12-image-history-migration/checks/topologies.mjs`，只跑两项图片拓扑并附加**真实 C2 二进制**拒绝。最终完整 `verify:e2e` 不能被这次定向运行替代。

task wrapper 要求 frozen workspace 上级 `owner.json` 的 `kind=image-storage-foundation-local-v1` 与精确 workspace。
同一上级还需 root 保留的 `c2-worker-evidence/{narra-worker,contracts/**,evidence.json}`：
`sourceReceipt=20261115T135500-previous-worker-linux-4133d8`；binary SHA256
`f16bec7352122be5b921392313fa0b34db83d01f201bee926e0d2fe9a04a784d`。每次复制前核对整个文件列表和哈希，
使用原 C2 contracts 和单独端口，不能把新 JSON 交给旧 binary。

portable E2E 不携带/下载旧二进制。任务附加检查在 embedded 上证明真实旧 dedicated 进程被拓扑锁拒绝，
在 dedicated 上证明原 revision2 Worker 被新 schema 拒绝，前后对象、quota、生成 attempt 不变。
默认 E2E 另用真实 generic Worker 验证 Canvas关闭时仍不能满足 managed图片能力，并验证错误卷拒绝/恢复。

峰值资源：一轮 PostgreSQL(tmpfs)、模拟S3+provider、App、1个Worker；初始化与停站后的历史复制容器为短暂one-off。
每个图片拓扑一个很小的 owner/project-labelled LOCAL named volume，同一卷跨App/Worker重建。
卷使用local driver、无driver options；清理先移除核实容器，再要求全daemon无任何容器挂载，
重查Name/CreatedAt/labels后按精确名字非force删除。原有no-pull、internal网络、无host端口、空Docker配置和显式env-file约束保留。

实际断言：旧S3生成/Canvas导入与重放；NULLlegacy、普通历史参考、第三方、视频/未知对象；
新LOCAL生成/普通上传/Canvas导入；空manifest发现与显式sourcebinding；dry-run DB/文件/PUT/DELETE无变化；
limit1后原job续跑及完成重放；三源保留、一源经统一执行器先失败后确认退休；全站12份→11份字节、
Canvas首次接管前实际drain全部运行进程并等待90秒GC租约自然到期；独立CLI先复制/切换，停站时真实公开读取失败仅阻止退休，
重启后同job续跑且不重写副本（不调整DB时间或放宽adoption guard）；
Canvas逻辑额度/根与原tuple/输入不变；精确旧URL经真实proxy读取、媒体GET/HEAD/304与Next optimizer；
实际八个LOCAL文件内容/0600权限；重建后原字节；rollback、错卷、generic Worker及任务附加旧binary拒绝。

## 本次 Windows 构建辅助器

`integrated-e2e.mjs` 保留默认全部11场景，只在构建入口调用 `cached-dependencies.mjs`。早期复用的无标签C2依赖镜像在最终镜像清理时被作为无引用祖先移除；当前辅助器使用本任务新建、带owner标签的独立依赖tag。初次仅执行原Dockerfile的deps前缀和完整frozen install，保留固定本机Node base ID；运行目录的`history-dependency-cache.json`记录owner/tag/image ID、workspace、Node base、三份package/lock/workspace SHA及deps Dockerfile摘要，复用时逐一核验。后续版本还在构建前写独立attempt回执，覆盖build成功但inspect/记录失败的恢复窗口。只读、无网络、无挂载的inspector继续核对Node/Corepack pnpm10.32.1和`/app`全部四个名称。这是依赖缓存，不是应用构建产物；最终按精确tag/ID/owner清理，不能因失败而删除未知对象或提前把清理记为成功。

生成的 task-only Dockerfile 让 builder 和 runner 继承同一 deps 层，避免额外复制大目录；完整当前源码 COPY、frozen install、Prisma generate、Next build 与原启动命令仍执行。runner 在当前 Prisma/schema/config/包文件 COPY 后重新生成 client，随后必须与完整 build 的 node_modules 全目录清单逐项相同：根与全部目录/隐藏条目、mode/uid/gid、文件长度/SHA、字面 symlink 都比较，拒绝特殊文件、不排除 cache、不追随链接。每个文件用1MiB可复用buffer计算SHA；两侧计数与摘要入日志。还验证依赖镜像的base layer前缀及原runtime环境/入口/用户/工作目录，拒绝泄入构建DB/auth/app/provider配置。资源参数仅作用于本轮构建，不改生产 Dockerfile/配置。原始与生成 Dockerfile 的 hash、依赖 hash、离线版本探针及资源限制均单独留证；这是有字节等价证明的本地构建变体，不声称原Dockerfile原样执行。

最终辅助器仅为两份生成Dockerfile中的原 `go mod download` 增加最多三次尝试；保留固定基础镜像、完整Go编译、no-pull和所有原场景，不改依赖或生产Dockerfile。`20261115T184531-history-integrated-e2e-765657` 完整11场景实际退出0，1278.531秒；builder/runner各55,432项，摘要同为 `24a9f2ffd34268575e0916d2ce4a34196c02c0c83c4744ef6da0d49f37e083cd`。最终源与快照零漂移，续接会话逐一核实当前950个非 `.trellis/` 输入完全相同；此前失败保留，不将历史部分通过拼成全套结果。

Docker/WSL 整体退出时，不以 stderr 的 EOF 推断应用 OOM，也不删除未知镜像/缓存。先保留失败、单独恢复服务，再按原 ID/名称/owner 验证并补清理；后续恢复记录不覆盖原失败。启动已安装 Desktop 需要其原 Windows profile，不能把测试合成 APPDATA/USERPROFILE 用于全局桌面控制程序；测试本身仍使用空 Docker 配置、合成 HOME 和 deny-env。后台应用启动使用隐藏窗口，并避免让长期后台子进程继承捕获管道而拖住 wrapper 截止。
