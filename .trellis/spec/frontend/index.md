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
| [State Management](./state-management.md) | 无全局状态库：server 初始数据 + 本地 useState + `/api/*` 轮询 | Active |
| [Type Safety](./type-safety.md) | `types.ts` 字面量联合、zod 中文校验、`prisma-mappers` 序列化、server-only | Active |
| [Quality Guidelines](./quality-guidelines.md) | lint/tsc/vitest/构建命令、mock 模式、DB 哨兵与验证 wrapper | Active |
| [Generation Worker Contracts](./generation-worker-contracts.md) | Node/Go/PostgreSQL 生成生命周期与契约验证 | Active |

---

## 使用方式

- 新增页面/组件/服务/测试前，先读 [Directory Structure](./directory-structure.md) 确定归属。
- 编写组件读 [Component Guidelines](./component-guidelines.md)；编写 hook 读 [Hook Guidelines](./hook-guidelines.md)。
- 数据流设计读 [State Management](./state-management.md)；跨 server/client 边界读 [Type Safety](./type-safety.md)。
- 提交前按 [Quality Guidelines](./quality-guidelines.md) 的验证命令执行。

---

**Language**: 文档使用**中文**（与项目其余 spec `operations/`、`generation-worker-contracts.md` 保持一致）。
