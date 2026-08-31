# 后台审核记录：触发标记 + 一键封禁 + 审核配置

## Goal

后台提供内容审核的管理面：审核记录浏览与过滤、用户触发聚合与一键封禁入口、审核配置管理（开关/阈值/端点/词库展示）。

## Requirements

- R1 后台「内容审核」页：审核记录列表（时间倒序、prompt 截断、类别：敏感词/AI、命中词或 AI 分数、用户邮箱/昵称）、分页；按类别过滤。
- R2 用户触发聚合：按用户聚合触发次数与最近触发时间；点击可查看该用户记录或跳转用户管理；提供「一键封禁」入口（复用 `PATCH /api/admin/users/[id]/ban`）。被封禁用户显示状态，防止重复封禁。
- R3 审核配置页（并入设置或独立）：启用开关、敏感词开关、AI 审核开关 + 阈值 + baseUrl/apiKey/model、异常时降级说明；保存即时生效。
- R4 内置敏感词库只读展示（按类别分组、计数），后台编辑为可选增强（MVP 可只展示，编辑列入后续）。
- R5 后台 API：`GET /api/admin/moderation-reviews`（分页/过滤）、`GET/PATCH /api/admin/moderation-config`；用户触发聚合可复用记录 API 或单独端点。

## Acceptance Criteria

- [ ] 后台审核记录列表可浏览、分页、按类别过滤。
- [ ] 用户聚合视图显示触发次数与最近触发；一键封禁入口可用（调现有 ban API，禁止封禁自己），解封后状态同步。
- [ ] 审核配置可保存、重启后保留（落库）、即时生效（引擎读到新配置）。
- [ ] 词库只读展示正确（类别/计数）。
- [ ] `pnpm lint` / `pnpm test` / `pnpm build` 通过。

## Notes

- 中复杂任务：需 `design.md` + `implement.md`。
- 依赖 `moderation-engine` 的 `ContentReview` 模型与审核配置模型。
- 与现有后台模式保持一致（`admin/users` 卡片、`AdminPagination`、`studio-card` 视觉）。