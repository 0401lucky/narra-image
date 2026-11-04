# Frontend Development Guidelines

> 本项目前端开发的真实约定（文档反映代码实际模式，非理想规范）。

---

## Overview

前端为 Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4 + Zod + Vitest。
文档按目录结构、组件、hooks、状态管理、类型安全、质量六个维度记录项目真实约定，供 `trellis-implement` / `trellis-check` 子代理与新人遵循。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | `src/app` / `components` / `lib` / `tests` 组织、别名与 feature 目录 | Active |
| [Component Guidelines](./component-guidelines.md) | 命名导出、`cn()`、variant 模式、无障碍与组合边界 | Active |
| [Hook Guidelines](./hook-guidelines.md) | `use-*.ts` 命名、命令式返回契约、生命周期清理与轮询模式 | Active |
| [State Management](./state-management.md) | 无全局状态库：server 初始数据 + 本地 useState + `/api/*` 轮询；server props → 本地状态的同步边界与挂载守卫 | Active |
| [Type Safety](./type-safety.md) | `types.ts` 字面量联合、zod 中文校验、`prisma-mappers` 序列化、server-only | Active |
| [Public Work Data](./public-work-data.md) | 精选显式提示词权限、非作者详情白名单、作者/后台兼容与实际下发数据验证 | Active |
| [Homepage Interactions](./homepage-interactions.md) | 首页字体/导航隔离、分页竞争、公开提示词操作及六组动效生命周期 | Active |
| [Quality Guidelines](./quality-guidelines.md) | lint/tsc/vitest/构建命令、mock 模式、DB 哨兵与验证 wrapper | Active |
| [Generation Worker Contracts](./generation-worker-contracts.md) | Node/Go/PostgreSQL 生成生命周期与契约验证 | Active |
| [Canvas Studio](./canvas-studio.md) | 合一创作卡/高级图谱、底部工具与原子参考、稳定编辑/整图拖动、账户草稿运行与真机验收边界 | Active |
| [Canvas Presentation](./canvas-presentation.md) | 创作/图谱投影、外层节点命中、工具切换、同卡编辑与底部浮层避让 | Active |

---

## 使用方式

- 新增页面/组件/服务/测试前，先读 [Directory Structure](./directory-structure.md) 确定归属。
- 编写组件读 [Component Guidelines](./component-guidelines.md)；编写 hook 读 [Hook Guidelines](./hook-guidelines.md)。
- 数据流设计读 [State Management](./state-management.md)；跨 server/client 边界读 [Type Safety](./type-safety.md)。
- 修改精选、公开图片详情或提示词复用时读 [Public Work Data](./public-work-data.md)，不能把组件隐藏当作数据脱敏。
- 修改首页视觉、画廊交互或首页导航变体时读 [Homepage Interactions](./homepage-interactions.md)，保留默认路由与草稿契约。
- 提交前按 [Quality Guidelines](./quality-guidelines.md) 的验证命令执行。
- 修改双模式创作台、画布控制器或 renderer 时读 [Canvas Studio](./canvas-studio.md)，并与 operations 的 Canvas Contracts 对照检查；改画布节点、工具、编辑和定位同时读 [Canvas Presentation](./canvas-presentation.md)。

---

**Language**: 文档使用**中文**（与项目其余 spec `operations/`、`generation-worker-contracts.md` 保持一致）。
