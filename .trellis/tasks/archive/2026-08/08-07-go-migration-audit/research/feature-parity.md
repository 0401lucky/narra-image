# Research: Go Worker 迁移功能对齐审计

- Query: 核对 Go Worker 迁移后与 Next.js/旧 TypeScript 生图链路的功能对齐、行为差异和残留重复实现。
- Scope: mixed（指定 API、生成服务、旧 provider 实现、Go worker；辅以内置视频设计契约）
- Date: 2026-08-07

## Findings

### 已迁移并基本对齐

1. **网页生成已交给 Go Worker。** `src/app/api/generate/route.ts:38-51` 读取并校验所选渠道是否存在/启用，`route.ts:151-189` 创建 `PENDING`、写入 `providerChannelId`、参考图 URL，并设置 `workerManaged=true`。Go 在 `worker/internal/worker/worker.go:165-201` 只领取这类任务，在 `worker.go:278-315` 按视频/图片分派并回写终态。

2. **OpenAI 兼容 API 的四个入口均改为入队。** `src/app/v1/images/generations/route.ts:1-32`、`images/edits/route.ts:1-32`、`responses/route.ts:8-30`、`chat/completions/route.ts:8-30` 都调用 `runExternalGeneration()`；`src/lib/generation/external-api.ts:169-204` 创建 API 任务并预扣积分，`external-api.ts:233-259` 上传参考图后开放 Worker。路由层仍负责认证、解析和响应格式化，符合“Next 外壳 + Go 执行”的迁移边界。

3. **图片参数大体保持原语义。** 旧 TS 在 `src/lib/providers/generate-images.ts:142-188` 区分 Responses、图生图和文生图，图生图固定 `n=1`，文生图透传 `count`、`negative_prompt`、`seed`、`moderation`；Go 对应实现位于 `worker/internal/worker/generation.go:66-106`、`generation.go:122-166`。两端都支持输出格式/压缩/质量（TS `:134-138`，Go `:367-375`），并在 `b64_json` 或 URL 结果后持久化、探测尺寸（TS `:198-214`，Go `:319-345`）。

4. **Responses 图片工具与 Anyrouter 兼容逻辑已迁移。** TS 的 Responses 请求、SSE 收集和“必须 stream”重试在 `generate-images.ts:225-371`；Go 对应在 `generation.go:175-300`，包括 `Idempotency-Key`、Anyrouter 头和 stream fallback。两端都能把 Responses 输出归一化为 `b64_json` 再进入统一存储流程。

5. **视频主链路已由 Go 实现。** `worker/internal/worker/video.go:63-76` 执行提交→轮询→下载/存储，`video.go:127-161` 兼容 `/videos/generations` 同步接口；`worker.go:286-299` 将视频任务接入同一 Worker 事务与退款路径。

### 未对齐或高风险行为

1. **固定渠道未校验模型归属（高风险）。** 网页入队只检查渠道存在/启用（`src/app/api/generate/route.ts:40-51`），没有验证请求模型是否在 `channel.models` 或等于默认模型。Go 的 `channelByID()` 仅按 id/isActive 查询 `baseUrl/apiKey/defaultModel`（`worker/internal/worker/worker.go:391-398`），随后 `scanChannel()` 直接采用任务传入模型（`:426-440`）。因此可把任意模型发送到用户指定渠道，或在配置漂移时产生错误计费/路由。

2. **固定渠道失效后会静默降级到其他渠道（高风险）。** `resolveProvider()` 在 `channelByID` 找不到后继续尝试按模型、首个活动渠道和环境变量回退（`worker/internal/worker/worker.go:355-389`）。这与 Next 入队对无效渠道直接返回 400 的语义不一致，可能导致用户选择的渠道与实际请求渠道不一致。

3. **`WORKER_MAX_ATTEMPTS` 目前没有重试效果（中高风险）。** Worker 领取时只筛选 `PENDING`（`worker/internal/worker/worker.go:165-191`）；过期 `PROCESSING` 任务由 `failExpiredProcessingJobs()` 直接失败退款，注释明确“不再依赖 attemptCount 自动重试”（`worker.go:681-722`）。配置仍在 `worker/internal/worker/config.go:68`，容易造成运维误判或文档漂移。

4. **外部 API 请求取消/等待超时后，已交给 Worker 的任务仍继续执行（中高风险）。** `runExternalGeneration()` 在 `external-api.ts:257` 设置 `handedToWorker=true`，异常处理仅在 `!handedToWorker` 时退款（`:265-271`）；等待超时只返回“稍后查询”提示（`:11-13、116-159`）。当前没有取消任务或释放积分的路径，需确认这是产品契约还是队列/积分风险。

5. **模型分流规则存在边界差异（中风险）。** TS 规则为 `/(^|\\/)gpt-5(?:[.\\-_]|$)/`（`src/lib/providers/model-catalog.ts:42-45`），Go 使用 `HasPrefix("gpt-5")` 或包含 `/gpt-5`、`gpt-5.`（`worker/internal/worker/generation.go:601-605`）。例如 `gpt-5x` 可能在两端选择不同 API。

6. **图生视频参考图格式未完全落实设计契约（中风险）。** Go 只在 JSON 中发送公开 URL `input_reference`（`worker/internal/worker/video.go:79-103`）；设计文档允许 multipart `input_reference` 或 base64（`docs/superpowers/specs/2026-06-01-video-workspace-design.md:135-146`）。现有测试主要覆盖失败提示，未证明目标渠道的成功 multipart/base64 兼容。

7. **视频封面字段实际上为空（中风险）。** `VideoResult` 定义了 `PosterURL`（`worker/internal/worker/video.go:17-24`），但 `buildVideoResult()` 只设置 URL、时长和尺寸（`video.go:207-247`）；`completeVideoJob()` 虽写入 `posterUrl`（`worker/internal/worker/worker.go:542-582`），通常收到空值。前端若依赖封面将只能回退到视频首帧。

### 重复实现与测试盲区

- 旧 `src/lib/providers/generate-images.ts` 仍保留完整 SDK 调用、Responses 解析和图片存储逻辑（入口 `:96`），但生产引用搜索仅见该文件自身及 `src/tests/unit/generate-images-size.test.ts`；`src/lib/providers/resolve-provider.ts` 也主要被 provider 配置测试引用。迁移后继续保留会造成误调用和双端行为漂移，应明确标为兼容层/测试专用或删除。
- 外部 API 单测把 `runExternalGeneration`、数据库、Worker 状态查询全部 mock（`src/tests/unit/external-generation-service.test.ts:1-55`、`:118-203`；`external-v1-routes.test.ts:1-34`），能验证入队字段和响应格式，但没有真实 Go/数据库/渠道的端到端覆盖；上述模型归属、禁用渠道降级、视频参考图契约尚未被测试锁定。

## 风险排序

1. **高：** 固定渠道不校验模型；渠道失效静默回退。
2. **中高：** 超时/取消后的任务与积分生命周期；配置的最大尝试次数与实际无重试。
3. **中：** TS/Go 模型识别边界；图生视频参考图协议；视频 poster 为空。
4. **维护性：** 旧 TS provider 实现与 Go 实现并存，缺少跨实现契约测试。

## 需进一步验证

- 增加集成测试：固定 `providerChannelId` 时模型不在渠道列表应拒绝；渠道被停用/删除时任务应失败而非换渠道。
- 明确 `WORKER_MAX_ATTEMPTS` 的产品决策：实现可观测重试，或移除/改名配置并同步部署文档。
- 为外部 API 的 Abort/超时定义取消、退款和查询语义，并覆盖 Worker 已领取及未领取两种状态。
- 用同一组模型 ID（含 `gpt-5x`、带斜杠/版本后缀）对比 TS/Go 分流结果。
- 针对目标视频渠道添加成功的 JSON URL、multipart、base64 参考图测试，并验证 poster 下载/存储及 `posterUrl` 序列化。

## Files found

- `src/app/api/generate/route.ts`：网页生成参数校验、积分预扣、任务入队。
- `src/lib/generation/external-api.ts`：外部 API 任务创建、参考图上传、等待与退款边界。
- `src/app/v1/images/generations/route.ts`、`src/app/v1/images/edits/route.ts`、`src/app/v1/responses/route.ts`、`src/app/v1/chat/completions/route.ts`：OpenAI 兼容入口。
- `src/lib/providers/generate-images.ts`：迁移前 TypeScript 生图实现（残留）。
- `worker/internal/worker/worker.go`：任务领取、渠道解析、图片/视频执行、终态与退款。
- `worker/internal/worker/generation.go`：Go 图片请求构造、Responses/SSE、结果归一化。
- `worker/internal/worker/video.go`：Go 视频提交、轮询、存储与结果字段。
- `src/lib/providers/model-catalog.ts`：TypeScript 模型分流规则。
- `docs/go-backend-migration-plan.md`：迁移目标与边界说明。
- `docs/superpowers/specs/2026-06-01-video-workspace-design.md`：视频参考图、封面和结果契约。

## Code patterns

- Next 入队 → Go 领取：`src/app/api/generate/route.ts:151-189` → `worker/internal/worker/worker.go:165-201`。
- 外部 API 入队与 handoff：`src/lib/generation/external-api.ts:169-204、233-271`。
- 图片三路分派：`worker/internal/worker/generation.go:66-106、122-194`。
- Responses Anyrouter stream fallback：`worker/internal/worker/generation.go:274-300`；旧实现 `src/lib/providers/generate-images.ts:271-371`。
- 渠道回退链：`worker/internal/worker/worker.go:355-389`。
- 视频结果写回：`worker/internal/worker/video.go:207-247`、`worker/internal/worker/worker.go:542-582`。

## External references

- 项目迁移计划：`docs/go-backend-migration-plan.md`（内部文档，未在本轮联网核对第三方 API 版本）。
- 视频设计契约：`docs/superpowers/specs/2026-06-01-video-workspace-design.md:135-146、173-218`。
- OpenAI 兼容 `/images/*`、`/responses`、`/videos` 的字段语义以代码当前适配为准；供应商版本和网关行为尚未取得独立外部证据。

## Related specs

- `.trellis/spec/guides/cross-layer-thinking-guide.md`：跨层数据流与契约核对。
- `.trellis/spec/guides/code-reuse-thinking-guide.md`：迁移后重复实现与复用审计。
- `.trellis/spec/frontend/quality-guidelines.md`：API 返回与前端消费的质量约束（本轮未扩展前端页面扫描）。

## Caveats / Not Found

- 本轮按父代理要求仅审计指定 API、生成服务、旧 provider 和 Go worker/video 文件；未重新扫描 Compose、prompt-sync、健康端点或其他前端页面。
- 没有执行真实第三方渠道请求，也没有修改产品代码、spec、配置或 Git；结论基于静态代码与现有单测 mock。
- “旧 TS 实现无生产调用”来自生产引用搜索，仍需在删除前通过构建/运行时入口和部署脚本做最终确认。
