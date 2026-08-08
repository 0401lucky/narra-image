# 前端状态管理

## 1. 适用范围与触发条件

- 适用于组件状态（本地状态、跨组件共享、服务端数据）的存放位置与读写约定。
- 新增全局 store、把数据源从 server 移到 client、或改变轮询/缓存方式前，必须先读本规范。

## 2. 现状（真实模式）

- **不使用任何全局状态库**（无 zustand / redux / jotai / react-query）。依赖只有 React 自带能力 + Next.js server 能力。
- 状态分三层：
  1. **服务端数据**（事实来源）——Server Components 直接查 `@/lib/db`（Prisma），`serialize` 成纯 JSON 后作为初始 props 传给 client 组件。
  2. **本地 UI 状态**——`useState`，只在组件内可见。
  3. **客户端刷新数据**——client 组件经 `/api/*` 轮询/提交后更新本地状态。

## 3. 服务端数据 → 客户端传递

- Server Components 负责初始数据，禁止在 client 侧重复查询全量：

```tsx
// src/app/works/page.tsx（server）
const [initialPage, counts, myVideos] = await Promise.all([
  listUserWorksPage({ userId: user.id, limit: 24 }),
  getUserWorksCounts(user.id),
  db.generatedVideo.findMany({ ... }),
]);
const currentUser = serializeUser(user);
return <MyWorksBoard currentUser={currentUser} ... />;
```

- 传递前必须 `serialize`（见 `src/lib/prisma-mappers.ts`），把 Date/枚举转成纯 JSON 类型，禁止把 Prisma 实体直接传 client。

## 4. 客户端状态与刷新

- 交互后需要刷新列表/结果时，client 调 `/api/*` 拿到结果后更新本地 `useState`，或触发轮询 hook。
- 长任务（图片/视频生成）用轮询 hook（`useImagePoller`）消费 `GET /api/me/generations/{id}`，命中终态停止；刷新数据不从数据库直连。
- 需要在多个子组件间共享的派生状态由**容器组件**（如 `create/generator-studio.tsx`）持有，经 props 下发，不引入全局 store。

## 5. 表单状态

- 表单输入用受控 `useState` 或 FormData；提交前用 zod schema（`src/lib/validators.ts`）校验，错误消息中文。
- 提交结果错误用 `Alert` 组件（`variant` 区分 error/warning/success/info）展示，不写裸 `alert()`。

## 6. 禁止与常见错误

- 禁止为了"省事"引入全局 store——先评估是否能用 server 初始数据 + 容器组件 props 解决。
- 禁止 client 组件直接 `import { db } from "@/lib/db"` 或查 Prisma——数据只能来自 props 或 `/api/*`。
- 禁止把可复用业务数据缓存在组件外部模块级变量（跨请求泄漏）。
- 禁止在 server 与 client 间传递非序列化值（Date 实例、Buffer、函数）。
