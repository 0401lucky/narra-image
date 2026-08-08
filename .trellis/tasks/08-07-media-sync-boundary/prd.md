# 统一媒体存储与提示词同步

## Goal

统一 Go/Node 媒体持久化策略与提示词同步入口，补齐调度、失败恢复和长期可访问性。

## Requirements

- 定义生产媒体策略：图片不得长期把大 base64 当数据库主存储；视频不得依赖短期上游公开 URL。
- 统一 Node 与 Go 的来源清单、解析器和入库契约，选择一个权威同步实现与调度入口。
- 管理后台触发、手动命令和定时同步必须共享状态、幂等、超时和失败记录。
- 为 S3/R2 缺失、CDN 不可达、上游 URL 过期、部分来源失败和重复同步补测试与恢复策略。
- 保持现有前端 URL/预览契约，迁移期间不破坏历史作品。

## Phases and Ownership

- **媒体阶段（先行）**：由本子任务独占图片/视频 URL 生命周期、S3/CDN、历史兼容和媒体字段 fixture；网关只依赖该阶段输出。
- **提示词阶段（可独立验收）**：由本子任务独占来源清单、parser、调度和同步状态；其完成不阻塞 Go 网关。

## Dependencies

- 依赖 `release-hardening` 的环境变量和生产存储/发布契约。
- Go `/v1` 网关不作为前置条件；同步实现可先以内部命令/任务运行。

## Acceptance Criteria

- [ ] 生产图片和视频均有明确、可验证的持久化与访问策略，失败不会静默写入不可用地址。
- [ ] Node/Go 不再维护两套可能漂移的 parser/source manifest；单一实现有版本或契约测试。
- [ ] 手动、后台和定时触发均幂等，能看到每个来源的状态、数量、错误和最后成功时间。
- [ ] 断网、重复、超时和部分失败场景可恢复且不产生重复/孤儿记录。
- [ ] 验证记录明确区分仓库内模拟存储/调度测试与需用户授权的真实 S3/CDN/定时环境证据。

## Out of Scope

- 不在此任务中迁移登录、用户域或页面渲染。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
