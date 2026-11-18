# 执行与集成验收计划：管理后台现代运营台重构

## 1. 子任务推进顺序

严格按以下顺序逐个子任务启动（`task.py start <child>`）、实施、执行 `trellis-check` 并归档，不直接 `start` 父任务：

1. **阶段一：`11-18-admin-ui-foundation`**
   - 交付 CSS `@layer` 修复、Warm Editorial Bento 令牌、`src/components/admin/ui/*` 原语库、可折叠分组侧栏 + 精确面包屑 + `⌘K` 面板 + `/admin/loading.tsx`，并清零全后台 `window.confirm/alert` 与破损弹窗。
2. **阶段二：`11-18-admin-core-operations`**（前置：`11-18-admin-ui-foundation` 完成）
   - 交付真实健康度与角标服务、概览大盘（7日趋势 + 待办队列）、设置总览实时状态卡、风控日志/规则词库联动、用户管理表格/筛选/增减积分预览/360° 抽屉、作品审核服务端分页 Tab + 视频审核 + 批量审核。
3. **阶段三：`11-18-admin-diagnostics-and-tooling`**（前置：`11-18-admin-ui-foundation` 与 `11-18-admin-core-operations` 完成）
   - 交付生成记录多维筛选 + 视频任务支持 + 只读排障与 `GenerationAttempt` 抽屉、生图渠道单卡测速 + 模型搜索 + 可视化排序、邀请码/兑换码/API Key/福利页统计修复与检索分页闭环。

## 2. 跨阶段集成质量门禁（Validation Commands）

每个阶段完成及最终集成验收时均必须执行并通过：

```powershell
pnpm lint
npx tsc --noEmit
pnpm test
pnpm verify:worker-contracts:ts
git diff --check
```

## 3. 高风险文件与检查点

- `src/app/globals.css`：严禁改动 `:root` 全局变量或前台 `.studio-card` / `.gallery-card` / `.auth-*` 行为，所有改动严格限定在 `.admin-console` 与后台专属类名下。
- `src/components/admin/storage/storage-manager.tsx`：保留 `storage-manager.test.tsx` 依赖的全部 `data-testid` 与无障碍角色标签。
- `src/app/admin/generations/page.tsx` 与 `src/app/api/admin/generations/**`：保留无筛选参数时的默认 `where` 结构，且绝不触碰 `contractVersion >= 1` / `HANDOFF_UNKNOWN` 的写保护边界。
- 完成后检查是否需将后台 UI 原语与设计约定沉淀至 `.trellis/spec/frontend/`（`trellis-update-spec`）。
