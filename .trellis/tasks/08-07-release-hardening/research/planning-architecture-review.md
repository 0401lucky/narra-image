# 规划架构反审

## 初始结论

审查发现三个 BLOCKER：advisory lock 断线后缺少 fencing；dedicated app 未定义 Worker 地址和多副本 readiness；HTTP/claim/processing/drain 与 rollback preflight 未形成可执行生命周期。

## 证据

- 当前 Worker 数据库错误后会继续轮询，锁连接若单独丢失可能在无互斥保证下恢复 claim（`worker/internal/worker/worker.go:156-181`）。
- app 没有 Worker 内部 URL；`WORKER_HTTP_ADDR` 只定义监听地址，Compose 固定 Worker 容器名阻碍 scale（`worker/internal/worker/config.go:71`；`docker-compose.yml:29-82`）。
- HTTP server 错误当前只记录日志；signal 到来时 server 会立即关闭，无法在 drain 窗口持续返回 not-ready（`worker/internal/worker/worker.go:89-130`；`worker/internal/worker/server.go:48-69`）。
- `CheckRollbackSafety` 已存在，但没有 CLI/脚本入口（`worker/internal/worker/schema.go`）。

## 规划修订

- 锁连接丢失触发 fatal fencing：立即撤销 ready/claim，有界 drain 后非零退出，同进程不静默重获。
- 新增 `WORKER_INTERNAL_URL`、required/timeout；dedicated 使用服务发现并移除固定 Worker 容器名。
- 使用结构化并发协调 HTTP、锁、claim、processing；HTTP 在 drain 期间继续服务，增加 hard-stop deadline。
- 增加稳定退出码的 rollback preflight CLI。

修订后无已知架构 BLOCKER，实施阶段仍需用两 Worker、锁断线和 hard-stop fixture 验证。
