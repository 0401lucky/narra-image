# Go 生成网关执行计划

## 1. 执行原则

- 先契约与 Go 网关，再 Next 薄代理，再集成灰度验证，最后删除旧实现；每阶段可独立验证。
- 开关默认关闭，legacy 路径保持现状；所有切换用显式功能开关，禁止静默回退。
- 删除旧 Node 生成器前必须全仓搜索确认生产引用与回滚依赖为零，删除独立提交。
- 不自动部署生产；不修改既有 `GenerationJob` 非 additive 结构；数据库危险操作必须另行确认。

## 2. 阶段 A：契约与 Go 网关（骨架 + 单测）

- [ ] 新建 `contracts/gateway/v1/envelope.json`（envelope 结构、endpoint 枚举、必填字段、签名规范）与 `contracts/gateway/v1/scenarios/*.json`（images/edits/responses/chat 的合法与非法样例）。
- [ ] `worker/internal/worker/config.go` 新增 `GATEWAY_WAIT_TIMEOUT_SECONDS`（默认 900）、`GATEWAY_POLL_INTERVAL_MS`（默认 1000）、`GATEWAY_SIGNATURE_SKEW`（默认 300s）。
- [ ] 新建 `worker/internal/worker/gateway.go`：envelope 解析、`HMAC-SHA256(AUTH_SECRET)` 验签（常量时间比较）、防御校验、路由注册、错误响应。
- [ ] 新建 `worker/internal/worker/gateway_enqueue.go`：按 envelope 创建 `GenerationJob`（`ON CONFLICT (id) DO NOTHING` 幂等 + 归属校验）。
- [ ] 新建 `worker/internal/worker/gateway_wait.go`：轮询 DB 等待 SUCCEEDED/FAILED/超时。
- [ ] 新建 `worker/internal/worker/gateway_response.go`：images JSON（url/b64_json + 25MB 限制）、chat/responses SSE、错误码映射（消费 `contracts/generation/v1/errors.json`）、`generations` 查询格式化。
- [ ] `server.go` 注册 5 个 `/internal/gateway/v1/*` 端点（Bearer 鉴权复用 `WORKER_METRICS_TOKEN` 语义或独立 token，与 `/internal/prompt-sync` 一致）。
- [ ] 新增 `gateway_test.go`：验签正反例、envelope 校验、幂等重放、创建→等待（disposable PG）、格式化、查询归属、超时。

验证：

```powershell
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./...
go -C worker build ./...
```

审查闸门：envelope 不含密钥/baseUrl；同 jobId 重放不双创建；超时不退款不取消已 handoff 任务。

## 3. 阶段 B：Next 薄代理与开关

- [ ] `contracts/runtime/v1/environment.json` 新增 `GATEWAY_ENABLED`（默认 false、`productionRolloutDefault:false`）及阶段 A 三个 Go 侧变量；同步 `src/lib/env.ts`、`README`/`.env.example`。
- [ ] 新建 `src/lib/generation/gateway-client.ts`（server-only）：`isGatewayEnabled`、`buildGatewayEnvelope`（HMAC 签名）、`forwardGeneration`（JSON 直返 + SSE 流透传）、`forwardGenerationQuery`、`gatewayErrorToOpenAi`、`refundPrechargedCredits`。
- [ ] 接入 5 个路由：`images/generations`、`images/edits`、`responses`、`chat/completions`、`generations/[id]`；`GATEWAY_ENABLED=false` 走 legacy 路径，同路由内分支不复制文件。
- [ ] images JSON 的 keep-alive UA 逻辑（`openAiImageJsonResponse`）保留在 Next 透传层。
- [ ] 新增 `gateway-client.test.ts`（签名、URL、错误映射、退款补偿）与路由开关测试；legacy 回归测试全绿。

验证：

```powershell
pnpm exec tsc --noEmit
pnpm test
```

审查闸门：预扣只发生一次；Go 明确失败且未创建 job 时退款补偿正确；SSE 字节流原样透传不被重构。

## 4. 阶段 C：集成验证与灰度

- [ ] `contracts/gateway/v1/` fixtures 由 TS 与 Go 测试共同消费（同 `verify:worker-contracts` 消费模式）。
- [ ] 新增 disposable PG 全链路 E2E wrapper（复用现有 runner 模式，如 `pnpm verify:gateway:e2e`）：Next 路由（网关开）→ envelope → Go 网关 → 创建 job → Worker 执行 → Go 格式化 → Next 透传。
- [ ] E2E 矩阵：images JSON（url/b64_json）、images edits、responses（JSON+SSE+失败 SSE）、chat（JSON+SSE）、超时、错误码、`generations` 查询、开关回滚（关回 legacy 后同一 jobId 仍可查询、不退款）。

验证：

```powershell
pnpm lint
pnpm test
pnpm build
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./...
go -C worker build ./...
docker compose config --quiet
docker compose -f docker-compose.e2e.yml config --quiet
pnpm verify:gateway:e2e
```

审查闸门：灰度检查逐接口与 legacy 一致；回滚点验证（开关关闭恢复 Next 入口）通过。

## 5. 阶段 D：删除旧 Node 生成器（独立提交）

- [ ] 全仓搜索旧直连实现生产引用（`generate-images.ts`、`resolve-provider.ts` 及仅为其存在的兼容代码/测试）。
- [ ] 确认生产引用与回滚依赖为零后，独立提交删除：预期 `src/lib/providers/generate-images.ts`、`src/lib/providers/resolve-provider.ts`、`src/tests/unit/generate-images-size.test.ts`、`src/tests/unit/provider-config.test.ts`（以实际引用搜索结果为准）。
- [ ] 删除后再次全仓搜索（含构建产物/路由入口/脚本），确认无残留引用。
- [ ] 删除提交保持独立、可单独回滚。

验证：

```powershell
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./...
go -C worker build ./...
docker compose config --quiet
git diff --check
```

审查闸门：删除后构建与全量测试通过；git 历史中删除提交可独立恢复。

## 6. 阶段 E：spec 更新与提交

- [ ] 更新 `.trellis/spec/`：新增 `operations/gateway.md`（envelope、签名、开关、退款补偿、回滚），更新 `operations/index.md`；`frontend/generation-worker-contracts.md` 若受 job 创建主体变化影响则同步修订。
- [ ] 更新 `docs/go-backend-migration-plan.md` 网关迁移状态。
- [ ] 验证记录写入 `verification/`；真实 Zeabur/上游/S3 验证需用户授权，单独标记。
- [ ] 全量验证通过后提交；旧实现删除与功能代码分 commit。

## 7. 回滚点

- 阶段 A/B 内回滚：删除新端点/开关相关代码，legacy 路径不受影响。
- 阶段 C 灰度失败：`GATEWAY_ENABLED=false` 立即恢复 Next 入口；DB schema 无变更，无孤儿数据。
- 阶段 D 删除回滚：`git revert` 该独立提交即可恢复旧生成器与测试。
