# 实施阶段事务与兼容审计补充

本文件记录实现代理开始后对当前源码的只读复核，作为 `trellis-check` 的重点闸门。

## 必须保留的约束

- `contractVersion` 数据库默认必须是 legacy（0/NULL），`handoffState` 对旧写入可空；v1 入口显式写 1/`NOT_STARTED`。
- claim、租约、`attemptCount + 1` 和 attempt ledger 插入必须在同一个 PostgreSQL 事务内完成；attempt 插入失败必须整笔回滚。
- `GenerationAttempt` 的唯一键只应是 `(jobId, ordinal)`；跨重试的 idempotency key 不设全局唯一约束，request ID 只建索引。
- `SUBMITTING/SUBMITTED/UNKNOWN` 任务不能被普通 Go/Node/管理员 stale cleanup 退款或删除；结果写回失败不能继续调用普通 `failJobAndRefund`。
- 所有退款入口（Go 失败/过期、Node helper、管理员批量操作）都必须使用行锁或等价 CAS：`refundAppliedAt IS NULL`、`creditsSpent > 0`、handoff 允许退款，并与加积分同事务完成；`creditsSpent=0` 的自填任务仍能正常失败。
- `nextAttemptAt` 必须进入新 claim 条件；v1 开关启用前必须阻断旧 Worker 和旧 Next stale cleanup，否则它们会立即领取未来重试或误清理。
- SIGTERM 后不能使用已取消的根 context 做最终退款/状态写回；要使用有上限的 detached finalization context。
- `completeJob/completeVideoJob` 的 job、attempt、租约和媒体写回必须同事务校验；上游已接受但本地写回失败进入 UNKNOWN，不退款。
- 管理员失败清理/删除路由必须保留 UNKNOWN 的 attempts/evidence，不能因 `status=FAILED` 而误删。

## Migration / runner 现实边界

当前仓库历史 Prisma migration 并非从空库创建完整基表；因此本子任务的 disposable DB runner 不得声称“空库 `migrate deploy` 已验证”。
runner 应：

1. 3~5 秒内检查 Docker CLI/daemon、镜像和资源归属；缺失时退出码 2，禁止自动 pull、回退 `.env` 或开发数据库。
2. 使用明确的 legacy schema snapshot/fixture 创建一次性数据库，再只执行本任务 additive migration 和契约集成测试。
3. 把完整空库 migration、历史升级、失败 migration 矩阵交给 `release-hardening`；该任务的验证记录要明确标注“未覆盖”。

## 最小回归集合

1. 旧 writer 默认 legacy；新 Worker 不把 legacy PROCESSING 当作未 handoff。
2. attempt 插入失败的 claim 原子回滚。
3. 两 Worker claim 去重及用户并发上限。
4. `nextAttemptAt` 未来不可领取，达到时间才可领取，attempt 不超过上限。
5. 提交前 429/503/连接失败重试，耗尽后一次退款。
6. 已接受后断连、request ID 存在但写回失败 → UNKNOWN、保留积分。
7. Go/Node/helper/admin/租约清理并发退款仅一次。
8. UNKNOWN 不退款、不删除 attempts/evidence。
9. 三阶段取消竞态及 detached finalization。
10. 零积分 custom 失败、媒体写回失败不误退款。
