# Go 生成网关设计与旧实现清理

## 1. 目标与边界

在 `worker-contracts`、`release-hardening`、`media-sync-boundary` 全部稳定后，把外部 OpenAI 兼容生成的**协议与执行语义**下沉到 Go 内部网关，Next `/v1` 收敛为薄代理，灰度验证通过后删除无生产引用的旧 Node 生成器。

本任务只迁移外部生成 API：`images generations`、`images edits`、`responses`、`chat completions` 与 `generations` 查询。Next 页面/BFF、管理后台、鉴权、API Key、限流、积分扣减和入口 SSRF/输入校验继续保留在 Next。

## 2. 目标形态

```text
外部客户端
    │  OpenAI 兼容 JSON / SSE
    ▼
Next /v1 薄代理（GATEWAY_ENABLED 开关）
    ├─ 认证 requireApiUser
    ├─ 限流 assertApiRateLimit
    ├─ 输入解析/校验 + 媒体大小/SSRF 检查（参考图上传）
    ├─ 渠道解析（built-in-provider）+ 积分预扣
    └─ 构造内部 envelope（HMAC 签名）→ 转发 → 透传 Go 响应
    │
    ▼  loopback（WORKER_INTERNAL_URL，默认 127.0.0.1:8081）
Go 内部生成网关 /internal/gateway/v1/*
    ├─ 验签 + 版本 + 必填字段防御性校验
    ├─ 创建 GenerationJob（workerManaged=true，幂等）
    ├─ 轮询等待完成 / 超时
    ├─ OpenAI JSON / SSE 格式化 + b64_json 转换（含大小限制）
    └─ generations 查询（校验 apiKeyId 归属）
    │
    ▼
PostgreSQL（事实来源）   ──→   Go Worker 领取/执行/写回
```

### Next 保留职责

- API Key 校验、限流、入口 SSRF 与输入/媒体校验、积分预扣与退款补偿。
- 渠道解析与模型归属校验（`getGenerationChannelForModel`）、计费成本计算。
- 参考图上传（`persistGeneratedImage`）后把 URL 放入 envelope。
- 传输层差异化：images JSON 对特定 UA 的 keep-alive 长连接（`openAiImageJsonResponse`）。
- `GATEWAY_ENABLED=false` 时的完整 legacy 路径（现状不变）。

### Go 网关承接职责

- 内部 envelope 的版本、签名、认证结果、计费结果的防御性校验。
- 生成任务的创建（写入 job）、幂等复用与等待/超时语义。
- OpenAI 兼容 JSON / SSE 响应格式化、错误码映射、b64_json 转换与媒体大小限制。
- `generations` 查询的协议格式化。

## 3. 内部 Envelope 契约

契约存放 `contracts/gateway/v1/envelope.json`，Node 与 Go 共同消费同一 fixtures（不复制两份常量）。

### Envelope 结构

```json
{
  "schemaVersion": 1,
  "endpoint": "images.generations | images.edits | responses | chat.completions | generations.get",
  "jobId": "<Next 生成的 cuid>",
  "issuedAt": "RFC3339 UTC",
  "auth": { "apiKeyId": "...", "userId": "..." },
  "billing": { "creditsSpent": 5, "charged": true },
  "provider": {
    "channelId": "...",
    "channelModels": ["gpt-image-2"],
    "defaultModel": "gpt-image-2",
    "providerMode": "BUILT_IN"
  },
  "sourceImageUrls": ["https://..."],
  "payload": {
    "count": 1,
    "generationType": "TEXT_TO_IMAGE | IMAGE_TO_IMAGE",
    "model": "gpt-image-2",
    "prompt": "...",
    "negativePrompt": null,
    "moderation": "auto",
    "outputCompression": null,
    "outputFormat": "png",
    "quality": "auto",
    "seed": null,
    "size": "auto"
  }
}
```

要点：

- **不携带密钥/渠道 baseUrl**：`provider.apiKey/baseUrl` 不进入 envelope；Go Worker 领取 job 时通过 `channelByID` 自行从 DB 加载并解密。envelope 只带渠道身份与模型快照。
- **jobId 由 Next 生成**（cuid）：作为幂等键。Go 按 `id` upsert，重试不会双创建。
- **计费结果**：Next 预扣积分后把 `creditsSpent` 写入 envelope，Go 写入 job 记录；Go 不重复扣分。

### 签名

- 算法：`HMAC-SHA256`，key 为 `AUTH_SECRET`（Next/Go 共享）。
- 传输：HTTP header `X-Gateway-Signature: hex(hmac_sha256(AUTH_SECRET, rawBodyBytes))`，签名覆盖整个原始 body。
- Go 用常量时间比较校验；失败返回 `GATEWAY_SIGNATURE_INVALID`（401）。
- 防重放：`issuedAt` 与 Go 时钟偏差超过 `GATEWAY_SIGNATURE_SKEW`（默认 5 分钟）拒绝；MVP 阶段以 loopback/内网绑定为主，此校验为第二道防御。

### Go 防御性校验（独立于 Next，必须齐全）

- `schemaVersion == 1`；`jobId` 非空且长度合理；`endpoint` 在枚举内。
- `auth.apiKeyId` / `auth.userId` / `billing.creditsSpent >= 0` / `provider.channelId` 非空。
- `payload.model`、`payload.prompt` 非空；`count >= 1`；`sourceImageUrls` 仅允许 `http/https` scheme 且数量 ≤ 10。
- 上述任一失败返回 `GATEWAY_ENVELOPE_INVALID`（400）并结构化日志。

## 4. Go 网关实现

### 端点（注册在现有 Worker HTTP server，`server.go` mux）

```text
POST /internal/gateway/v1/images/generations
POST /internal/gateway/v1/images/edits
POST /internal/gateway/v1/responses
POST /internal/gateway/v1/chat/completions
GET  /internal/gateway/v1/generations/{id}
```

### 新文件

- `worker/internal/worker/gateway.go`：envelope 解析、验签、防御校验、路由注册、错误响应。
- `worker/internal/worker/gateway_enqueue.go`：创建/复用 job（pgx 事务 + `ON CONFLICT (id) DO NOTHING`）。
- `worker/internal/worker/gateway_wait.go`：轮询 DB 等待 SUCCEEDED/FAILED/超时。
- `worker/internal/worker/gateway_response.go`：OpenAI JSON / SSE 格式化、错误码映射、b64_json 转换。
- `worker/internal/worker/gateway_test.go`（含 disposable PG 集成测试）。

### 创建 job

与现有 Next `runExternalGeneration` 的落库字段保持一致（`GenerationJob`）：

`id=jobId`、`userId`、`apiKeyId`、`clientSource=API`、`generationType`、`providerMode=BUILT_IN`、`providerChannelId`、`providerModels=channelModels`、`model`、`prompt`、`negativePrompt`、`size`、`quality`、`outputFormat`、`outputCompression`、`moderation`、`seed`、`sourceImageUrls`、`count`、`status=PENDING`、`creditsSpent`、`contractVersion`、`handoffState`、`workerManaged=true`。

- `workerManaged=true` 直接开放 Worker 领取（参考图 URL 已在 envelope 中，无需二次上传）。
- 幂等：`INSERT ... ON CONFLICT (id) DO NOTHING` 后回读；若已存在则校验 `apiKeyId` 归属一致后按当前状态返回（不重复创建）。

### 等待与超时

- 创建后轮询 `GenerationJob` 至 `SUCCEEDED`/`FAILED`，或超过 `GATEWAY_WAIT_TIMEOUT_SECONDS`（默认 900，与 Next `EXTERNAL_GENERATION_WAIT_TIMEOUT_SECONDS` 对齐）。
- 轮询间隔 `GATEWAY_POLL_INTERVAL_MS`（默认 1000）。
- 超时返回 `GATEWAY_WAIT_TIMEOUT`（带 `generation_id=jobId`），Next 映射为现有“稍后通过 /v1/generations/{id} 查询”语义；不取消已 handoff 任务、不退款。
- 客户端连接中断不取消任务：与现有契约一致，任务继续执行，通过查询获取终态。

### 响应格式化（Go 承接协议）

- **images generations / edits**：`{ created, data: [{ url | b64_json, width, height }], generation_id }`。`b64_json` 由 Go 下载 `GenerationImage.url` 转 base64，沿用 25MB 上限；`url` 格式直接透传。
- **chat completions**：非 stream 返回 JSON；stream 由 Go 生成 SSE（`chat.completion.chunk`：role/content/stop 三段 + `[DONE]`）。任务失败时沿用现状：即使请求 `stream=true` 也返回 JSON 错误。
- **responses**：非 stream 返回 JSON；stream 返回 SSE（`response.created` → `response.output_item.done` → `response.completed` + `[DONE]`）；任务失败时返回 SSE `response.failed`。
- **错误映射**：读取 `contracts/generation/v1/errors.json` fixtures，输出 OpenAI 兼容 `{ error: { code, message, type } }`，status 与现状 `openAiError` 映射一致（auth 401 / rate limit 429 / timeout / contract 400 或 409）。

### 查询端点

- `GET /internal/gateway/v1/generations/{id}`：按 `apiKeyId` + `clientSource=API` 校验归属，返回 `{ id, object, status, created, model, error, images:[{id,url,width,height}] }`，与现状 `generations/[id]/route.ts` 字段一致。不属于该 API Key 返回 404。

## 5. Next 薄代理实现

### 开关与环境

- 新增 `GATEWAY_ENABLED`（boolean，默认 false，`productionRolloutDefault: false`），加入 `contracts/runtime/v1/environment.json`、`src/lib/env.ts`、`README`/`.env.example`。
- 复用已有 `WORKER_INTERNAL_URL` 作为 Go 网关地址。
- Go 侧 `config.go` 新增：`GATEWAY_WAIT_TIMEOUT_SECONDS`、`GATEWAY_POLL_INTERVAL_MS`、`GATEWAY_SIGNATURE_SKEW`（均入环境契约）。

### 新文件

- `src/lib/generation/gateway-client.ts`（server-only）：
  - `isGatewayEnabled()`：读 `env.GATEWAY_ENABLED`。
  - `buildGatewayEnvelope(input)`：构造 envelope + `HMAC-SHA256(AUTH_SECRET, body)` 签名。
  - `forwardGeneration(body, envelope)`：`fetch(WORKER_INTERNAL_URL + /internal/gateway/v1/<endpoint>)`，携带签名 header；JSON 响应直接返回；SSE 响应以流透传。
  - `forwardGenerationQuery(id)`：转发查询。
  - `gatewayErrorToOpenAi(error)`：把 Go 错误响应映射为现有 `openAiErrorPayload` 语义（含 `generation_id`）。
  - `refundPrechargedCredits(user, amount)`：Go 明确失败且未创建 job 时的补偿退款。

### 路由接入

- `images/generations`、`images/edits`：网关开 → 解析/校验/上传参考图/解析渠道/预扣积分 → envelope → 转发；images JSON 的 keep-alive UA 逻辑保留在 Next；失败/退款按第 6 节。
- `responses`、`chat/completions`：同上；`stream=true` 时透传 Go 的 SSE 字节流（不自行重构 SSE）。
- `generations/[id]`：网关开 → 转发查询。
- 所有路由在 `GATEWAY_ENABLED=false` 时走现有 legacy 路径，代码结构上同一路由内分支，禁止复制两份路由文件。

### 计费与退款边界（关键）

- 顺序：`requireApiUser` → 限流 → 解析/校验/上传参考图 → 渠道解析 → 预扣积分（`user.updateMany` decrement，现状逻辑）→ envelope → 转发 Go。
- **Go 明确失败且未创建 job**（4xx 验签/校验失败、5xx 且 DB 无该 job）→ Next 补偿退款（increment）并返回 OpenAI 错误。
- **Go 返回超时/连接中断且无法确定 job 状态** → Next 查 DB（`jobId`）确认：job 已存在则不退款并返回“稍后查询”超时语义；job 不存在则退款并返回错误。
- 同一 `jobId` 的幂等保证 Go 端不双创建；预扣只发生在首次转发前。

## 6. 兼容、灰度与回滚

- `GATEWAY_ENABLED` 默认 false，先灰度再全量；开关切换不改 DB schema（job 模型复用现有 `GenerationJob`）。
- 回滚：`GATEWAY_ENABLED=false` 立即恢复 Next legacy 路径；已创建的 job 继续由 Worker 正常执行，结果可经 legacy 查询读取，无孤儿数据。
- 不做 shadow 双写：父设计明确“不得双重提交真实生成任务”，本任务只做显式开关切换 + 逐接口兼容测试。
- 旧 Node 生成器删除必须独立提交，删除前全仓搜索确认生产引用与回滚依赖为零。

## 7. 测试策略

### Go 侧（disposable PG）

- 验签：正确/缺失/错误 signature、过期 `issuedAt`。
- envelope 防御校验：版本、endpoint、必填字段、count/sourceImageUrls 边界。
- 幂等：同 `jobId` 重放返回同一 job，不双创建。
- 创建→等待：真实 PG + 注入式 worker 完成回调，覆盖 SUCCEEDED/FAILED/超时。
- 格式化：images JSON（url/b64_json）、chat SSE、responses SSE、错误码映射、`GATEWAY_WAIT_TIMEOUT`。
- 查询：归属校验（非本人 404）。

### Next 侧

- `gateway-client` 单测：签名、URL 构造、错误映射、退款补偿。
- 路由开关测试：`GATEWAY_ENABLED` 开/关两种分支（沿用 `external-v1-routes.test.ts` 模式，mock Go 端点）。
- legacy 路径回归：现有 `external-generation-service.test.ts`、`external-v1-routes.test.ts` 不因接入开关而回归。

### 跨实现与 E2E

- `contracts/gateway/v1/` fixtures 由 TS/Go 测试共同消费（同 `verify:worker-contracts` 的消费模式）。
- 新增 disposable PG 全链路 E2E：Next 路由（网关开）→ envelope → Go 网关 → 创建 job → Worker 执行 → Go 格式化 → Next 透传；覆盖 JSON/SSE、超时、错误、查询、开关回滚（关回 legacy 后同一 jobId 仍可查询）。

## 8. 主要权衡

- **同步代理形态**：Go 网关“入队+等待+格式化”，客户端语义与现状完全一致（含超时提示查询），不引入新的异步协议面。
- **jobId 由 Next 生成**：以现有 PK 做幂等键，避免 additive migration 与唯一索引；缺点是 job 创建主体仍是 Go，但 id 分配在 Next（无副作用，纯 id）。
- **预扣在 Next、落库在 Go**：跨进程事务不可行，用“明确失败退款 + 不确定状态查 DB”的补偿语义替代，与现有 `handedToWorker` 边界一致。
- **b64_json 下沉 Go**：把“媒体限制+响应格式化”真正交给 Go；传输层 keep-alive 与 UA 细节仍留 Next。

## 9. 明确不做

- 不迁移 OAuth、Turnstile、用户资料、积分管理后台、页面渲染与 web 生成入队。
- 不把 API Key、限流、积分扣减下沉到 Go（公开 Go ingress 另立任务）。
- 不做 shadow 双写、不新增消息队列、不引入 additive migration（除非实施中发现幂等必须落库，需另行评审）。
- 不在本任务中直接暴露 Go 端口到公网。
