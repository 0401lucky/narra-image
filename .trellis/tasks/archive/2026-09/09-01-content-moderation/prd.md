# 内容审核：敏感词库 + AI 审核 + 触发标记

## Goal

拦截 NSFW / 违规内容的生成：内置敏感词库 + 可独立配置的 AI 审核，命中即阻断生成并记录触发事件、标记用户；后台提供审核记录、用户触发聚合与一键封禁入口。

## Requirements

- R1 内置敏感词库（中/英文，按 NSFW / 暴力 / 仇恨 / 违法分类），生成提交时对 `prompt` 与 `negativePrompt` 匹配；命中 → 阻断生成、返回明确错误、不扣积分、事件落库、用户标记。
- R2 AI 审核独立配置（env 默认值 + 后台可配 baseUrl/apiKey/model/阈值），默认 OpenAI 兼容 moderation 端点；对通过敏感词检查的 prompt 调用分类，判定违规 → 同样阻断 + 记录。
- R3 触发记录：每次命中落库（用户、prompt、命中词或 AI 分值、类别、时间），用户可被聚合标记。
- R4 后台：审核记录列表（分页/过滤）、用户触发聚合、一键封禁入口（复用 `PATCH /api/admin/users/[id]/ban`）；审核配置管理（开关/阈值/端点）。
- R5 可关闭/降级：AI 审核服务异常或超时 → 放行不阻断（记录告警日志）；审核整体可开关，不会影响正常生成通道可用性。
- R6 决策基线（已与用户确认）：**严格阻断**（命中即拒绝）；**AI 独立配置**（不占用生图渠道配额）；**标记 + 后台一键封禁**（管理员决策，不自动封禁）。

## Acceptance Criteria

- [ ] 子任务 `moderation-engine`：内置词库 + 敏感词拦截 + AI 审核 + 触发记录落库 + 用户标记，覆盖 WEB 与外部 v1 入口。
- [ ] 子任务 `moderation-admin`：后台审核记录、用户聚合、一键封禁、审核配置可用。
- [ ] 审核关闭 / AI 异常时正常生成不受影响（降级路径）。
- [ ] 数据库变更 Additive，`pnpm verify:migrations` 通过；`pnpm lint` / `pnpm test` / `pnpm build` 全绿。

## Notes

- 数据模型沿用现有配置模式（如 `TurnstileConfig` / `BenefitConfig` 单行 scope 配置表）。
- 外部 v1 入口（`v1/images/generations` 等，含 gateway/直连两路径）共用同一审核 lib，防绕过。
- 依赖顺序：`moderation-engine` → `moderation-admin`（后者依赖前者的记录模型与 repository）。
- 敏感词库用结构化数据文件（类别标签），便于维护与后续后台编辑。