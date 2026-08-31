# 审核引擎：内置敏感词库 + AI 审核 + 生成拦截

## Goal

在生成提交链路（WEB create + 外部 v1 入口）上建立内容审核：内置敏感词库匹配 + 独立可配的 AI 分类审核，任一命中即阻断本次生成、事件落库并标记用户。

## Requirements

- R1 内置敏感词库：结构化数据文件（类别标签：NSFW / 暴力 / 仇恨 / 违法），覆盖常见中英文违规词；匹配规则同时处理大小写与常见变体。
- R2 审查点：接入全部生成提交入口——`POST /api/generate`（WEB/studio，《写 GenerationJob 之前》、不扣积分）与外部 v1 入口（`v1/images/generations`、`images/edits`、`responses`、`chat/completions` 中带生成文本的路径），通过共享审核 lib 防绕过。
- R3 敏感词命中：返回明确错误（「内容包含违规描述，已拒绝生成」等）、不创建 job、不扣积分；写 `ContentReview` 记录（命中词、类别）；标记用户。
- R4 AI 审核：独立配置（env 默认 `MODERATION_*` + 后台覆盖），支持任意 OpenAI 兼容端点（baseUrl/apiKey/model/阈值）；只对通过敏感词检查的 prompt 调用；判定违规（分数≥阈值）→ 与敏感词命中同等处理。
- R5 降级：AI 调用异常 / 超时 / 未配置 → 放行（不阻断正常生成）并记告警日志；AI 审核可整体开关。
- R6 数据模型：新增 `ContentReview` 表（user/prompt/类别/命中词或 AI 分数/结果/创建时间），User 建立关系；用户标记由记录聚合得出（是否再加冗余字段在设计中定）。

## Acceptance Criteria

- [ ] 内置词库覆盖常见中英文 NSFW / 暴力 / 仇恨关键词，且普通艺术词（如 artistic、portrait 等）无误杀（词库质量验证用例）。
- [ ] 敏感词命中 prompt / negativePrompt → 阻断生成、错误明确、不扣积分、事件落库、用户标记。
- [ ] AI 审核配置生效（默认 OpenAI 兼容端点）；违规判定 → 同样阻断 + 记录。
- [ ] AI 审核服务异常 / 超时 / 未配置 → 生成放行，不影响可用性。
- [ ] 外部 v1 入口与 WEB 走同一审核（防绕过）；审核关闭时行为等于现状。
- [ ] `pnpm lint` / `pnpm test` / `pnpm build` 通过；DB 变更 `pnpm verify:migrations` 通过。

## Notes

- 中复杂任务：需 `design.md` + `implement.md`。
- 词库文件可被后续 `moderation-admin` 后台编辑（预留读取结构）。
- 误杀控制是核心验收点：词库需精确而非宽泛。