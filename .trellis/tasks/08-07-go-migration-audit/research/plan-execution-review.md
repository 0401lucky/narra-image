# Research: 规划验收与执行可行性审查

- Query: 审查渐进深化 Go 化父子任务的阻塞项、可观测验收、依赖顺序、验证命令、危险操作与回滚，并判断父任务是否可直接启动。
- Scope: internal
- Date: 2026-08-07

## Findings

### 总结

**当前结论：NO-GO。父任务不应直接执行 `task.py start`；四个子任务也都不能立即启动。**

父任务明确不承担业务实现，只负责协调与集成验收（`prd.md:53`、`implement.md:5-6`）。正确做法是先修订父计划中的所有权和依赖，再逐个补齐目标子任务的 `design.md`、`implement.md`、上下文清单和最新启动批准，随后只启动拥有下一项可独立验收交付的子任务。

### BLOCKER

1. **父任务不是实施目标，四个子任务尚未满足复杂任务启动门槛。** 父 PRD 要求每个子交付具备独立设计、执行计划、验证记录和回滚点（`prd.md:24`），父执行计划也要求子任务开始前补齐 `design.md`、`implement.md`、上下文清单并获得批准（`implement.md:5-6`）；四个子 PRD 仍保留“复杂任务需补设计与执行计划”的模板提示（各子 PRD 的 `Notes`）。修订建议：父任务保持 planning；先为准备首发的子任务完成完整规划和清单校验，再向用户展示该子任务最终摘要，并在后续消息获得明确批准后启动该子任务。

2. **阶段 A 是无所有者的前置工作，且父计划的串行阶段与设计中的并行关系不一致。** 阶段 A 包含共享契约、handoff 语义和测试稳定化（`implement.md:12-17`），但父任务声明不写业务代码；文件所有权又把契约 fixtures 交给 `worker-contracts`（`implement.md:123`），没有明确谁负责测试 runner 稳定化。设计允许 `worker-contracts` 与 `release-hardening` 分别推进（`design.md:148`），执行章节却按 B→C 串行排列（`implement.md:29-76`）。修订建议：把契约/handoff 项并入 `worker-contracts`，把稳定测试入口与基线记录并入 `release-hardening`；明确两者可并行，但 `release-hardening` 的 readiness 联调必须等待 Worker 状态/错误契约冻结。

3. **发布与迁移验收还没有可执行的真实验证命令。** 当前 `docker compose ... config --quiet` 只能验证配置语法（`implement.md:61-70`），不能证明空库 migration、历史升级、失败 migration、app 等待 Worker 或重复消费者保护；这些场景只以自然语言留待“新增 E2E runner 后”验证（`implement.md:72`）。同时父 PRD 已记录 `pnpm test` 当前存在两个默认超时（`prd.md:14`），但多个阶段直接把未稳定的 `pnpm test` 当作门禁（`implement.md:41,63,88,109`）。修订建议：在 `release-hardening/implement.md` 写出唯一、可复制的 CI/E2E 入口、一次性测试数据库及退出码规则，并先让稳定化后的全量测试命令通过，再作为后续子任务共同门禁。

### WARNING

1. **若干验收词无法直接判定通过或失败。** “长期持久化”“稳定”“代表性客户端”“行为一致”“观察期”等没有时长、样例矩阵或证据位置（父 `prd.md:60-64`；`media-sync-boundary/prd.md:22-25`；`go-api-gateway/prd.md:22-25`）。修订建议：为每个子任务列出明确测试矩阵、预期状态/错误码、客户端与接口清单、持久化探测时限，以及统一的验证记录文件位置。

2. **危险操作原则已写明，但删除与回滚前置闸门仍需落到子任务步骤。** 父计划禁止自动生产部署和未经确认的危险数据库操作（`implement.md:8`），也采用 additive schema 与功能开关（`design.md:131-137`）；但旧 Node 实现仍计划直接删除（`implement.md:102-103`），只说明独立提交便于恢复（`implement.md:119`）。修订建议：在删除文件、非一次性数据库执行、历史媒体回填前分别增加明确用户确认；Worker 重试/公平性也应有独立开关、旧任务兼容检查和关闭新行为的回滚步骤。

3. **跨子任务所有权仍有重叠。** `worker-contracts` 与 `go-api-gateway` 都把删除旧 Node 生成器写入自身验收（`worker-contracts/prd.md:14,27`；`go-api-gateway/prd.md:13,25`）；媒体字段契约同时出现在 Worker 契约与媒体任务中，`readyz` 又跨 Worker 与发布任务。修订建议：指定单一 owner：Worker 只负责证明替代契约，Gateway 独占最终删除；Worker 拥有媒体任务字段 fixture，Media 拥有持久化/URL 生命周期；Release 拥有端点和部署联动，Worker 只提供 schema/消费能力探针。

### OK

1. **战略范围已经收敛。** Next.js 保留页面、BFF、鉴权与管理域，Go 聚焦生成、队列、存储、同步和观测（`prd.md:5,35-44`），与用户确认的“渐进深化”一致，没有继续悬而未决的父级产品范围问题。

2. **总体迁移顺序方向正确。** Worker/契约与发布保障先行，媒体边界随后，Go 网关最后切换（`prd.md:42,48-51`；`design.md:139-150`）；网关子 PRD也明确依赖 Worker、发布和媒体 URL 契约（`go-api-gateway/prd.md:15-18`）。

3. **生产安全边界基本明确。** 计划明确不自动部署生产、不删除生产数据、不执行未经确认的批量回填或不可逆数据库变更（`prd.md:35-37`），并要求 schema additive、功能开关、旧入口保留和即时回退（`design.md:120-137`）。

## Files found

- `.trellis/tasks/08-07-go-migration-audit/prd.md`：父任务目标、范围、子交付和跨任务验收。
- `.trellis/tasks/08-07-go-migration-audit/design.md`：目标架构、契约、迁移、灰度、回滚和依赖设计。
- `.trellis/tasks/08-07-go-migration-audit/implement.md`：阶段、验证命令、所有权和最终集成计划。
- `.trellis/tasks/08-07-worker-contracts/prd.md`：Worker、队列、计费和跨运行时契约交付。
- `.trellis/tasks/08-07-release-hardening/prd.md`：迁移、拓扑、CI/E2E、readyz 和运维交付。
- `.trellis/tasks/08-07-media-sync-boundary/prd.md`：媒体持久化与提示词同步交付。
- `.trellis/tasks/08-07-go-api-gateway/prd.md`：Go `/v1` 网关、灰度和旧实现清理交付。

## Code patterns

- **父协调、子实施：** 父任务明确不直接承担业务实现（`go-migration-audit/prd.md:53`、`implement.md:5-6`）。
- **先兼容再切换：** 先增加测试与兼容路径，再切流量，最后清理旧实现（`go-migration-audit/implement.md:7`）。
- **共享事实来源与 additive migration：** PostgreSQL 保持唯一事实来源，schema 先新增再清理（`go-migration-audit/design.md:48-52,133-137`）。

## External references

- 未使用外部资料；本审查只判断任务规划本身是否具备执行条件。

## Related specs

- `.trellis/workflow.md`：复杂任务需完整规划，父任务通常不作为实施目标，依赖必须写入子任务文档。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：跨 Node、Go、数据库、存储和 API 的契约必须有单一 owner 与往返验证。
- `.trellis/spec/guides/code-reuse-thinking-guide.md`：共享状态、模型、错误和来源清单应避免双份实现。

## Caveats / Not Found

- 按研究角色隔离要求未读取 `implement.jsonl` 或 `check.jsonl`，因此主会话仍须单独确认父子目标任务的两个清单均包含真实有效条目，而非仅有示例行。
- 本审查未执行测试、构建、Docker 或数据库命令；“命令现实性”仅依据规划文本判断。
- 四个子任务的技术设计、执行计划和验证记录不在本次指定审查材料内；在这些文件完成并复审前，不能把任何子任务标记为 start-ready。
