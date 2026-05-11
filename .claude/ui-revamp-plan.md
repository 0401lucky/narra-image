# 作品分页 + UI 美化规划

生成时间：2026-05-01

## 一、作品页分页（第一阶段，立即实施）

### 现状
- `src/lib/server/works.ts:70` `listUserWorks(userId, take=60)`：一次性取 60 条，无 cursor
- `src/app/works/page.tsx`：SSR 调 listUserWorks 直接传给 MyWorksBoard
- `src/components/works/my-works-board.tsx`：纯渲染，无追加逻辑
- counts（"全部/待审核/已公开"）目前基于已加载的 60 条，作品多于 60 张时数字不准

### 设计：cursor + 加载更多
- cursor 编码：`base64url(JSON.stringify({ createdAt, id }))`，与 `listFeaturedWorksPage` 一致
- 排序：`[{ createdAt: desc }, { id: desc }]`
- 取 `take + 1` 判断 `hasMore`，避免反复 count
- counts 用 `db.generationImage.count` + `groupBy(showcaseStatus)` 单独查，不依赖已加载列表

### 文件变更
1. `src/lib/server/works.ts`：新增 `listUserWorksPage({ userId, cursor, limit })`，保留 `listUserWorks` 兼容
2. `src/lib/server/works.ts`：新增 `getUserWorksCounts(userId)` 返回 `{ total, pending, featured }`
3. `src/app/api/me/works/route.ts`（新建）：`GET` 返回分页数据
4. `src/app/works/page.tsx`：只 SSR 第一页，传 `initial: { items, hasMore, nextCursor }` + counts
5. `src/components/works/my-works-board.tsx`：客户端追加 state、加载更多按钮、骨架、失败重试

### 验证
- 已知账号有 >24 张作品时第一页显示 24 张 + "加载更多"
- 点击加载更多追加，按钮显示 spinner，完成后追加新批次
- 加载到底后按钮消失
- counts 与全部作品总数一致（不会因为只加载首页就变小）
- 删除一张作品后立即从列表移除，counts -1
- 加载失败显示错误条 + 重试按钮

---

## 二、UI 美化（第二阶段，等用户挑优先级）

### P0 — 缺失的地基（强烈建议必做）
| 项 | 文件 | 说明 |
|---|---|---|
| a | `src/app/error.tsx` | 全局运行时错误页，2 个按钮（重试 / 回首页） |
| b | `src/app/not-found.tsx` | 全局 404，复用站点视觉 |
| c | `src/app/loading.tsx` | 路由级骨架占位 |
| d | `src/components/ui/spinner.tsx` | 通用旋转加载（size-3/4/5） |
| d | `src/components/ui/skeleton.tsx` | 通用骨架占位 |
| d | `src/components/ui/empty-state.tsx` | 通用空状态（图标+标题+描述+CTA） |
| d | `src/components/ui/alert.tsx` | 通用错误/警告/成功条（role=alert） |
| e | `src/app/globals.css` | 全局 `prefers-reduced-motion` 兜底 |

### P1 — 体感升级
| 项 | 范围 | 说明 |
|---|---|---|
| f | works/featured 卡片 | motion staggered fade-up（错峰 40ms，duration 280ms） |
| g | globals.css + 全站 | z-index token：dropdown 10 / sticky 20 / overlay 30 / modal 50 / toast 60，替换魔法值 z-[120] |
| h | inline 错误条 → Alert | 创作台、my-works-board 现有 inline 错误条统一改用 Alert 组件 |
| i | 按钮悬停规范 | 主按钮 transition-all 200ms ease-out + hover:shadow-md，去掉 scale 抖动 |

### P2 — 锦上添花
| 项 | 范围 | 说明 |
|---|---|---|
| j | layout.tsx | motion.AnimatePresence 路由切换淡入（桌面） |
| k | 全站 lucide 图标 | 统一 size-4/size-5，现有 size-3/3.5 等收敛 |
| l | 创作台动画 | 现有 `animate-in` 类 Tailwind v4 不内置，改用 motion 实现入场 |
| m | SiteHeader | 滚动方向感知 hide-on-scroll |

### 动效原则（来自 ui-ux-pro-max 知识库）
- 时长 150–300ms，>500ms 即卡顿感
- ease-out 入场 / ease-in 退场，禁用 linear
- 无限循环动画仅限 loader 类
- **必须**响应 `prefers-reduced-motion`（高优 a11y）
- hover 反馈用 translateY/shadow/border，不用 scale（防布局抖动）

### 错误/空态模式
- 空：图标 + 文案 + 明确下一步 CTA
- 错：role="alert" + 错误描述 + 重试按钮
- 加载：骨架优于 spinner，spinner 仅在按钮内
