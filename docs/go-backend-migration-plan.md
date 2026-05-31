# Go 后端渐进迁移规划

## 当前阶段状态

第一阶段已经完成：Next.js 负责接收用户请求、鉴权、扣积分和创建生成任务；Go Worker 负责消费 `PENDING` 任务、调用图片渠道、保存图片、回写任务状态并处理失败退款。

第二阶段正在推进：外部 OpenAI 兼容 API 仍由 Next.js 负责鉴权、限流、参数解析和响应格式化，但 `/v1/images/generations`、`/v1/images/edits`、`/v1/responses`、`/v1/chat/completions` 的模型调用改为创建 `workerManaged` 任务并等待 Go Worker 完成。

这个阶段的目标不是全量重写，而是先把最慢、最容易阻塞页面体验的生图链路移出 Next.js 请求进程。

## 已落地能力

- `GenerationJob` 支持 `PENDING`、`PROCESSING`、`SUCCEEDED`、`FAILED` 状态流转。
- Go Worker 支持并发消费、任务锁、心跳、超时失败、失败退款。
- 支持内置渠道、自填渠道、图生图、多参考图和 Responses image tool。
- 支持 S3/R2 图片持久化，本地 data URL fallback 用于非生产兜底。
- Docker Compose 已包含 `worker` 服务。
- 前端生成结果展示任务总耗时，便于观察真实生成速度。
- 外部 OpenAI 兼容 API 的生图执行链路已开始切到 Go Worker，Next.js 不再在请求进程内直接调用图片模型。
- Go Worker 暴露 `/healthz` 和 `/metrics`，可检查数据库健康、队列积压、最近成功率和 P95/P99 总耗时。

## 后续迁移 Todo

1. 任务队列能力增强
   - 增加任务优先级和用户级限流，避免单个用户占满 Worker。
   - 增加更清晰的重试策略：区分可重试网络错误、渠道错误、参数错误。
   - 将任务耗时拆成排队耗时、模型耗时、存储耗时，方便定位慢点。

2. 外部 API 迁移到 Go
   - 已开始迁移 `/v1/images/generations`、`/v1/images/edits`。
   - 已开始迁移 `/v1/responses` 图片工具相关链路。
   - 当前策略是 Next.js 保持外层 OpenAI 兼容响应格式，Go Worker 承接模型调用和结果落库。
   - 后续再评估是否引入 Go HTTP API Gateway，让 Go 直接对外提供 `/v1` 接口。

3. 图片存储服务化
   - 把上传、下载代理、缩略图 URL 规则沉到 Go 服务。
   - 增加图片元数据探测和失败补偿。
   - 后续可加入缩略图预生成，减少前端列表页加载压力。

4. 实时状态推送
   - 用 SSE 或 WebSocket 替代前端轮询。
   - 推送 `queued`、`processing`、`saving`、`succeeded`、`failed` 等细粒度状态。
   - 页面可直接显示排队位置和预计等待时间。

5. 管理与观测
   - 已增加 Worker 健康检查、队列积压数、成功率、P95/P99 耗时。
   - 管理后台展示慢任务、失败原因分布和渠道健康度。
   - 记录 provider 请求 ID，方便和上游号池日志对账。

6. 鉴权与用户域服务
   - 保留 Next.js 页面层，逐步把用户、积分、API Key 校验沉到 Go。
   - 先抽出内部服务接口，再考虑是否让 Go 直接对外提供 API。
   - 迁移时必须保持积分扣减和退款的事务一致性。

## 暂不迁移的部分

- 页面渲染和创作台交互仍留在 Next.js。
- 管理后台短期继续走现有 Next.js API。
- OAuth、Turnstile、邀请码等登录准入链路暂不迁移，等生成主链路稳定后再评估。

## 判断进入下一阶段的标准

- 真实生图任务连续运行稳定，失败能正确退款。
- 队列积压和 Worker 日志可观测。
- 前端提交生成时不再因模型请求慢而明显卡顿。
- 至少收集一批真实任务耗时数据，再决定优先迁移外部 API 还是实时推送。
