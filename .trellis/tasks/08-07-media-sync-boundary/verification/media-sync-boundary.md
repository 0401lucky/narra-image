# 08-07-media-sync-boundary 验证记录

日期：2026-08-07（实现完成）
环境：本地仓库内验证（disposable PostgreSQL + 模拟 S3），未连接真实 S3/CDN/定时环境。

## 1. 已执行验证（全部通过）

| 命令 | 结果 |
|------|------|
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm lint` | 通过（0 errors，仅既有 warnings） |
| `pnpm exec vitest run --exclude worker-contracts-db.test.ts` | 75 文件 / 355 用例通过 |
| `go -C worker vet ./...`（含 `-tags workercontractsdb`） | 通过 |
| `go -C worker test -count=1 -timeout=50s ./internal/worker/...` | 通过 |
| `go -C worker build ./...` | 通过 |
| `pnpm verify:worker-contracts:ts` | 6 文件 / 32 用例通过 |
| `pnpm verify:worker-contracts:go` | 通过 |
| `pnpm verify:worker-contracts:db` | disposable PostgreSQL 全通过（TS 6 用例 + Go DB 集成） |
| `git diff --check` | 通过 |

## 2. 覆盖点（对照 PRD 验收）

- **媒体阶段**：
  - 生产强制 S3：`PersistImage` 在生产（`NODE_ENV=production` 或 `APP_URL` 非 loopback）
    拒绝 data URL fallback；`PersistVideo` 无对象存储直接失败（`RESULT_PERSIST_FAILED`），
    `buildVideoResult` 不再回退上游 URL。测试：`storage_test.go`、`video_test.go`。
  - additive schema：`GenerationImage`/`GeneratedVideo` 新增 `mediaStorage`/`storageKey`
    （可空）；migration `20260807140000_generation_media_storage_meta`。
    schema probe 增补两表与媒体列。
  - 契约：`contracts/generation/v1/scenarios/media.json` 补 `mediaStorage`/`storageKey`
    与 B64/S3/UPSTREAM 样例；TS/Go conformance 测试消费同一 fixture。
  - 回填：`worker/cmd/backfill-media`（`--dry-run`/`--limit`/`--include-http`），
    幂等（`mediaStorage IS NULL` 才处理，DB 集成测试验证重复执行不重复转存）。
- **提示词阶段**：
  - 权威清单：`contracts/prompts/v1/default-sources.json`（6 来源 + version）；
    Go `DefaultPromptSources` 从 manifest 读取，契约测试断言字段/唯一性/parser 合法。
  - 单一实现：删除 Node `source-config.ts`/`parser.ts` 与对应单测；
    `service.ts` 仅保留读库/改 enabled，`syncPromptSource`/`syncAllPromptSources`
    转发 Worker `/internal/prompt-sync`（Bearer 复用 `WORKER_METRICS_TOKEN`）。
  - 三入口共用：手动 CLI（改读 manifest）、admin 转发、Worker scheduler
    （`PROMPT_SYNC_ENABLED` 默认 false，`PROMPT_SYNC_INTERVAL` 默认 86400s）。
  - 并发/幂等/部分失败：`SyncSource` 事务内 `pg_try_advisory_xact_lock`（拿不到返回
    `SKIPPED_LOCKED`）；`SyncAll` 逐来源独立执行并聚合；`replacePromptItemsTx`
    全量替换语义。DB 集成测试覆盖 advisory 锁、重复同步无孤儿、部分失败聚合。
- **环境变量契约**：`contracts/runtime/v1/environment.json` 新增
  `PROMPT_SYNC_ENABLED`/`PROMPT_SYNC_INTERVAL`；同步 `config.go`、`env.ts`、
  `.env.example`、README；运行时契约测试通过。

## 3. 其他说明

- 决策：internal 端点鉴权**复用** `WORKER_METRICS_TOKEN`（与环境契约已存在变量一致，
  未新增 secret 变量）；未配置 token 时与 `/metrics` 语义一致（loopback 内网访问）。
- `postgres-runner.ts` 由“单一 additive migration”改为支持 additive 列表
  （`20260807130000` + `20260807140000`）；`legacy-schema.sql` 补齐 baseline 中
  已声明但缺失的 `PromptSource`/`PromptLibraryItem` 表（此前为潜在不一致，本次修复）。
- 前端 URL/预览契约未变；管理后台 UI（`prompt-source-manager.tsx`）与 `/prompts`
  只读查询不受影响。
- 单测 `persist-generated-image.test.ts` 在全量并发下偶发超时（独立运行通过），
  判定为既有资源竞争问题，与本任务改动无关。

## 4. 未覆盖项（需用户授权 / 真实环境）

- 真实 S3/R2（Cloudflare R2、Zeabur 对象存储）读写与 CDN 公开访问验证。
- 真实定时同步（`PROMPT_SYNC_ENABLED=true` + 实际上游 GitHub 抓取）在部署环境验证。
- 生产环境大 base64 历史数据批量回填演练（本仓库用 disposable DB + 模拟 S3 验证逻辑）。
- 真实上游 URL 过期/部分来源失败的故障演练（已用 fixture 注入验证聚合语义）。

## 5. trellis-check 复核修复（2026-08-07）

复核后修复以下问题，未改变已验证通过的媒体/提示词语义：

- **CRITICAL：来源清单进 Docker 镜像 + 路径探测**：主 `Dockerfile` runner 新增
  `COPY --from=builder /app/contracts ./contracts`；`worker/Dockerfile` builder 新增
  `COPY contracts/ ./contracts/` 并在 final 镜像复制到 `/app/contracts`。
  `promptSourcesRoot()` 改为候选路径探测：`PROMPT_SOURCES_DIR` → 源文件推导仓库路径 →
  CWD 相对 `contracts/prompts/v1` → `/app/contracts/prompts/v1`，取第一个含
  `default-sources.json` 者；全部缺失返回带已尝试路径的可诊断错误。
  新增测试：env override 命中、override 缺失时回退源路径、无候选时诊断错误。
  环境契约新增 `PROMPT_SOURCES_DIR`（owner=worker，allowedReadPaths 仅 prompts.go）。
- **WARNING：`PromptSyncResult` JSON tag**：补 `json:"count"/"slug"/"status"`（与 Node
  契约类型小写一致）；新增 `/internal/prompt-sync` 成功路径测试，断言响应 JSON 为小写字段
  （通过注入 `promptSyncRunner`，替换原 `promptSyncerFactory`，无需真实 DB）。
- **WARNING：env.ts 死代码**：`src/lib/env.ts` 删除 `PROMPT_SYNC_ENABLED/INTERVAL`
  （owner=worker，全仓无 Node 消费）；环境契约保持唯一事实源，运行时契约测试通过。
- **LOW**：`config.go` 的 `PROMPT_SYNC_INTERVAL` 收敛到契约范围 [60, 604800] 秒并补 clamp 测试；
  `backfill.go` 删除 `remaining == 0 || remaining > 0` 恒真条件，下载/解析失败单独计数为
  `FailedFetch`（不再误计入 `SkippedNoS3`）。

复核后验证（与第 1 节命令一致）：`go vet/build/test`、`pnpm tsc/lint`、
`pnpm verify:worker-contracts:ts/:go/:db` 全部通过；`docker compose config --quiet` 与
`docker compose -f docker-compose.e2e.yml config --quiet` 通过；`git diff --check` 通过。
`persist-generated-image.test.ts` 全量并发下偶发超时为既有 flake（独立运行通过），与本修复无关。
