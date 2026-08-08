# 前端目录结构

## 1. 适用范围与触发条件

- 适用于在 `src/` 下新增/移动页面、路由、组件、hooks、服务或测试文件时的组织约定。
- 新增功能目录、拆分 feature 组件、新增 lib 模块或测试分类前，必须先读本规范。

## 2. 顶层布局

```text
src/
  app/                 # Next.js App Router：页面 + API 路由 + 边界文件
  components/          # React 组件（按功能域组织）
  lib/                 # 非组件业务逻辑（按域组织）
  tests/               # 测试（unit / integration / contracts / setup）
```

- 路径别名 `@/` 指向 `src/`（如 `@/lib/db`、`@/components/ui/alert`）。
- 所有跨目录 import 必须使用 `@/` 别名；只有 feature 目录内部引用才用相对路径（`./hooks/...`、`./constants`、`./parts/...`）。

## 3. app 路由约定

- 页面文件 `page.tsx`、API 路由 `route.ts`、边界文件 `error.tsx` / `loading.tsx` / `not-found.tsx` 直接放在对应路由目录。
- 服务端页面（需要 DB/鉴权）不写 `"use client"`，直接异步 `await` 查询后把纯数据传给 client 组件（见 `src/app/works/page.tsx`：`getCurrentUserRecord` → `listUserWorksPage` → `serializeUser` → 渲染 `MyWorksBoard`）。
- 公开 OpenAI 兼容入口集中在 `src/app/v1/`（`images/generations`、`images/edits`、`responses`、`chat/completions`、`generations/[id]`）。
- 页面级安全跳转用 `redirect()`（如未登录 `redirect("/login")`）。

## 4. components 组织

- 按**功能域**建目录：`create`、`works`、`video`、`admin`、`prompts`、`settings`、`auth`、`invites`、`marketing`、`layout`、`benefits`、`pet`、`api`。
- 通用基础组件放 `src/components/ui/`（`alert`、`skeleton`、`spinner`、`empty-state`）。
- 一个 feature 目录内可再拆：
  - `parts/` — 该 feature 的子组件（如 `create/parts/chat-stream.tsx`、`create/parts/composer.tsx`）
  - `hooks/` — 该 feature 的 hooks（`create/hooks/use-image-poller.ts`）
  - `constants.ts` — UI 选项/文案常量（`create/constants.ts`）
  - `types.ts` — 该 feature 的本地类型（`create/types.ts`）
  - `utils.ts` — 该 feature 的纯工具（`create/utils.ts`）

```text
src/components/create/
  generator-studio.tsx   # 容器组件（状态编排 + 子组件接线）
  constants.ts
  types.ts
  utils.ts
  hooks/
    use-image-poller.ts
    use-reference-images.ts
    use-sessions.ts
  parts/
    chat-stream.tsx
    composer.tsx
    history-rail.tsx
    session-sidebar.tsx
```

## 5. lib 组织

- 按**域**组织：`auth`、`generation`、`providers`、`prompts`、`storage`、`external-api`、`invites`、`benefits`、`logging`、`server`。
- `src/lib/server/` 只放 server-only 辅助（`getCurrentUserRecord`、`api-auth`、`http`、`safe-remote-url`、`works`）；这些文件必须 `import "server-only"`。
- 跨域共享的业务类型聚合在 `src/lib/types.ts`；zod 输入校验集中在 `src/lib/validators.ts`。
- 基础设施单例放根级：`db.ts`（Prisma）、`env.ts`（环境变量 loader）、`utils.ts`（`cn`）。

## 6. 测试组织

```text
src/tests/
  unit/          # 单测（服务、组件、路由）——.test.ts / .test.tsx
  integration/   # 需要真实依赖的集成测试（如 worker-contracts/postgres-runner）
  contracts/     # 契约 fixtures 消费测试（generation-contract、gateway-contract、runtime-environment-contract）
  setup/         # vitest setup（vitest.setup.ts、server-only.ts alias）
```

- 契约/常量测试放 `src/tests/contracts/`；组件测试用 `.test.tsx`；纯逻辑测试用 `.test.ts`。

## 7. 禁止与常见错误

- 禁止把 Prisma 返回的实体对象直接传给 client 组件——必须先经 `src/lib/prisma-mappers.ts` 的 serialize 函数转成纯 JSON（含日期字符串化）。
- 禁止在 server 目录外的代码 import `src/lib/server/*`（会被 `server-only` 在客户端构建时报错）。
- 禁止跨功能目录用相对路径（如 `../../works/types`）——用 `@/`。
- 禁止把 UI 常量散落在组件文件内——集中到 feature 的 `constants.ts`。
