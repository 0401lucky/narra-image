# Go 生成网关契约

## 1. 适用范围与触发条件

- 适用于 Next `/v1` 外部生成入口（images generations、images edits、responses、chat completions、generations 查询）与 Go 内部生成网关（`/internal/gateway/v1/*`）之间的内部 envelope、签名、开关、计费补偿与回滚。
- 修改 `contracts/gateway/v1/`、`worker/internal/worker/gateway*.go`、`src/lib/generation/gateway-client.ts`、`src/lib/generation/gateway-contract.ts`、`GATEWAY_*` 环境变量或 `/v1` 路由的网关分支时，必须先读本规范。
- 本规范不授权公开 Go ingress、把 API Key/限流/积分扣减下沉到 Go，或删除回滚所需的 legacy 路径。

## 2. 目标形态与边界

```text
客户端 → Next /v1 薄代理（GATEWAY_ENABLED 开关）→ Go /internal/gateway/v1/*
```

- Next 保留：API Key 认证、限流、输入/媒体校验、渠道解析、积分预扣、参考图上传、images JSON 对特定 UA 的 keep-alive。
- Go 保留：envelope 防御校验、任务创建（`GenerationJob`）、等待/超时语义、OpenAI JSON/SSE 格式化、b64_json 转换与媒体大小限制、generations 查询。
- `GATEWAY_ENABLED=false`（默认）走 legacy 路径；同路由内分支，不复制路由文件。
- 禁止把公开 Go ingress、用户域或 Web 生成入队并入网关范围。

## 3. Envelope 契约

- 事实来源 `contracts/gateway/v1/envelope.json`；Node 与 Go 共同消费 fixtures，不复制两份常量。
- 必填：`schemaVersion=1`、`endpoint`（4 个生成端点）、`jobId`、`issuedAt`、`auth{apiKeyId,userId}`、`billing{creditsSpent,charged}`、`provider{channelId,channelModels,defaultModel,providerMode}`、`payload{count,generationType,model,prompt,moderation,outputFormat,quality,size}`。
- 签名：`HMAC-SHA256(AUTH_SECRET, rawBody)`，header `X-Gateway-Signature`（hex）。Go 常量时间比较，失败返回 401 `GATEWAY_SIGNATURE_INVALID`。
- 防重放：`issuedAt` 超出 `GATEWAY_SIGNATURE_SKEW_SECONDS`（默认 300s）窗口拒绝。
- envelope 不携带渠道密钥/baseUrl；Worker 领取 job 后自行从 DB 解密渠道。

## 4. 幂等与不确定状态

- `jobId` 由 Next 生成（`randomUUID`）并作为幂等键；Go `INSERT ... ON CONFLICT (id) DO NOTHING` 后回读，同 `jobId` 重放不双创建；跨 API Key 复用返回冲突。
- 任务 FAILED 后不自动退款/重试；客户端通过 generations 查询获取终态。
- 请求超时/连接中断不取消已 handoff 任务；积分补偿遵循第 5 节。

## 5. 计费与退款补偿

- 顺序：认证 → 限流 → 解析/校验 → 渠道解析 → 预扣积分 → 上传参考图 → envelope → 转发。
- Go 明确失败且 job 未创建（4xx/5xx、DB 无该 jobId）→ Next 补偿退款（increment）。
- Go 超时（504 `GENERATION_WAIT_TIMEOUT`）或连接中断且 job 已存在 → 不退款，返回“稍后查询”语义。
- 预扣只发生在首次转发前；同一 `jobId` 的重试由 Go 幂等兜底，不重复扣费。

## 6. 响应格式化

- images：`{ created, data:[{url|b64_json,width,height}], generation_id }`；`b64_json` 由 Go 下载 URL 转换，上限 25MB，兼容开发期 data URL fallback。
- chat completions：非 stream JSON；stream 由 Go 生成 SSE（chunk role/content/stop + `[DONE]`）；失败时即使请求 stream 也返回 JSON 错误。
- responses：非 stream JSON；stream 返回 SSE（`response.created` → `response.output_item.done` → `response.completed` + `[DONE]`）；失败时 stream 返回 SSE `response.failed`。
- generations 查询：按 `apiKeyId + clientSource=API` 校验归属，非本人返回 404。

## 7. 灰度与回滚

- `GATEWAY_ENABLED` 默认 false、生产默认 false；先灰度再全量。
- 回滚：开关关闭立即恢复 Next legacy 路径；DB schema 无变更，已创建 job 继续由 Worker 执行，可经 legacy 查询读取，无孤儿数据。
- 旧 Node 生成器删除必须独立提交，删除前全仓搜索确认生产引用与回滚依赖为零。
- 不做 shadow 双写；禁止双重提交真实生成任务。

## 8. 验证入口

```powershell
pnpm verify:gateway:ts
pnpm verify:gateway:go
pnpm verify:gateway:db      # 复用 disposable PostgreSQL runner
```

- 仓库内验证用 disposable PostgreSQL + mock/httptest；真实 Zeabur/上游/S3 验证需用户授权，单独记录。
- `GATEWAY_*` 环境变量与 `WORKER_INTERNAL_URL` 遵循 `contracts/runtime/v1/environment.json` 单一契约，owner 外禁止直接读取。
