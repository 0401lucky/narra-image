# Journal - 0401lucky (Part 1)

> AI development session journal
> Started: 2026-08-07

---



## Session 1: 完成生成 Worker 跨层契约

**Date**: 2026-08-07
**Task**: 完成生成 Worker 跨层契约
**Branch**: `main`

### Summary

完成 GenerationJob/GenerationAttempt v1 契约、Node 与 Go 生命周期和退款保护、共享 fixtures、disposable PostgreSQL 迁移及跨运行时验证；默认关闭生产 v1，未部署、未删除旧实现。

### Git Commits

| Hash | Message |
|------|---------|
| `d48268a` | (see git log) |
| `fb3ae68` | (see git log) |
| `82d2aeb` | (see git log) |

### Status

[OK] **Completed**

---

## Session 2: 固化生产迁移与可观测部署（release-hardening 收尾）

**Date**: 2026-08-08
**Task**: release-hardening（P0）
**Branch**: `main`

### Summary

接续 gpt 中断的工作：补齐阶段 4 缺口（verify-e2e.mjs 执行器 + GitHub Actions），修复遗留回归，跑通全部验证，固化 spec 并记录验证证据。

### 完成项

- 修复 `admin-generations-page.test.tsx`（contract v1 FAILED 分支未同步）与 `generation-bubble.tsx`（渲染期读 ref）。
- 新增 `scripts/verify-e2e.mjs`：6 场景（embedded/dedicated 2 Worker/拓扑冲突/schema 缺失恢复/DB 断连恢复/失败传播）+ owner 校验清理；修复 compose down 对 profile 服务不清理的残留问题（容器/网络兜底强删）。
- 新增 `.github/workflows/verify.yml`：三个 job 调用仓库内 wrapper，E2E/migrations job 预拉 postgres 镜像。
- 修复 `Dockerfile` builder env（APP_URL localhost 触发生产校验）；verify-ci vitest 独立 300s 截止；postgres-runner 截止 150s；generator-studio-feedback 发送按钮竞态。
- 全量验证通过：`verify:ci`、`verify:migrations`、`verify:e2e`、`verify:worker-contracts:db`、两个 `compose config`、`git diff --check` 全部 exit 0。
- 新增 `.trellis/spec/operations/release-hardening.md` 契约。

### Verification

详见 `.trellis/tasks/08-07-release-hardening/verification/2026-08-08-release-hardening.md`

### Status

[OK] 验证全绿；待提交。

### Git Commits

| Hash | Message |
|------|---------|
| `03d792f` | feat(ops): 固化生产迁移与可观测部署 |
| `e4281fb` | chore(trellis): 纳入 Trellis 平台适配与项目指南 |

本地个人文件（.claude/settings.local.json、operations-log、context-summary）已加入 .gitignore，未提交。

## Session 2: 统一媒体存储与提示词同步

**Date**: 2026-08-08
**Task**: 08-07-media-sync-boundary(统一媒体存储与提示词同步)
**Branch**: `main`

### 完成项

- **规划**:补全 prd.md(含 3 项已确认决策:视频无 S3 直接失败、提示词封面不转存、定时默认关闭)、design.md(媒体+提示词两阶段)、implement.md(有序清单+验收矩阵+回滚点);填充 implement.jsonl/check.jsonl 各 4 条。
- **媒体阶段**:生产强制 S3/R2(`PersistImage` 生产拒绝 data URL fallback;`PersistVideo` 无对象存储直接 RESULT_PERSIST_FAILED,删除上游 URL 回退分支);`GenerationImage`/`GeneratedVideo` 加 additive 列 `mediaStorage`/`storageKey`(migration `20260807140000`);media.json 契约补存储形态与 B64/S3/UPSTREAM 样例;新增 `worker/cmd/backfill-media` 回填工具(幂等、--dry-run/--limit/--include-http)。
- **提示词阶段**:新增 `contracts/prompts/v1/default-sources.json` 唯一权威清单;Go `PromptSyncer` 为唯一实现(manifest 读取 + advisory 锁 + 逐来源聚合);删除 Node `parser.ts`/`source-config.ts`;admin 同步改转发 Worker `POST /internal/prompt-sync`(Bearer 复用 WORKER_METRICS_TOKEN);Worker scheduler(PROMPT_SYNC_ENABLED 默认关、INTERVAL clamp [60,604800]s);环境契约新增 PROMPT_SYNC_ENABLED/INTERVAL/PROMPT_SOURCES_DIR。
- **check 修复**:Dockerfile 两处补 COPY contracts/ + promptSourcesRoot() 候选路径探测(CRITICAL);PromptSyncResult 补 json tag + handler 成功路径测试(WARNING);env.ts 删 PROMPT_SYNC_* 死代码(WARNING);config.go clamp + backfill 计数修复(LOW)。
- **spec 更新**:新增 `.trellis/spec/operations/media-storage.md`、`prompt-sync.md`,更新 operations/index.md 索引。

### Verification

详见 `.trellis/tasks/08-07-media-sync-boundary/verification/media-sync-boundary.md`

- tsc/lint/vitest(75 文件 355 用例)、go vet/test/build、verify:worker-contracts:ts/:go/:db(disposable PG)、两个 compose config、git diff --check 全部通过。
- 未覆盖:真实 S3/R2 读写、真实定时同步、生产大 base64 批量回填演练(需用户授权)。

### Status

[OK] 验证全绿;待提交。

### Git Commits

| Hash | Message |
|------|---------|
| (待提交) | feat(media): 统一媒体存储与提示词同步 |

## Session 3: 引入 Go 生成网关并清理旧实现

**Date**: 2026-08-08
**Task**: 08-07-go-api-gateway(引入 Go 生成网关并清理旧实现)
**Branch**: `main`

### 完成项

- **规划**:补齐 design.md(同步代理形态、envelope 契约、Next/Go 边界、计费补偿、回滚)、implement.md(5 阶段)、implement.jsonl/check.jsonl(6+7 条)。
- **契约**:`contracts/gateway/v1/envelope.json`(HMAC-SHA256/AUTH_SECRET 签名、endpoint 枚举、必填字段、limits)+ `scenarios/envelope.json`(合法 3 + 非法 5 样例)。
- **Go 网关**:`gateway.go`(验签/防御校验/5 端点注册/错误响应)、`gateway_enqueue.go`(job 创建 ON CONFLICT 幂等 + 归属校验)、`gateway_wait.go`(轮询/超时不退款)、`gateway_response.go`(images JSON/b64+25MB、chat/responses SSE、错误码映射、查询格式化);`config.go` 新增 3 个 GATEWAY_* 配置。
- **Next 薄代理**:`gateway-contract.ts`(无副作用共享常量)+ `gateway-client.ts`(isGatewayEnabled/envelope 构造+签名/转发/退款补偿/查询转发);5 个 `/v1` 路由接入 `GATEWAY_ENABLED` 开关(legacy 保留)。
- **环境契约**:`GATEWAY_ENABLED/POLL/SIGNATURE_SKEW/WAIT` 4 变量入 environment.json + env.ts + .env.example + README,契约测试通过。
- **验证**:`verify:gateway:ts/go/db` wrapper + 纳入 verify:ci 固定清单;Go 单测 + disposable PG 集成(含完整 POST handler 全链路)+ TS 契约/gateway-client/路由开关测试。
- **清理**:删除 `generate-images.ts`、`resolve-provider.ts` 及仅为其存在的 2 个测试(删除前全仓搜索确认生产引用为零)。
- **spec 更新**:新增 `operations/gateway.md`,更新 operations/index.md、generation-worker-contracts.md、docs/go-backend-migration-plan.md。

### Verification

详见 `.trellis/tasks/08-07-go-api-gateway/verification/gateway.md`

- tsc/lint(0 errors)/全量 vitest(75 文件 358 用例)/verify:gateway 三模式/go vet/test/build/next build/compose 两文件/git diff --check 全部通过。
- 未覆盖:真实 Zeabur 灰度切换、真实 S3 b64_json 下载、真实上游完整链路(需用户授权)。

### Status

[OK] 验证全绿;功能与旧实现删除分两个 commit 待提交。
