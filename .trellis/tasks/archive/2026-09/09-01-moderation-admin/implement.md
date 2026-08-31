# 执行计划：后台审核管理与配置

## 依赖
- `moderation-engine` 已完成（`ContentReview` / `ModerationConfig` 模型与 repository、词库、`getModerationConfig/updateModerationConfig`）。

## 执行清单（有序）

1. **后台 API** `src/app/api/admin/moderation/`
   - `reviews/route.ts`（GET：分页 + kind 过滤 + join user）
   - `summary/route.ts`（GET：按用户聚合触发次数 + user 信息 + banned）
   - `config/route.ts`（GET / PATCH：复用 engine config lib，序列化不含明文 key）
   - `words/route.ts`（GET：词库只读，按类别）
2. **记录 + 聚合页面** `src/app/admin/moderation/page.tsx`
   - server 组件：`requireAdminRecord`、初始查询 reviews（分页）与 summary。
   - 客户端组件 `src/components/admin/moderation-reviews-board.tsx`：kind 过滤、分页、用户聚合卡（一键封禁/解封，确认弹窗，调 ban API + `router.refresh()`）。
   - 数据 shape 与 `UserAdminCard` 一致（email/nickname/banned）。
3. **配置页** `src/app/admin/settings/moderation/page.tsx` + `src/components/admin/moderation-config-form.tsx`
   - 表单（开关/端点/key/model/阈值）；保存 PATCH config；词库只读折叠展示。
4. **导航** `src/components/admin/admin-nav.tsx`：加「内容审核」入口；settings 列表加「内容审核」。
5. **单测**（可选，若纯展示可仅 lint/build）：
   - `moderation-config` serialize 不含明文 key 的断言。
   - words API 类别/计数正确（mock 词库）。
6. **人工验证**：后台开审核记录（造数或真实触发）、过滤、聚合、一键封禁。

## 验证命令

- `pnpm exec tsc --noEmit`
- `pnpm exec eslint`（改动文件）
- `pnpm exec vitest run --testTimeout=30000`（相关单测 + 全量）
- `pnpm build`

## Review 门槛

- [ ] 记录列表分页/过滤可用，user join 正确
- [ ] 用户聚合 + 一键封禁/解封可用且不可封禁自己
- [ ] 配置可保存即时生效，明文 key 不返前台
- [ ] 导航入口正确；`pnpm build` 过

## 回滚点

- 纯管理面：移除路由/页面/导航即可，不影响引擎。