# Readiness、配置与日志契约反审

## 初始结论

审查发现两个 BLOCKER和一个 WARNING：dedicated Next readiness 没有 Worker 地址/timeout/required 契约；manifest 未覆盖绕过 loader 的直接环境变量读取；日志脱敏只有原则，没有统一 redactor 与负向样本。

## 证据

- app 当前没有 Worker URL，embedded 的地址推导只存在于 supervisor（`scripts/start-prod.mjs:179-186`；`docker-compose.yml:29-52`）。
- supervisor、前端 build-time 配置和部分 Worker 契约代码仍直接读取环境变量，单纯比较 manifest 与 loader 无法发现漂移（`scripts/start-prod.mjs:11-18` 等）。
- 上游错误正文、完整视频 URL 和数据库错误可能进入日志（`worker/internal/worker/generation.go`、`worker/internal/worker/worker.go`、`scripts/start-prod.mjs`）。

## 规划修订

- 新增 `WORKER_INTERNAL_URL`、`WORKER_READINESS_REQUIRED` 与 timeout，明确任一 ready 副本语义。
- manifest 只覆盖共享/发布关键变量，并记录唯一允许读取路径；静态扫描 `process.env`/`os.Getenv`，owner 外读取直接失败。
- Node/Go/supervisor 共用敏感值分类与 redactor；负向 fixture 覆盖 DSN、Authorization/API Key、上游 body 和签名 URL。

修订后无已知契约 BLOCKER；实施时需避免把 manifest 扩大为所有产品配置的重写。
