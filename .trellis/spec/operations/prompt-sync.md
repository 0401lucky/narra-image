# 提示词同步单一事实来源契约

## 1. 适用范围与触发条件

- 适用于提示词来源清单、解析入库、同步调度与状态展示。
- 修改 `contracts/prompts/v1/default-sources.json`、`worker/internal/worker/prompts.go`、`worker/cmd/prompt-sync`、Worker `/internal/prompt-sync` 端点、`PROMPT_SYNC_*` 环境变量，或 Node 侧提示词相关 API 时，必须先读本规范。
- 本规范不授权连接真实上游抓取/定时调度到生产；定时调度需显式开启并单独记录验证。

## 2. 来源清单单一事实来源

- `contracts/prompts/v1/default-sources.json` 是默认来源清单的唯一权威（6 来源 + `version`）。
- Go `DefaultPromptSources()` 从该 manifest 读取；代码中不得再硬编码来源常量。
- Node 不再维护 parser 或来源清单；`src/lib/prompts/` 只保留读库、改 enabled 与同步转发。
- 新增/修改来源：先改 manifest，再让 Go 契约测试（字段完整、slug 唯一、parser 合法）通过。

## 3. 权威实现与三入口

- 解析与入库的权威实现只有 Go `PromptSyncer`；手动 CLI、admin 后台触发、定时 scheduler 三入口共用同一实现。
- 手动：`worker/cmd/prompt-sync`（`-source all|<slug>`）。
- 后台：Node admin `POST /api/admin/prompt-sources/sync` 校验管理员后调用 `WORKER_INTERNAL_URL/internal/prompt-sync`（Bearer 复用 `WORKER_METRICS_TOKEN`），不直接解析。
- 定时：Worker 内 scheduler，`PROMPT_SYNC_ENABLED=true` 时按 `PROMPT_SYNC_INTERVAL`（clamp [60, 604800] 秒，默认 86400s）对 `isEnabled=true` 来源执行 `SyncAll`；默认关闭。

## 4. 并发、幂等与失败

- `SyncSource` 在事务内取 `pg_try_advisory_xact_lock`（按来源 id）；拿不到锁返回“正在同步”，不并发重跑。
- `SyncAll` 逐来源独立执行并聚合结果；单个来源失败标记 `FAILED` 不中断其他来源。
- 入库使用全量替换（删除不在清单的 remoteId + upsert），重复执行不产生重复/孤儿记录；`@@unique([sourceId, remoteId])` 保证。
- 状态可见：`PromptSource.status/lastSyncError/lastSyncedAt/itemCount` 由唯一实现写入，admin 列表与 `prompt-source-manager.tsx` 原样展示。

## 5. 清单可达性

- `promptSourcesRoot()` 按候选路径探测：`PROMPT_SOURCES_DIR` → 源码相对路径 → CWD 相对 `contracts/prompts/v1` → `/app/contracts/prompts/v1`。
- 两个 Dockerfile 必须包含 `contracts/`（`Dockerfile` runner 与 `worker/Dockerfile` final 阶段）；构建产物缺少 manifest 属于发布阻塞缺陷。

## 6. 验证入口

```powershell
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./internal/worker/...
go -C worker build ./...
pnpm exec tsc --noEmit
pnpm lint
pnpm verify:worker-contracts:ts
pnpm verify:worker-contracts:db
docker compose config --quiet
```

- 仓库内验证用 disposable PostgreSQL + 模拟存储；真实上游抓取与定时调度验证需用户授权，单独记录。
