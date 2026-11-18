# 阶段三执行清单：生成流水排障抽屉、生图渠道测速检索与运营码表闭环

## 1. 前置检查

- 确认 `11-18-admin-ui-foundation` 与 `11-18-admin-core-operations` 已完成并通过质量门禁。

## 2. 实施步骤（Ordered Checklist）

- [x] **Step 1：生成流水多维筛选、视频支持与只读排障抽屉**
  - 实现 `src/app/api/admin/generations/[id]/route.ts`（只读 `GET`，脱敏一切密钥字段）。
  - 升级 `src/app/admin/generations/page.tsx`（无额外筛选参数时严格保留原默认 `where` 结构，支持 `status/type/source/mode` 筛选并关联 `videos`）。
  - 升级 `GenerationSearchBar`、`GenerationAdminList`、`GenerationAdminCard` 并新增 `GenerationDiagnosticDrawer`（展示视频预览、`errorCode/errorMessage`、`GenerationAttempt` 轨迹、复制排障摘要与跳转用户页链接）。
- [x] **Step 2：生图渠道测速、模型搜索与可视化排序**
  - 重构 `src/components/admin/channel-manager.tsx`：修复 `<label><button>` 嵌套、增加模型搜索框、增加单卡连通测速、增加上下移排序按钮及未保存关闭二次确认。
- [x] **Step 3：邀请码、兑换码、API Key 与福利页补齐**
  - 为 `InviteCreator` 与 `RedeemCodeCreator` 所有输入框补齐可见 `<label>`。
  - 在 `src/app/api/admin/redeem-codes/batches/[id]/route.ts` 补充 `GET` 批次详情接口并实现 `RedeemBatchViewModal`；修复 `/admin/redeem-codes` 启用数精确统计并接入搜索、状态筛选与分页。
  - 升级 `/admin/invites`（替换空白占位卡为真实领取转化统计、接入搜索与状态筛选、补齐移动端复制与删除按钮）与 `/admin/api`（服务端搜索、状态筛选与分页）。
- [x] **Step 4：编写单测并执行全量契约与质量门禁**
  - 验证 `admin-generations-page.test.tsx`、`admin-generations-route.test.ts`、`admin-channels-route.test.ts`、`provider-models-probe-route.test.ts` 及新增 `admin-diagnostics-and-tooling.test.ts` 全部通过。

## 3. 验证命令

```powershell
pnpm lint
npx tsc --noEmit
pnpm test
pnpm verify:worker-contracts:ts
git diff --check
```
