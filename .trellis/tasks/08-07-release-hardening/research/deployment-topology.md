# 发布拓扑审计

## 结论

当前仓库同时支持 Zeabur 单容器 embedded 和 Compose dedicated，但两种模式只有配置约定，没有数据库级互斥或完整就绪联动。后续实施应保留两种拓扑，同时把启动顺序、消费者模式、停止与回滚固化为可自动验证的契约。

## 已确认事实

- 根镜像同时包含 Next.js、Prisma CLI、Go Worker 与生产启动脚本，默认执行 `scripts/start-prod.mjs`（`Dockerfile:40-60`）。
- embedded 模式由 `ENABLE_EMBEDDED_WORKER` 控制；启动脚本先准备数据库，再启动 Worker，轮询 `/healthz` 成功后启动 Next（`scripts/start-prod.mjs:13-18,170-237,516-562`）。
- dedicated Compose 中 app 与 worker 都只等待数据库健康；app 不等待 worker，且 app 只靠环境变量关闭内嵌 Worker（`docker-compose.yml:20-67`）。误配置时没有运行时机制阻止 embedded 与 dedicated 消费者同时存在。
- Worker 在 schema probe 通过后才启动 HTTP server；迁移未完成时平台看不到 liveness，也无法区分“进程仍在等待”与“进程已退出”（`worker/internal/worker/worker.go:67-82,132-153`）。
- Worker 已有停止领取、宽限期 drain 和超时取消机制，可作为发布停止契约的基础（`worker/internal/worker/worker.go:84-130`）。
- dedicated E2E Compose 使用固定容器名、`restart: unless-stopped` 与持久化 volume，不是一次性验证环境（`docker-compose.e2e.yml:1-98`）。

## 主要风险

1. app 可在没有可用 Worker 时对外接受生成任务，任务持续堆积。
2. embedded 与 dedicated 误同时启用时，无法区分合法横向扩容和错误混跑。
3. `/healthz` 同时承担存活和依赖检查，schema 等待阶段没有可观测状态。
4. 迁移、Worker、Next 由不同入口隐式编排，失败传播与回滚顺序无法自动证明。

## 推荐边界

- embedded：`migrate deploy → Worker HTTP/liveness → Worker readyz → Next`，任一子进程异常都由 supervisor 传播退出并停止其他子进程。
- dedicated：一次性 migrate 服务成功后启动 Worker；Worker readyz 后再启动 app。app 和 Worker 都提供独立 healthz/readyz。
- 保留 `ENABLE_EMBEDDED_WORKER` 作为 app 是否派生 Worker 的单一开关；Worker 额外接收 `WORKER_RUNTIME_MODE=embedded|dedicated` 用于运行时互斥。
- Worker 持有 PostgreSQL advisory lock：embedded 使用独占锁，dedicated 使用共享锁。这样允许多个 dedicated Worker，同时拒绝 embedded/dedicated 混跑和多个 embedded supervisor。
- 回滚代码前先调用既有 `CheckRollbackSafety`；存在活动 contract v1 或未决 handoff 时，只能关闭新 claim，不能启动旧 finalizer。

## 验证矩阵

- embedded：迁移成功、Worker ready 后 Next 才启动；Worker 启动失败时容器失败退出。
- dedicated：migrate 成功后 Worker 启动；Worker ready 后 app 才 ready。
- 互斥：两个 dedicated 可并存；dedicated + embedded、两个 embedded 均被拒绝。
- 停止：SIGTERM 后不再领取任务，在 grace 内完成或按 handoff 契约退出，无永久 `PROCESSING`。
- 故障：数据库断连、schema 缺失、Worker 崩溃、迁移失败均令 readyz 失败且不产生假绿。
- E2E 只使用随机 Compose project、随机端口和归属标签；不得复用固定容器名或持久化 volume。
