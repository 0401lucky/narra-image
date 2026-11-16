# 图片本地存储与清理：实施计划

状态：用户于 2026-11-12 回复“没问题”，已批准最终规划并授权实施三个图片子任务。范围、行为及 A1–A10 以 `prd.md` 为准，跨层契约以 `design.md` 为准；生产操作仍不包含在此次代码实施中。

## 1. 启动门禁

- [x] 用户同意创建任务并规划。
- [x] 用户明确只做图片，视频与视频专用封面排除。
- [x] 读写、保留、管理、额度和 Canvas 演进证据落入 `research/`。
- [x] 父/子 PRD、design、implement 与真实 spec/research manifests 完成路径和一致性检查（见 planning-review.md）。
- [x] 向用户展示最终规划摘要，并在后续消息中获得明确实施批准。
- [x] 批准后启动 `11-12-image-storage-foundation`；不把父任务当作默认产品实现目标。

没有最后的实施批准时，不运行 `task.py start`、不派 implementation/check 工作、不改产品代码。规划/研究代理只读产品代码并写任务研究文件。

## 2. 交付顺序与责任

| 顺序 | 子任务 | 输出 | 进入下一项的条件 |
| --- | --- | --- | --- |
| 1 | `11-12-image-storage-foundation` | 共享图片契约、additive schema、全入口登记/引用/预留、本地与 S3 适配、读取、Canvas provider/GC revision、卷/readiness 基础。 | 新数据 local/S3 和额度/引用专项、Node/Go/SQL 契约通过；接口与 spec 更新可供下游使用。 |
| 2 | `11-12-image-retention-management` | 单一清理执行器、后台调度、容量回收、管理员统计/预览/确认/进度和历史已清理状态。 | 真文件删除/失败/重复领取/引用竞争、管理权限及浏览器行为通过。 |
| 3 | `11-12-image-history-migration` | 历史图片/引用登记、精确 URL 别名、R2→LOCAL 工具、恢复/校验/源退休、完整部署/回滚说明。 | 历史/新图片混合状态和两种拓扑集成验证通过，所有父级验收有可追溯证据。 |

子任务顺序是显式依赖，不并行修改共享 Prisma schema、contract manifests、Worker 状态机与 readiness。每个子任务使用 `trellis-implement` 后接 `trellis-check`，主会话负责接口协调、范围校准、spec 与提交/收尾；派发首行必须为实际 Active task 路径，缺少 native 注入时按项目流程由子代理加载上下文。

## 3. 跨子任务实施检查清单

- [x] C1：定义 GB 字节常量、精确 JSON 字节编码、物理对象/预留一次计账、幂等写入与通用图片存储错误。
- [x] C1：为上游 b64 与 URL 输出统一大小/数量边界，证明生成预算是上界；所有入口包括普通参考图、Canvas、Go 内部 enqueue 与将来的迁移都经过 gate。
- [x] C1：保持 v0/v1 handoff、UNKNOWN、退款差异；额度耗尽尽早拒绝，不因持久化失败重发上游。
- [x] C1：补齐生成结果、普通参考图、保存画布、输入任务、公开/审核和站点封面的引用保护及加锁。
- [x] C1：保持 Canvas 业务 ID/旧 S3 tuple 不变；真实 LOCAL provider、逻辑/物理计量区分、明确能力修订和旧 Worker drain。
- [x] C1：对外稳定 HTTP(S)，内部受信对象直接读取；验证 optimizer、代理下载、外部 b64 和绝对 URL，不放宽任意远端 URL 的安全规则。
- [x] C2：预览与执行有独立身份和期限，策略版本变化/新引用竞争不扩大已确认范围。
- [x] C2：三个触发入口共用候选/删除/计量，源副本退休与逻辑图片清理分开，失败/未知不释放额度。
- [x] C2：网页关闭后任务继续，lease/进度/失败恢复持久；保护占满时明确拒绝新增。
- [x] C2：普通/Canvas/作品/API 投影统一识别清理态，不修改生成终态和计费记录。
- [x] C3：先盘点已知业务图片、位置与引用；不误纳入视频/视频封面/第三方资源，不把未知历史行当作可删除对象。
- [x] C3：迁移 dry-run、复制校验、活动指针切换、保留源/显式退休源、断点恢复及在途消费者保护。
- [x] C3：更新 embedded/dedicated 卷配置、environment manifest、README 和 rollback preflight，证明重建不丢图片。

## 4. 验证矩阵

| 门禁 | 证明目标 | 负责阶段 |
| --- | --- | --- |
| 定向 Node/Go 单测与契约向量 | 大小/数量/路径/字节编码、重放、LOCAL/S3 适配、状态错误；真实边界反例而非只断言 mock 次数。 | 每个子任务变更后 |
| disposable PostgreSQL 集成 | 全站最后额度竞争、账户额度/根保护、锁顺序、旧/新 schema 能力、delete/put 不确定状态和重启恢复。 | C1/C2/C3 各自专项 |
| 临时目录 + 模拟 S3 | 实际字节写入/读取/精确删除、跨进程同卷、复制校验、缺对象/失败/迟到回执与占用。 | C1/C2/C3 |
| 管理网页真实交互 | 管理鉴权、统计/配置/预览/确认/取消/进度/错误，普通历史已清理占位及禁止下载/复用。 | C2 |
| 两种部署拓扑 | embedded 启动无自依赖，dedicated 同卷与身份一致，重建可读、Worker drain、旧版本拒绝和恢复。 | C3 最终集成 |
| 视频排除负例 | MP4、video poster、第三方图片和未登记对象都不进入本轮自动清理/迁移。 | 所有子任务 |

优先运行受影响专项；每个实际改变后的最终检查按 specs 执行。没有相关改动或新的失败时不重复已经通过的重量级验证。

```powershell
pnpm verify:ci
pnpm verify:worker-contracts:db
pnpm verify:canvas-contracts:db
pnpm verify:gateway:db
pnpm verify:migrations
pnpm verify:e2e
git diff --check
```

具体单测文件和新存储 DB runner 在各子任务实施时记录于 verification.md；若新增专用 runner，复用已审计的 disposable helper，不依赖调用者 `.env`。`verify:ci` 已包含 Prisma generate、tsc、lint、非 DB 测试、TS/Go 契约、Go 检查和 build，避免再列重复命令伪装额外证据。`verify:migrations` 沿当前 spec 用已审计的环境隔离外层运行；基础设施缺失时按事实记录，不能把缺资源退出当通过。

## 5. 易出错的共享文件

- `prisma/schema.prisma` 与新增 migration：不改已发布 migration；保留旧身份/约束并同步 Node/Go schema 探针。
- `contracts/canvas/**`、`contracts/generation/**`、`contracts/runtime/v1/environment.json`：业务 wire 与存储 revision 区分，不能通过伪造旧 readiness 兼容新 provider。
- `src/lib/storage/`、`src/lib/canvas/`、`src/lib/generation/`、`worker/internal/worker/storage.go`、`worker.go`、`job_lifecycle.go`：全入口纳管、事务外 IO、v0/v1 失败和退款语义。
- `src/lib/prisma-mappers.ts`、`src/lib/server/works.ts`、作品/画布消费组件：清理态与私有提示词权限要一起检查。
- Compose、runtime loader、启动与 rollback preflight：避免旧 GC、不同卷和新状态混用。

## 6. 发布与回滚点

1. Schema 升级前保留部署记录，drain 旧 Worker；新增 migration 可用完整历史和增量历史验证。
2. C1/C2 代码准备好不等于允许旧数据自动回收；C3 完成已知历史登记/引用核验后才能启用策略。
3. 迁移默认 dry-run/保留源；真实迁移与源删除依据用户明确操作，当前不运行生产命令。
4. 回滚首先停止新清理/迁移/写入并等待在途操作；只切回仍存在且校验通过的副本。旧 Worker 回滚需要 preflight，不能删除 additive schema 或假装已清理文件可恢复。

## 7. 收尾

- [x] 各子任务提供 verification.md，逐项对应父 A1–A10，区分模拟/本地部署验证和真实服务验收。
- [x] 把已验证的媒体存储、Canvas 存储 revision、环境配置、管理 UI 与迁移规则更新到相关 specs。
- [ ] 按项目提交流程提交本任务相关变更；工作区已有 GHCR 任务改动不属于此次提交范围。
- [ ] 子任务独立归档后执行父级集成核对、记录 journal，再结束父任务；不要把“计划已写完”记录为功能完成。
