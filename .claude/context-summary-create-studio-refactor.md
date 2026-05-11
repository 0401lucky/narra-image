## 项目上下文摘要（创作台审查与优化）
生成时间：2026-05-04

### 1. 相似实现分析
- **核心文件**: `src/components/create/generator-studio.tsx` (1398 行)
  - 模式：单文件大组件，集中持有约 20 个 useState
  - 可复用：内嵌 `genSessionId` / `loadSessions` / `saveSessions` / `parseSizePixels` / `describeSizeDowngrade` 函数
  - 需注意：localStorage 直存、轮询无退避、IME 输入未处理

- **生成 API**: `src/app/api/generate/route.ts`
  - 模式：先建 PENDING 任务+预扣积分，`after()` 后台调模型
  - 失败时退还积分 + 标记 FAILED
  - **关键约束**：`parseFormData` 中 `count: 1` 硬编码（src/lib/generation/parse-generate-request.ts:61,90）

- **图像生成器**: `src/lib/providers/generate-images.ts`
  - text_to_image：`n: input.count`（行 130）
  - image_to_image：`n: 1` 硬编码（行 120）—— 模型接口限制

- **轮询查询 API**: `src/app/api/me/generations/[id]/route.ts`
  - 简单 GET，返回 serializeGeneration 结果

### 2. 项目约定
- **命名约定**: 文件 kebab-case，组件 PascalCase，函数/变量 camelCase
- **文件组织**: `src/components/<feature>/<component>.tsx`，hooks/parts 子目录目前未启用
- **导入顺序**: 第三方包 → `@/` 别名内部模块；ESM 默认导入优先
- **代码风格**: TypeScript 严格、Tailwind v4、无 BOM UTF-8

### 3. 可复用组件清单
- `@/components/ui/alert`: 错误/通知 Alert
- `@/lib/generation/sizes.ts`: 尺寸归一化、长宽比
- `@/lib/image-url.ts`: getThumbUrl 缩略图代理
- `@/lib/types`: 生成相关枚举类型

### 4. 测试策略
- **测试框架**: Vitest 4 + jsdom + @testing-library/react
- **现有测试**: `src/tests/unit/generator-studio-edit.test.tsx`（图生图入口、点击切换）
- **运行命令**: `pnpm test`（vitest run），过滤：`pnpm vitest run src/tests/unit/generator-studio-edit.test.tsx`

### 5. 依赖和集成点
- **外部依赖**: motion/react、lucide-react、next/navigation
- **内部集成**: `/api/generate`、`/api/me/generations/[id]`、`/api/proxy-image`
- **数据来源**: `src/app/create/page.tsx` SSR 拉取 jobs/channels/checkInSummary

### 6. 修复实施计划

**阶段 1（核心 Bug 修复，编辑 generator-studio.tsx）**
1. IME 合成态 — 阻止中文输入选词时误发送
2. switchToSession 保留新生成 — 维护 generation Map
3. 图生图 count 一致性 — 隐藏不生效的 UI
4. 轮询退避 + 可见性暂停 — setTimeout+visibilitychange
5. 自动滚动只在贴底时触发
6. 模型选择 filter 修复 + 切换 channel 校验 model

**阶段 2（架构改进）**
7. 拆分组件 — 抽取 hooks 与子组件
8. 会话上服务端 — Conversation 表 + API + 前端切换

### 7. 关键风险点
- **count 后端硬编码**: 图生图 `n: 1` 是模型接口限制，前端只能隐藏 UI 而非真补字段
- **localStorage 跨标签不同步**: 阶段 2 将通过服务端会话彻底解决
- **测试覆盖不足**: 现有测试只覆盖图生图入口，需补充 IME / 轮询 / 切换会话相关用例
- **prisma migration（仅阶段 2）**: 增加 Conversation 表需要数据库 migration，需谨慎
