# C1 图片存储基础验收

归档状态：本子任务的质量门禁及父最终集成均passed，两笔工作提交1368518/67b0edf与获批清单一致，四任务已按序归档；journal第9次记录位于 `.trellis/workspace/0401lucky/journal-1.md`，未push。下文保留原阶段及最终补验的实际输入边界。

## 当前结论

2026-11-15 从会话 `01a1cedd-fc26-7220-94ad-6b40642e29cf` 续接。C1 全范围静态复核和本阶段必需验证已完成，可以交付 C2。Prisma 默认表达式漂移已修复并通过真实迁移。完整 CI 前九阶段通过，最后 Next 构建发生本机内存不足；对同一源码单独重跑原生产构建已通过。下面保留失败与重跑的独立回执，不将退出 134 的单次 CI 命令标为通过。

此记录只验收 C1：统一清单/额度、全入口图片读写、引用桥接、Canvas 存储修订和部署基础。清理执行器/管理页面属于 C2，历史无 PUT 盘点/迁移及两种完整部署拓扑属于 C3。

## 本轮修复

- `scripts/tests/migration-safety.test.mjs`：上次中断时只导入了新的 `verifyPgxUrl`，没有完成对应回归。本轮补齐 11 项测试，证明当前新 schema 的空库必须返回完整 `ROLLBACK_UNSAFE` 报告和退出码 2；构建失败、旧 safe 报告、`go run` 折叠的退出码 1、错误修订、非空/未决清单、检查失败、额外未审阅字段与非 JSON 输出均不能通过。
- 正例同时确认构建产物由直接二进制调用执行，特殊字符数据库 URL 与全局截止原样传递。测试使用注入的合成命令结果，不连接数据库；真正 pgx URL 连接验收仍由 migration wrapper 提供。
- 已复核上次修复的 `CanvasImportAsset_location_key` Prisma 声明、旧库 `LoginCoverConfig` fixture 和 migration wrapper 的新 schema 回滚预检预期，保留完整 schema 差异检查及旧 Worker 拒绝语义。
- `prisma/schema.prisma`：实际 `20261115T032802-schema-diff-556c49` 诊断确认唯一剩余差异是 `ImageAsset.publicToken` 的 `dbgenerated` 默认值。PostgreSQL 将两个 UUID 的文本拼接包在一层括号中：`replace(((gen_random_uuid())::text || (gen_random_uuid())::text), '-'::text, ''::text)`，Prisma 声明少了这层括号；虽然 SQL 语义一致，Prisma 仍将其判为默认值变更，导致 baseline 最终 diff 退出 2。现已仅对齐 Prisma 文本，原 migration、令牌生成算法与 catalogue 指纹保持原样。
- `src/tests/unit/image-schema.test.ts`：增加所有 Image 模型 `dbgenerated` 默认值与已由真实 PostgreSQL 采集的 catalogue 的对照，覆盖这一类声明与实际结构的漂移；实际 migration gate 仍必须复跑，不能以源码对照代替。

## 全范围审查覆盖

| 边界 | 已核对行为与关键证据 |
| --- | --- |
| 共享数据契约 | `contracts/media/v1/`、两端 image contract/repository/schema 与两个新增 migration；十进制字节字符串、5,000,000,000 字节额度、1–4 槽/每槽 50MiB、实际 catalogue 全函数体/约束/trigger 指纹。 |
| 预留与物理计量 | SQL 锁序 quota → reservation → asset → object；槽预算在短事务转为真实字节一次；闭合只释放未物化槽；UNKNOWN/过期本身不能减物理量；不可变清单与业务 cascade 分离。 |
| 生成与计费 | Web、external legacy、gateway、Go enqueue/Worker 的上游前准入；gateway 补偿由原转发层拥有；输出数量/b64/URL 边界、部分写成功与未知提交保持 inventory；保留 v0/v1 各自的退款和 handoff 规则。 |
| 引用与 Canvas | SHOWCASE、SITE_COVER、JOB_INPUT、CANVAS_SAVED 同 asset 锁；已提交输入永久保留、普通生成来源不成为永久根；原图 same-owner/账户额度/七天宽限继续有效；原 S3 tuple 不可变，LOCAL 使用真实 provider；旧 GC mutation 签名被拒绝。 |
| LOCAL IO | Node 固定目录句柄、Go os.Root、精确 key → 平面文件名、卷标记与文件身份核对、排他暂存/硬链接发布、长度/摘要校验、有界读取/取消、pending 不当作 missing、只删除已登记精确对象；只读验证与零字节可写探针分离。 |
| 读取与权限 | `/media/images/[token]` 的不可猜公开 token、GET/HEAD/ETag/已删除态；优化器精确同源改写；代理下载、外部 b64/参考图和 Go 输入先解析精确登记别名，第三方 URL 继续原校验；公开作品 DTO 权限不变。 |
| 配置、部署、回滚 | runtime manifest、Node/Go 唯一 loader、示例/Compose；LOCAL 卷身份和可写探针不依赖 Next 已启动；严格 capability provider/location/revision 比较；回滚在只读一致快照验证完整 Image/Canvas schema，空的新 schema 也拒绝旧 Worker。 |
| 范围排除 | 图片清单不接管视频文件/视频专用封面；未知第三方 URL 与未登记历史行不变成自动清理对象；历史已确认副本采纳和真实删除入口留给后续子任务。 |

## C1 验收映射

| 条目 | 自动化覆盖 | 需要主会话核对的执行证据 |
| --- | --- | --- |
| S-A1 本地完整读写和重建 | `local-image-store.test.ts`、`image_local_store_test.go`、`managed-image-consumers.test.ts`、`managed-image-route.test.ts`、`canvas-managed-assets.test.ts`；实际跨进程与 HTTP task harness。 | Linux 跨容器互读与本轮真实 Next/Go HTTP 链路通过，见下表。 |
| S-A2 最后额度与幂等 | `image-storage-db.test.ts` 的真实两连接最后字节竞争、副本和槽转计量；`checks/image-data-smoke.sql` 在数据库内预留 44 个输出槽并核对精确 `2306867200` 字节；两端 repository/contract 测试。 | Canvas DB full/additive 与本轮大于 2GiB 的真实 SQL smoke 均通过。 |
| S-A3 上游前拒绝和输出上界 | `image_integration_test.go` 的 count/b64/Responses 多结果负例、`managed-image-storage.test.ts`、generation contract fixtures。 | 本轮 Node/Go 全量与真实 HTTP 回执通过，见下表。 |
| S-A4 引用竞争与旧原图根 | `image-storage-db.test.ts` 的引用与删除态竞争、真实 showcase/site-cover/跨 owner 输入，Canvas DB 的 saved/永久 job roots 及旧 GC 栅栏。 | Canvas DB full/additive 已有通过。 |
| S-A5 未知与部分失败 | `managed-image-storage.test.ts`、`image-storage-db.test.ts` 的 NOT_WRITTEN/UNKNOWN/旧 token/未决对象，LOCAL pending/cancel/不可变文件负例。 | 专项、DB 与本轮 CI 对应测试阶段均通过。 |
| S-A6 严格能力和卷探针 | `managed-image-readiness.test.ts`、`canvas-readiness.test.ts`、`image_producer_config_test.go`、schema/rollback 真实 DB 套件。 | Worker/Canvas/gateway DB 已有通过；完整 topology 集成归 C3。 |
| S-A7 S3 与范围排除 | 原存储/S3 raw-wire/Canvas capability、generation media/视频契约和 managed consumers 的未知 URL 回退。 | 本轮全量 Node/Go 测试通过；真实 R2 及生产迁移不属于本轮验收。 |

## 已恢复的回执与剩余门禁

以下回执位于 `checks/.runtime/storage-4e37900e/receipts/`。主会话已核对四项恢复的 DB/跨进程回执：对应 TS/Go 与 migration 输入仍一致；后续 Prisma 声明及脚本回归由本轮 CI/migration 覆盖。

| 门禁 | 回执 | 当前状态 |
| --- | --- | --- |
| 旧完整 CI | `20261112T074619-ci-bounded-a88e13` | 当时 155 个文件 / 1992 测试及 lint/types/Go/build 通过；后续 schema/fixture/runner 改动需 fresh CI，不能作为最终字节证明。 |
| Worker DB | `20261112T101512-worker-db-cde899` | 通过；零 source/snapshot drift。 |
| Gateway DB | `20261112T101542-gateway-db-ae595b` | 通过；零 source/snapshot drift。 |
| Canvas + Image DB | `20261112T101608-canvas-db-847013` | full/additive 通过；零 source/snapshot drift。 |
| Linux 同卷跨进程 | `20261112T101648-local-crossprocess-ea4860` | 通过；零 source/snapshot drift。 |
| 修复前 migration | `20261115T031826-migrations-2750f4` | 已实际执行，baseline 最终 schema diff 非零，退出 4；保留失败记录。 |
| 实际 schema 诊断 | `20261115T032802-schema-diff-556c49` | 唯一差异为 publicToken 默认表达式括号，已据此修正 Prisma；诊断本身不是全套 migration 通过。 |
| 修复后 migration | `20261115T042713-migrations-4750ea` | 全部场景通过；53.15 秒，零漂移。 |
| 最新 CI 前九阶段 | `20261115T042822-ci-bounded-80bc42` | 脚本回归、Prisma generate、types、lint、155 文件 / 1993 Node 测试、TS/Go 契约及 Go 全量测试/构建均通过；第十阶段 Next 原生内存分配失败，整条命令退出 134。 |
| 原生产构建独立重跑 | `20261115T043402-build-5507e6` | 同一源码执行完整 `next build` 通过；19.723 秒，零漂移；未修改生产配置/内存限制。 |
| 真实 Next/Go HTTP | `20261115T043438-local-http-c508dd` | 11.292 秒通过；普通生成/上传参考图/Canvas 导入重放及根、匿名 GET/HEAD/304、真实 Next optimizer、鉴权下载代理、应用进程重启读回原字节。 |
| 最新结构及 SQL smoke | `20261115T043505-schema-diff-1782a7` | 完整 20 段历史、真实 Prisma 零差异、media/Canvas catalogue、2306867200 字节预留及 Canvas LOCAL/root smoke 通过；6.362 秒，零漂移。 |

HTTP 夹具未配置 S3，共调用模拟 provider 两次，登记 4 个真实 LOCAL 文件 / 280 字节，预留归零；保存画布根与永久任务输入根各一项。使用真实生产应用和 Worker，provider 仅返回固定已校验 PNG。Linux 两容器重建互读由上面的跨进程回执独立证明；完整 embedded/dedicated 迁移拓扑仍属于 C3。

`git diff --check` 通过。lint 保留 9 项既有 unused-vars warnings，无 errors。本阶段产物通过不代表管理员清理或历史迁移已经实现；C2/C3 将继续依赖本文件记录的接口与边界。

## 下游交接

- C2 复用清单、字节契约、引用锁、LOCAL IO 和单一物理对象身份；新增 cleanup claim/finalize 必须遵守现有不可变、UNKNOWN、Canvas 七天与长期根约束，不能直接 DELETE inventory 或复用旧 Canvas finalizer 减额。
- C1 旧 backfill 晚绑定 `GenerationImage.mediaAssetId` 时，不会重放此前的 Canvas result/run trigger；C2 已批准的设计和 `research/retention-data-handoff.md` 将补桥接和读取原 scene/run 事实列为首次删除前的硬门禁。C1 尚无全站删除入口，不能在 C2 中仅凭空 `ImageReference` 宣称该类历史图无引用。
- C3 的 COPY 已有独立预留/物理副本和 CAS 活动指针基础；无 PUT 的历史登记仍需新增经验证的入口，不能借 `INPUT + GENERATED` 的窄 backfill 例外绕过实际计量。
- 本文件不把源码静态复核、fake command 单测或 SQL smoke 记为生产验收。C1 所需本地及隔离服务证据已齐全；继续 C2/C3，不代表已经部署到生产。

## 父任务最终集成补验（2026-11-16）

前文保留C1原输入及原失败边界。提交前C1未发布Canvas SQL只移除最后一个多余LF，13份函数定义不变，两份共享manifest同步原字节SHA；全部五份shared migration精确固定LF，Git实际checkout filter和负对照通过。新当前快照由C3/父最终门禁覆盖，不用原C1回执冒充新checksum。

当前 `20261116T023915-ci-bounded-c5b0f5` 同次完整十阶段CI通过（168套/2150项），真实catalogue、Canvas完整/增量各4套87项、Worker/Gateway DB、全部迁移/Prisma零漂移，以及 `20261116T025107-history-integrated-e2e-f78bd8` 同次默认11场景全部通过。950项产品输入与新完整CI/E2E完全一致，独立资源清理通过；详见 `checks/gates.json` 的 `finalParentIntegration` 和C3 `checks/gates.json`。用户已于2026-11-16一次确认父提交及归档/journal计划，功能提交1368518的272个路径与获批清单一致；任务记录随后提交，再归档，不推送。

## 已完成的工作提交与归档（2026-11-16）

两笔工作提交依次为 `1368518dfe0e2b3d9a78789f022b4e0859240ff6`（272个功能/spec路径）和 `67b0edfd777629bd1dcd37117a1d0e892a115c9e`（79个任务记录路径），实际范围均与用户一次批准的清单一致。本任务已通过native `task.py archive`移动到 `.trellis/tasks/archive/2026-11/11-12-image-storage-foundation`，status为completed，quality gate保持passed；归档Git提交只暂存本任务原路径删除及新路径文件。journal由父任务统一记录，两笔工作提交先于全部归档/journal提交，未push，六份既有GHCR文件字节保留。

最终session第9次记录已写入 `.trellis/workspace/0401lucky/journal-1.md`，关联两笔工作提交；本任务commit-plan收尾状态completed，原验证回执/源码边界未变化。
