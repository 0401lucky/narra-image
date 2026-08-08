# 统一媒体存储与提示词同步设计

## 1. 设计目标与边界

本子任务解决两个长期风险：媒体持久化不稳定（生产可能把大 base64 塞进数据库、视频依赖短期上游 URL）与提示词同步双轨漂移（Node/Go 各维护一套 parser 和来源清单）。

- **媒体阶段（先行）**：为图片/视频建立单一、可验证、可回填的持久化策略；失败不静默写入不可用地址；历史作品保持可读。
- **提示词阶段（可独立验收）**：以 Go 为权威实现，Node 只保留状态读取、配置修改和同步触发；手动/后台/定时三入口共用同一任务机制；来源清单单一化。

非目标：不迁移登录、用户域或页面渲染；不转存提示词封面（已确认保持上游 URL）；不做公开 Go ingress。

```text
                        ┌─────────────────────────────────────────┐
                        │              Next.js（管理/展示层）       │
                        │  管理后台：读 PromptSource 状态、改 enabled │
                        │  admin /sync → 转发内部请求到 Worker      │
                        │  /prompts → 只读 PromptLibraryItem        │
                        └───────────────┬─────────────────────────┘
                                        │ WORKER_INTERNAL_URL + token
                                        ▼
                        ┌─────────────────────────────────────────┐
                        │      Go Worker（权威实现，内网 HTTP）      │
                        │  /internal/prompt-sync（POST，受 token）  │
                        │  scheduler（PROMPT_SYNC_ENABLED，定时）   │
                        │  cmd/prompt-sync（手动 CLI）              │
                        │  ── 三者共用 PromptSyncer + advisory 锁   │
                        │  Storage：S3/R2 持久化 + 存储形态标记       │
                        │  cmd/backfill-media（历史数据回填）        │
                        └───────────────┬─────────────────────────┘
                                        ▼
                        PostgreSQL：PromptSource / PromptLibraryItem
                                   GenerationImage / GeneratedVideo
```

## 2. 媒体阶段设计

### 2.1 存储策略（生产强制对象存储）

以 `S3_BUCKET + S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY` 齐备判定对象存储可用（沿用 `Storage.hasObjectStorage()`）。

- **图片**：
  - 有对象存储：`PersistImage`/`PersistImageFromURL` 存 S3，返回公开 URL。
  - 无对象存储：仅当 `ENABLE_LOCAL_IMAGE_FALLBACK=true` 且**非生产**时才允许 data URL fallback；生产环境（`NODE_ENV=production` 或 `APP_URL` 非 loopback 显式值）即使开启 fallback 也拒绝并返回明确错误，禁止大 base64 进数据库。
- **视频**：
  - 有对象存储：`buildVideoResult` 下载上游视频转存 S3（现有逻辑保留），返回 S3 URL。
  - 无对象存储：**直接失败**（`RESULT_PERSIST_FAILED`，错误信息明确指向“未配置对象存储”），不再回退上游短期 URL。开发/测试如需本地验证，使用本地 S3 模拟（如 MinIO）或显式允许上游 URL 的测试开关（仅测试代码，不进入生产路径）。
- 失败语义：`ResultPersistError` 保持终态失败（handoff 已发生，不得盲目重试上游）；存储失败的 job 走 `RESULT_PERSIST_FAILED`，用户可新建任务重试，运维可通过 attempt ledger 的 `providerRequestId` 协调。

### 2.2 存储元数据（additive schema）

`GenerationImage` / `GeneratedVideo` 增加存储形态标识，历史行为不破坏：

- `mediaStorage String?`：`B64`（data URL fallback）| `S3`（对象存储）| `UPSTREAM`（上游直连，仅历史）| `NULL`（legacy 行）。
- `storageKey String?`：S3 object key，用于审计、回填和未来 CDN 刷新；非 S3 行为 NULL。
- 写入者（Go worker）在 Persist 成功后带出 `(url, mediaStorage, storageKey)` 并随 INSERT 落库；新增列有默认值，旧 Worker/旧写入者不传字段仍可插入。

legacy 行判定规则（用于展示与回填扫描，不迁移数据）：`data:` 前缀 → B64；其余 http(s) URL 在无元数据时无法区分 S3/上游，保持 `NULL`（legacy），回填工具按需处理。

### 2.3 契约扩展

`contracts/generation/v1/scenarios/media.json` 增加存储形态字段：

- `image.resultFields` 补充 `mediaStorage`、`storageKey`（可空）。
- `video.resultFields` 补充 `mediaStorage`、`storageKey`（可空）。
- 新增各形态 URL 样例：S3 公开 URL、data URL、上游 URL，作为 TS/Go 两端 conformance fixture 的输入。

### 2.4 历史兼容与回填

- 历史 `GenerationImage.url`（data URL / S3 URL / 上游 URL）与 `GeneratedVideo.url` 保持可读，前端 URL 展示契约不变。
- 新增 `worker/cmd/backfill-media/main.go`：扫描 `mediaStorage IS NULL` 且 URL 为 `data:` 前缀（以及可选的上游 http 图片）的图片/视频行 → 解码/下载 → 转存 S3 → 事务内更新 `url` + `mediaStorage` + `storageKey`；按 `(jobId, id)` 分批、幂等（重复执行不重复转存：以 `mediaStorage != NULL` 为已处理标记），支持 `--limit`/`--dry-run`。
- 回填只在用户授权且对象存储就绪时执行；仓库内验证用 disposable DB + 模拟存储。

## 3. 提示词阶段设计

### 3.1 权威来源清单

新增 `contracts/prompts/v1/default-sources.json`：语言无关的唯一清单（6 个默认来源的 slug/name/parser/rawBaseUrl/sourceUrl/sortOrder/description），带 `version` 字段。

- Go `ensureDefaultPromptSources` 从该 manifest 读取并 upsert 到 `PromptSource`；代码中不再硬编码来源常量。
- Node 删除 `src/lib/prompts/source-config.ts` 与 `src/lib/prompts/parser.ts`；不再维护清单或解析器。
- 契约测试：Go 测试读取 manifest 并断言 6 来源字段完整、slug 唯一、parser 值在受支持集合内；Node 侧删除后不再有对应常量可漂移。

### 3.2 单一权威实现与入口

- **权威实现**：`worker/internal/worker/prompts.go`（`PromptSyncer`），保持现有 6 个 parser 与 `replacePromptItems`（delete-not-in + upsert，天然幂等）。
- **三入口共用**：
  1. 手动 CLI：`worker/cmd/prompt-sync/main.go`（现有，改读 manifest）。
  2. 后台触发：Node admin `POST /api/admin/prompt-sources/sync` → 调用 `WORKER_INTERNAL_URL/internal/prompt-sync`（Bearer token）→ Go 执行 → Node 读 DB 状态返回；Node 不再直接解析。
  3. 定时调度：Worker 内 scheduler goroutine（ticker），`PROMPT_SYNC_ENABLED=true` 时按 `PROMPT_SYNC_INTERVAL` 对 `isEnabled=true` 的来源执行 `SyncAll`。
- Worker `server.go` 增加 `POST /internal/prompt-sync`：请求体 `{ "sourceId": string? }`（缺省 = all），鉴权复用 token 校验（与 `/metrics` 一致的 Bearer 比较方式，可复用 `WORKER_METRICS_TOKEN` 或独立 `WORKER_INTERNAL_TOKEN`，二选一并在环境契约定版）。

### 3.3 并发与幂等

- 同一来源并发同步：`SyncSource` 开始时对 `PromptSource.id` 取 PostgreSQL advisory lock（`pg_try_advisory_xact_lock`，事务内），拿不到锁返回“正在同步”而不是并发重跑；`SyncAll` 逐个来源处理，互不阻塞。
- 幂等：`replacePromptItems` 已是全量替换（删除不在清单的 remoteId + upsert），重复执行结果一致，无孤儿记录；`remoteId` 唯一约束（`@@unique([sourceId, remoteId])`）保证。
- 超时：同步在来源级使用上下文超时（沿用 `promptSyncTimeout`），单个来源失败不中断其他来源。

### 3.4 部分失败与状态可见

- `SyncAll` 由“遇错即停”改为“逐来源独立执行，失败来源标记 `FAILED` 并聚合返回”；每个来源的 `status`/`lastSyncError`/`lastSyncedAt`/`itemCount` 已由 `PromptSource` 承载，admin 列表与 `prompt-source-manager.tsx` 原样展示（前端 UI 契约不变）。
- 失败恢复：断网/超时/部分失败后再次同步即覆盖上次结果（全量替换语义），不产生重复/孤儿记录；无独立重试队列（来源级同步轻量，直接重跑）。

### 3.5 环境变量契约

更新 `contracts/runtime/v1/environment.json`（唯一事实源），并同步 `src/lib/env.ts`、`worker/internal/worker/config.go`、`.env.example`、README：

- 新增 `PROMPT_SYNC_ENABLED`（bool，默认 `false`）。
- 新增 `PROMPT_SYNC_INTERVAL`（duration，默认 `24h`）。
- `WORKER_INTERNAL_TOKEN` 或复用 `WORKER_METRICS_TOKEN`（在 3.2 中定版，写入契约后由唯一 loader 读取）。

## 4. 兼容性、回滚与验证

### 兼容性

- 所有 schema 变更 additive（新列带默认值）；旧 Worker/旧 Node 写不传新字段仍可运行。
- 提示词阶段删除 Node parser 后，`/prompts` 只读查询、admin 列表、enabled 修改全部保留，仅同步路径改走 Worker。
- 管理后台 UI 组件与公开 URL/预览契约不改变。

### 回滚

- 媒体策略：`ENABLE_LOCAL_IMAGE_FALLBACK` 与生产强制逻辑通过配置控制，回滚即恢复旧配置；无对象存储回滚路径。
- 提示词：Node 保留转发失败时的明确错误返回；Go internal 端点与 scheduler 通过 `PROMPT_SYNC_ENABLED` 一键关闭；删除的 Node parser 在独立提交中移除，便于恢复。

### 验证入口

```powershell
pnpm exec tsc --noEmit
pnpm lint
pnpm test
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./...
go -C worker build ./...
pnpm verify:worker-contracts:ts / :go / :db
```

- 新增 disposable DB 测试：迁移 additive 字段、媒体写入各形态（B64/S3/UPSTREAM）、回填幂等、同步 advisory 锁与幂等、部分失败聚合、scheduler 开关。
- 真实 S3/CDN/定时环境验证仅在用户授权且安全配置具备时执行，记录到 `verification/` 并与仓库内模拟测试分开标注。

## 5. 权衡与延后项

- 视频无 S3 直接失败：严格但要求部署者配置对象存储；开发用 MinIO/测试开关补偿（已确认）。
- 提示词封面不转存：封面稳定性依赖上游 GitHub，记为 deferred，不回填（已确认）。
- 定时同步默认关闭：避免生产自动依赖外部来源；显式开启（已确认）。
- 存储瞬时故障不做自动重试（handoff 语义限制），以终态失败 + 回填/重跑补偿。
- 历史 S3 vs 上游 URL 无元数据区分：legacy 行保持 `NULL`，不回填未知来源，避免误写。
