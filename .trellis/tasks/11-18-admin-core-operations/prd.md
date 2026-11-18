# 阶段二：概览大盘、风控合一、用户 360 管理与作品批量审核升级

## Goal

基于阶段一（`11-18-admin-ui-foundation`）建立的现代运营台原语与壳层，打通后台核心高频运营场景：用真实系统健康度与待办角标取代硬编码假状态，将概览页升级为带 7 日趋势可视化的行动导向中枢，收口分裂的内容风控模块，并将用户管理与作品审核升级为支持高密度筛选、360° 详情抽屉、视频作品审核与多选批量操作的专业运营工作台。

## Background & Confirmed Facts

- **前置依赖**：必须先完成 `11-18-admin-ui-foundation`（依赖 `AdminDrawer`、`AdminTabs`、`AdminSwitch`、`AdminConfirmDialog` 与 `AdminToastProvider`）。
- **大盘与设置现状**：`src/app/admin/page.tsx:30-66,83` 仅展示 7 个静态 `count()` 且使用挤压的 `2xl:grid-cols-7`，缺乏趋势与待办队列；`src/components/admin/admin-frame.tsx:260-263` 绿灯硬编码“系统正常”；`src/app/admin/settings/page.tsx:14-51` 六张入口卡无任何实时启用/配置状态透出。
- **风控分裂现状**：`/admin/moderation`（拦截记录）与 `/admin/settings/moderation`（规则与内置敏感词库）同名无互跳，拦截记录不支持关键词/用户检索，敏感词库（`src/components/admin/moderation-config-form.tsx:269-281`）仅大段顿号纯文本罗列。
- **用户管理现状**：`src/app/admin/users/page.tsx` 仅支持 `q` 搜索，无角色/封禁/OAuth 来源筛选与排序；大卡片占屏低效；积分调整器 `[ 50 ] [ 更新积分 ]`（`src/components/admin/admin-actions.tsx:1309-1328`）语义模糊；无法查看用户的生成、签到、兑换与邀请码详情。
- **作品审核现状**：`src/lib/server/works.ts:336-362` 使用 `take: 120` 单次拉取后在前端分组计数（`src/app/admin/works/page.tsx:23-27`），超量即失真且同屏渲染过重；虽然后端 `src/app/api/admin/works/[id]/review/route.ts:27-59` 已支持 `mediaType: "video"`，但前端完全不支持视频作品审核与多选批量操作。

## Requirements

- **R1（真实系统状态与待办角标聚合）**：新增服务端状态聚合逻辑与 `GET /api/admin/system-status`，汇总数据库/存储就绪度、启用生图渠道数、存储已用比例、待审图片+视频投稿数、待处理下架数、待协调任务数及失败提示词源数，驱动顶栏真实健康状态指示器与侧栏菜单待办数量角标。
- **R2（行动导向概览大盘与设置总览状态徽章）**：重构 `/admin` 概览页为响应式 4 列核心 KPI 卡（含今日新增对比）+ 7 日生图任务（成功/失败）与积分消耗双维度纯 SVG 趋势图 + 可一键直达的「待办事项与异常巡检」面板 + 存储/渠道健康速览；为 `/admin/settings` 总览页全部 6 张配置卡补齐实时开启/配置状态徽章。
- **R3（内容风控双视图联动与检索升级）**：在 `/admin/moderation` 与 `/admin/settings/moderation` 顶部提供统一的「拦截记录与封禁 / 审核规则与词库」联动切换；拦截记录新增按提示词/命中词/用户邮箱昵称的搜索框；内置敏感词库升级为支持即时关键词过滤的分类胶囊视图。
- **R4（用户管理表格化、多维筛选排序与 360° 详情抽屉）**：`/admin/users` 新增紧凑表格视图（默认）与卡片视图切换，支持按角色（管理员/用户）、状态（正常/封禁）、登录源（邮箱/LinuxDo）筛选及按注册时间/当前积分/生成次数排序；重构积分调整器为明确的「+增加 / -扣减」模式并带快捷额度芯片与变更后余额实时预览；新增 `GET /api/admin/users/[id]` 与用户 360° 侧滑详情抽屉（展示注册邀请码、OAuth 绑定、最近生成、最近签到/兑换与 API Key）。
- **R5（作品审核精确统计、分页 Tab、视频接入与批量审核）**：将 `/admin/works` 改为服务端独立精确计数 + 状态 Tab（`待审核 / 下架申请 / 已公开`）+ 媒体类型筛选（`全部 / 图片 / 视频`）+ 关键词搜索 + 分页；接入 `GeneratedVideo` 视频作品预览与单条审核；新增 `POST /api/admin/works/batch-review` 与前端多选工具栏，支持批量通过、批量拒绝与批量强制下架（共享可选审核备注）。

## Acceptance Criteria

- [ ] **AC1（R1/R2）**：顶栏系统状态随真实渠道/就绪/异常信号变化（如无启用渠道或有异常项时显示对应提醒状态而非盲目“系统正常”）；侧栏「作品审核」等入口正确显示待处理角标；概览页 4 列 KPI 无挤压且正确渲染 7 日 SVG 趋势图与待办队列；`/admin/settings` 卡片展示实时状态徽章。
- [ ] **AC2（R3）**：`/admin/moderation` 与 `/admin/settings/moderation` 可通过顶部 Tab 无缝切换，拦截记录支持关键词/用户搜索，敏感词库支持前端即时检索过滤。
- [ ] **AC3（R4）**：`/admin/users` 支持表格/卡片切换、角色/封禁/OAuth 筛选与三种排序；积分增减器清晰展示 `当前 -> 变更后` 余额并支持正负校验；点击用户可滑出 360° 详情抽屉查看完整关联摘要。
- [ ] **AC4（R5）**：`/admin/works` 顶部三项指标采用服务端独立 `count`（合并图片与视频）不再受单页条数截断；支持图片与视频作品分 Tab 分页浏览、搜索、单条审核及多选批量审核；既有 `admin-work-image-refresh.test.tsx` 保持通过。
- [ ] **AC5（质量门禁）**：新增接口与组件单测通过，`pnpm lint`、`npx tsc --noEmit`、`pnpm test` 全部通过。

## Out of Scope

- 生成记录流水排障抽屉、生图渠道连通测速与邀请码/兑换码/API Key 页升级（属阶段三 `11-18-admin-diagnostics-and-tooling`）。
- 数据库 Schema 迁移。
