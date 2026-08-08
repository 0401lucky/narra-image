# Go 生成网关验证记录

**Task**: 08-07-go-api-gateway（引入 Go 生成网关并清理旧实现）
**Date**: 2026-08-08
**Branch**: main

## 交付物

### 契约

- `contracts/gateway/v1/envelope.json`：envelope 结构、endpoint 枚举、签名规范（HMAC-SHA256 / AUTH_SECRET / `X-Gateway-Signature`）、必填字段、limits。
- `contracts/gateway/v1/scenarios/envelope.json`：3 个合法端点样例 + 5 个非法边界样例。

### Go 内部生成网关

- `worker/internal/worker/gateway.go`：envelope 解析、验签（常量时间比较）、防御校验、`/internal/gateway/v1/*` 5 端点注册、错误响应。
- `worker/internal/worker/gateway_enqueue.go`：`GenerationJob` 创建（`ON CONFLICT (id) DO NOTHING` 幂等）、apiKeyId 归属校验、查询。
- `worker/internal/worker/gateway_wait.go`：轮询等待 SUCCEEDED/FAILED/超时，超时不取消不退款。
- `worker/internal/worker/gateway_response.go`：images JSON（url/b64_json + 25MB 限制 + data URL 兼容）、chat SSE、responses SSE/JSON、错误码映射（消费 `contracts/generation/v1/errors.json`）、查询格式化。
- `server.go` 注册路由；`config.go` 新增 `GATEWAY_WAIT_TIMEOUT_SECONDS`/`GATEWAY_POLL_INTERVAL_MS`/`GATEWAY_SIGNATURE_SKEW_SECONDS`。

### Next 薄代理

- `src/lib/generation/gateway-contract.ts`：共享常量（无副作用，契约测试消费）。
- `src/lib/generation/gateway-client.ts`：`isGatewayEnabled`、envelope 构造 + HMAC 签名、转发（JSON/SSE 透传）、连接失败/超时的退款补偿（按 DB job 归属判定）、查询转发。
- 5 个 `/v1` 路由接入 `GATEWAY_ENABLED` 开关（legacy 路径保留）。
- `contracts/runtime/v1/environment.json` + `src/lib/env.ts` + `.env.example` + `README` 新增 `GATEWAY_*` 变量。

### 旧实现清理（独立提交）

- 删除 `src/lib/providers/generate-images.ts`、`src/lib/providers/resolve-provider.ts` 及仅为其存在的 `generate-images-size.test.ts`、`provider-config.test.ts`；删除前全仓搜索确认生产引用为零。

## 验证矩阵

| 检查项 | 结果 |
|--------|------|
| `pnpm exec tsc --noEmit` | ✅ |
| `pnpm lint` | ✅（0 errors，11 个既有 warning） |
| 全量 vitest（--testTimeout=30000，排除 worker-contracts-db） | ✅ 75 文件 / 358 用例 |
| `pnpm verify:gateway:ts` | ✅ 30 用例（契约 + gateway-client + 路由开关） |
| `pnpm verify:gateway:go` | ✅ |
| `pnpm verify:gateway:db`（disposable PG runner） | ✅ 含网关 DB 集成测试 |
| `go -C worker vet ./...` | ✅ |
| `go -C worker test -count=1 -timeout=50s ./...` | ✅ |
| `go -C worker build ./...` | ✅ |
| `go -C worker vet -tags workercontractsdb ./...` | ✅ |
| `pnpm build`（Next 生产构建） | ✅ |
| `docker compose config --quiet` | ✅ |
| `docker compose -f docker-compose.e2e.yml config --quiet` | ✅ |
| `git diff --check` | ✅ |

### 覆盖的网关测试

- **Go 单测**：验签正反例（缺失/篡改/大小写）、envelope 防御校验（版本/端点/jobId/时间窗/必填/URL scheme/count/负积分）、路径-端点一致性、查询签名与 api key、data URL→base64、查询格式化、契约错误码映射（coordination_required→409）。
- **Go DB 集成**（disposable PG）：envelope 创建 job（字段/workerManaged/creditsSpent）、同 jobId 幂等复用、跨 API Key 冲突、等待成功（含图片）/失败/超时不改状态、查询归属（非本人 404）、完整 POST handler 全链路（签名→创建→等待→格式化 JSON）。
- **TS 契约**：contract/version/签名规范/endpoint 枚举与路由表一致/必填字段覆盖/合法样例无敏感字段/非法样例存在。
- **gateway-client 单测**：开关读取、签名覆盖原始 body、预扣一次、参考图上传失败退款、Go 明确失败未创建 job 退款、Go 超时已创建 job 不退款、连接失败退款 + 502、查询转发签名。
- **路由网关模式**：images/chat/generations 转发并透传 Go 响应、legacy 不调用（mock）。

## 未覆盖（需用户授权）

- 真实 Zeabur 部署灰度切换（`GATEWAY_ENABLED=true` 生产观察期）。
- 真实 S3/CDN 媒体在 b64_json 路径的下载验证。
- 真实上游渠道下 Worker 执行 → Go 网关格式化 → Next 透传的完整链路（仓库内以 disposable PG + 手动写回模拟）。

## Trellis check 复核与修复

最终 check 子代理复核发现 3 项 CRITICAL 与若干 WARNING，已全部修复并复验：

- **C1 测试未真正执行**：`postgres-runner.ts` 的 `-run 
^(TestWorkerContractsDB|TestGatewayDB)$` 限定导致 `TestGatewayDB` 从未执行 → runner 改为 `^(TestWorkerContractsDB|TestGatewayDB)$`。
- **C2 测试 flaky**：full POST handler 的后台模拟写回分两步产生“已成功但无图”窗口 → 改为单事务（先插图再置 SUCCEEDED），连续多次运行稳定通过。
- **C3 计费漏洞（真实）**：客户端 abort 后无条件退款，与 legacy“handedToWorker 后不退款”矛盾，造成结果+退款白嫖 → `runThroughGateway` catch 统一按 DB 中 job 是否存在判定：job 已存在不退款（返回 504 查询语义），未创建才退款；补 2 个 abort 单测。
- **W1 chat 文本不一致**：Go 缺 legacy 的“生成完成。\n\n”前缀 → 已补。
- **W2 responses 字段不一致 + b64 静默失败**：tool_choice/tools 改为从 envelope 透传（`gateway-client` 传 `body.tool_choice`/`body.tools`，Go 读取）；b64 转换失败改为显式 `GENERATION_IMAGE_B64_FAILED` 错误而非空 result。
- **W3 verify:gateway 冷启动超时**：`GLOBAL_DEADLINE_MS` 57s → 90s。
- **W4 Compose 未注入 GATEWAY_\***：`docker-compose.yml`/`docker-compose.e2e.yml` 的 runtime anchor 补 4 个 GATEWAY_* 变量（默认关闭）。
- **W5 测试缺口**：补 abort（有 job/无 job）、responses 网关开、images Kelivo keep-alive+网关开用例。

修复后复验：`verify:gateway:ts`（34 用例）、`verify:gateway:go`、`postgres-runner`（连续 3 次通过，含 TestGatewayDB）、tsc、lint（0 errors）、全量 vitest（75 文件 362 用例）、go vet/test/build、next build、compose 两文件、`git diff --check` 全部通过。
