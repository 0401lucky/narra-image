# 统一媒体存储与提示词同步执行计划

## 0. 前置与全局约束

- 本任务在 `main@14a0018` 之上执行；父任务 `08-07-go-migration-audit`，依赖 `worker-contracts`、`release-hardening` 已归档完成。
- 所有 schema 变更 additive；所有环境变量先写 `contracts/runtime/v1/environment.json` 再同步 loader。
- 每步完成即记录到 `verification/`；真实 S3/Zeabur/定时环境验证与仓库内模拟测试分开标注，需用户授权。

## 1. 媒体阶段

### 1.1 存储策略（图片/视频强制语义）

- [ ] `worker/internal/worker/storage.go`：`PersistImage` 生产环境（`NODE_ENV=production` 或 `APP_URL` 非 loopback 显式值）拒绝 data URL fallback（即使 `ENABLE_LOCAL_IMAGE_FALLBACK=true`），返回明确错误；非生产仅在显式 fallback 时允许。
- [ ] `PersistVideo`：无对象存储直接返回错误（不再由调用方回退上游 URL）；`buildVideoResult` 删除“无 S3 直接用渠道 URL”分支。
- [ ] 返回带存储形态：Persist 成功后带出 `(url, mediaStorage, storageKey)`；`generation.go`/`video.go` 落库时写入。
- [ ] 测试：`storage_test.go`/`generation_test.go`/`video_test.go` 覆盖 生产拒绝 fallback、视频无 S3 失败、S3 成功带形态。

### 1.2 存储元数据（additive migration）

- [ ] `prisma/schema.prisma`：`GenerationImage`/`GeneratedVideo` 加 `mediaStorage String?`、`storageKey String?`。
- [ ] 新增 migration（additive，带默认值/可空），命名遵循现有 `YYYYMMDDHHMMSS_*` 约定。
- [ ] 契约：`contracts/generation/v1/scenarios/media.json` 补 `mediaStorage`/`storageKey`（可空）与三种形态 URL 样例。
- [ ] 两端 conformance：TS/Go 测试读取同一 media fixture，断言字段与样例一致。

### 1.3 历史兼容与回填

- [ ] `worker/cmd/backfill-media/main.go`：扫描 `mediaStorage IS NULL` 且 `data:` 前缀（可选 http 图片）→ 解码/下载 → 转存 S3 → 事务内更新；`--dry-run`/`--limit`/按 `(jobId,id)` 分批；幂等（已处理行 `mediaStorage != NULL` 跳过）。
- [ ] 回填测试：disposable DB + 模拟 S3，重复执行不重复转存。
- [ ] 前端 URL 契约不变验证：`GenerationImage.url` 三种形态在现有读取路径均可展示。

## 2. 提示词阶段

### 2.1 权威来源清单

- [ ] 新增 `contracts/prompts/v1/default-sources.json`（6 来源 + version）。
- [ ] `worker/internal/worker/prompts.go`：`defaultPromptSources` 改从 manifest 读取；`ensureDefaultPromptSources` 基于 manifest upsert。
- [ ] Go 测试断言 manifest 完整性（字段齐全、slug 唯一、parser 合法）。
- [ ] 删除 `src/lib/prompts/source-config.ts`、`src/lib/prompts/parser.ts`（独立提交，便于恢复）。
- [ ] `src/lib/prompts/service.ts` 移除同步实现（`syncPromptSource`/`syncAllPromptSources` 改为转发调用），保留读库/改 enabled。

### 2.2 Worker internal 端点与 Node 转发

- [ ] `worker/internal/worker/server.go`：`POST /internal/prompt-sync`，Bearer token 鉴权（定版：复用 `WORKER_METRICS_TOKEN` 或新增 `WORKER_INTERNAL_TOKEN`，写入环境契约），body `{sourceId?}` → SyncAll/SyncSource，返回逐来源结果。
- [ ] Node：`src/app/api/admin/prompt-sources/sync/route.ts` 校验 admin 后调用 `WORKER_INTERNAL_URL/internal/prompt-sync`（带 token），失败返回明确错误；`src/lib/env.ts` 增加所需变量。
- [ ] 测试：Go handler 鉴权/参数/错误；Node 转发成功/失败/超时路径。

### 2.3 并发锁、部分失败与调度

- [ ] `prompts.go`：`SyncSource` 事务内 `pg_try_advisory_xact_lock`（按来源 id），拿不到返回“正在同步”；`SyncAll` 逐来源独立执行并聚合结果，单个失败不中断。
- [ ] Worker scheduler：goroutine + ticker，`PROMPT_SYNC_ENABLED`（默认 false）时按 `PROMPT_SYNC_INTERVAL`（默认 24h）对 `isEnabled` 来源 SyncAll；与 manual/admin 共用 `PromptSyncer`。
- [ ] 测试：并发触发只执行一次、部分来源失败聚合、scheduler 开关与间隔。

### 2.4 环境变量契约

- [ ] `contracts/runtime/v1/environment.json`：新增 `PROMPT_SYNC_ENABLED`、`PROMPT_SYNC_INTERVAL`（及 2.2 定版的 internal token 变量）。
- [ ] `worker/internal/worker/config.go`、`src/lib/env.ts`、`.env.example`、README 同步。

## 3. 全局验证与质量闸门

- [ ] `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test` 通过。
- [ ] `go -C worker vet ./...`、`go -C worker test -count=1 -timeout=50s ./...`、`go -C worker build ./...` 通过。
- [ ] `pnpm verify:worker-contracts:ts`、`:go`、`:db` 通过（media fixture 兼容）。
- [ ] 全仓搜索新增 schema/config 变量的所有消费者并同步（Node、Go、Compose、README、测试）。
- [ ] `git diff --check` 通过；无无关用户改动被覆盖。
- [ ] 验证记录写入 `.trellis/tasks/08-07-media-sync-boundary/verification/`；真实 S3/CDN/定时环境证据单独标注。

## 4. 验收矩阵（对应 PRD）

| PRD 验收 | 覆盖点 |
|----------|--------|
| 图片/视频有可验证持久化策略，失败不静默写不可用地址 | 1.1 生产强制 + 失败语义 + 测试 |
| Node/Go 不再维护两套 parser/manifest；单一实现有版本或契约测试 | 2.1 manifest + 删除 Node parser + 契约测试 |
| 手动/后台/定时均幂等，来源状态可见 | 2.2/2.3 锁 + 聚合 + PromptSource 状态 |
| 断网/重复/超时/部分失败可恢复，无重复/孤儿记录 | 2.3 + replace 幂等测试 |
| 验证记录区分仓库内模拟与真实环境证据 | 3 最后一行 |

## 5. 风险文件与回滚点

- 高风险文件：`worker/internal/worker/storage.go`、`video.go`、`generation.go`、`prompts.go`、`server.go`、`prisma/schema.prisma`、`src/app/api/admin/prompt-sources/sync/route.ts`。
- 回滚点：媒体策略由配置控制（恢复旧配置即回滚）；删除 Node parser 独立提交；`PROMPT_SYNC_ENABLED` 一键关闭调度；migration 全部 additive 可保留。
- 顺序约束：媒体阶段（1.x）完成后才允许依赖它的网关任务读取媒体字段定版；提示词阶段（2.x）可独立验收。
