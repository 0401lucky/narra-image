# 图片存储基础实施计划

前置：父任务最终规划获准且本子任务已激活；不存在其他子任务依赖。先读取本任务 PRD/design 和父设计，随后按 implement.jsonl 加载 specs/research。只实现本任务拥有的基础能力。

## 当前实现分工

为避免共享文件冲突，C1 内按模块分工，三个子任务之间仍按原依赖顺序推进：

- 数据契约执行者：`contracts/media/v1/**`、Prisma schema/本次新 migration、新的 Node/Go 图片登记与额度 repository、相应数据层测试；先公布接口。
- 本地 IO 执行者：独立的 Node/Go 本地文件 helper 及对应测试；不改环境 loader、Canvas、原 storage.go 或 Prisma/schema。
- 集成执行者：现有 Node/Go 图片入口、runtime 环境、Canvas/能力修订、HTTP 读取/消费者及部署基础；使用前两项接口，不改它们拥有的文件。
- 主会话：接口协调、验证环境、父/子任务记录、spec 与最终检查；收到接口后再并行接入，重量级测试统一调度。

## 顺序与文件责任

- [x] 定义共享图片字节、数量、状态与错误契约；拟新增 `contracts/media/v1/`（图片专用范围），同步 generation/runtime/Canvas 存储修订与 Node/Go loader。
- [x] 在 `prisma/schema.prisma` 和新的 migration 中建立清单/引用/预留；保留已发布 migration 原文。同步 `schema-probe.ts`、`canvas_schema.go` 及契约 DB runner 的追加历史校验。
- [x] 实现 `src/lib/storage/` 与 `worker/internal/worker/` 的登记 gate、实际长度 put/read、本地 root/卷身份、S3 位置适配；运维写入者同样不能绕过 gate。
- [x] 修改 `/api/generate`、外部 legacy/gateway、Go enqueue/Worker admission 的凭证绑定/接管；补齐 b64/远端/Responses/count 边界和 pre-handoff 容量错误。
- [x] 修改 Canvas 上传、读取、引用和 GC revision 桥接；普通生成结果/参考图保留关系进入统一事务边界，旧 root 语义不放宽。
- [x] 接入本地图片 HTTP route、内部读取、serializer/消费者及稳定 URL；此阶段完成 AVAILABLE/不可用状态接口，清理占位由 C2 展示。
- [x] 更新 runtime manifest、两端 loader、公开环境示例、Compose 卷/readiness 与对应测试。先提供部署基础，完整迁移/切换操作文档由 C3 收敛。
- [x] 定向验证后由 trellis-check 对照 specs 与父 S-A1–S-A7 范围检查；主会话记录已验证契约并交付下游。

## 验证

使用真实临时目录、模拟 S3 和 disposable PostgreSQL。覆盖所有图片写入入口、实际持久化字节、最后额度竞争、超过 2GiB 的总数、部分失败、未知 commit/PUT、原图根与账户额度、新旧存储 revision 拒绝及视频排除。

运行受影响 Node/Go/共享契约专项、`pnpm verify:ci`、`pnpm verify:worker-contracts:db`、`pnpm verify:canvas-contracts:db`；涉及 gateway admission 时运行 `pnpm verify:gateway:db`；新增 migration 以隔离环境运行 `pnpm verify:migrations`。部署基础的临时卷跨进程读写必须有证据，最终两种完整拓扑 E2E 留给 C3。

## 检查点与回滚

- C2 进入前，schema、状态/错误、逻辑/物理身份和预留接口必须稳定并有验证记录。
- 旧 GC 仍有在途 token 时不开放新副本管理；不得靠执行旧 finalizer 修正新计量。
- 回滚保留 additive schema。存在 LOCAL/新 storage revision 的数据时禁止退回只认 S3 的旧 Worker；使用父设计中的 drain/preflight。
- 不触及视频功能、现有 GHCR 任务或生产系统。verification.md 明确列出测试范围与未执行的部署验收。
