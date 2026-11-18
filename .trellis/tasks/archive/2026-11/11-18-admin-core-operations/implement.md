# 阶段二执行清单：概览大盘、风控合一、用户 360 管理与作品批量审核

## 1. 前置检查

- 确认 `11-18-admin-ui-foundation` 已完成且 `AdminDrawer`、`AdminModal`、`AdminTabs`、`AdminSwitch`、`AdminToastProvider` 可用。

## 2. 实施步骤（Ordered Checklist）

- [x] **Step 1：系统状态与概览聚合层**
  - 实现 `src/lib/server/admin-overview.ts` 与 `src/app/api/admin/system-status/route.ts`。
  - 在 `src/app/admin/layout.tsx` / `AdminFrame` 接入真实顶栏健康胶囊与 `AdminNav` 待办数量角标。
- [x] **Step 2：重构概览大盘（`/admin`）与设置总览（`/admin/settings`）**
  - 实现 `admin-trend-chart.tsx` 与待办事项巡检面板，重构 `src/app/admin/page.tsx`。
  - 在 `src/app/admin/settings/page.tsx` 并行读取各设置模块摘要并在卡片展示实时状态胶囊。
- [x] **Step 3：内容风控双页收口与检索升级**
  - 新增 `moderation-nav-tabs.tsx` 接入 `/admin/moderation` 与 `/admin/settings/moderation`。
  - 为 `/admin/moderation` 增加关键词搜索参数 `q`；为 `ModerationConfigForm` 敏感词库增加前端即时搜索框与标签云展示。
- [x] **Step 4：用户管理高密度表格、积分预览器与 360° 抽屉**
  - 在 `src/app/api/admin/users/[id]/route.ts` 补充 `GET` 详情接口（严禁返回任何密钥/哈希）。
  - 升级 `src/app/admin/users/page.tsx` 支持角色/封禁/登录源筛选、排序及表格/卡片视图切换；升级 `CreditAdjuster` 与实现 `user-detail-drawer.tsx`。
- [x] **Step 5：作品审核分页化、视频支持与批量审核**
  - 在 `src/lib/server/works.ts` 实现独立精确计数与图片+视频分页查询；在 `src/lib/validators.ts` 与 `src/app/api/admin/works/batch-review/route.ts` 实现批量审核接口。
  - 升级 `src/app/admin/works/page.tsx` 与 `AdminWorksBoard`（保留 `admin-work-image-refresh.test.tsx` 与 `work-detail-page-privacy.test.tsx` 全部兼容断言）。
- [x] **Step 6：编写单测并执行质量门禁**
  - 新增 `src/tests/unit/admin-core-operations.test.ts` 验证用户 360° 档案脱敏、作品混合批量审核与系统状态摘要。

## 3. 验证命令

```powershell
pnpm lint
npx tsc --noEmit
pnpm test
git diff --check
```
