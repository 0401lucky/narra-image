# 前端质量指南

## 1. 适用范围与触发条件

- 适用于 lint、类型检查、测试与生产构建的约定和验证入口。
- 新增测试文件、修改 lint 配置、调整验证脚本或提交代码前，必须先读本规范。

## 2. 工具链（现状）

- **lint**：ESLint 9 + `eslint-config-next`（`core-web-vitals` + `typescript`），`eslint.config.mjs` 管理；`pnpm lint`。
- **类型检查**：`pnpm exec tsc --noEmit`（严格模式，项目 `tsconfig.json`）。
- **测试**：Vitest 4 + Testing Library（`@testing-library/react`、`@testing-library/jest-dom`），环境 `jsdom`；`pnpm exec vitest run`。
- **生产构建**：`pnpm build`（Next 生产构建，验证所有 route 可编译）。
- **契约验证**：`pnpm verify:*` wrapper（见 operations/release-hardening.md 与各验证脚本）。

## 3. 测试组织与写法

- 测试位置：`src/tests/unit/`（服务/组件/路由）、`src/tests/integration/`（真实依赖）、`src/tests/contracts/`（共享契约 fixtures）。
- 组件测试用 `.test.tsx` 并渲染真实组件 + `@testing-library/user-event` 交互；服务/路由测试用 `.test.ts`。
- **依赖 mock 用 `vi.mock` + `vi.hoisted`** 声明 mock 函数，模块级 mock 放在 import 之前：

```ts
// src/tests/unit/external-v1-routes.test.ts
const { mockRequireApiUser, mockRunExternalGeneration } = vi.hoisted(() => ({
  mockRequireApiUser: vi.fn(),
  mockRunExternalGeneration: vi.fn(),
}));
vi.mock("@/lib/generation/external-api", () => ({ runExternalGeneration: mockRunExternalGeneration }));
```

- 测试环境变量：需要 `getEnv()` 的测试在 `beforeEach` 显式设置 `process.env.AUTH_SECRET` / `DATABASE_URL` 等（不依赖 `.env`）。
- `server-only` 在测试中由 `vitest.config.ts` alias 到 `src/tests/setup/server-only.ts`。
- DB 集成测试必须带哨兵（`WORKER_CONTRACTS_REQUIRE_DB=1` + `TEST_DATABASE_URL`），禁止回退开发库（见 `generation-worker-contracts.md`）。

## 4. 验证命令

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vitest run            # 全量（CI 用 --testTimeout=30000 --exclude worker-contracts-db）
pnpm build
pnpm verify:ci                  # 一揽子：发布脚本单测 + tsc + lint + vitest + 契约 + go + build
pnpm verify:worker-contracts:ts/go/db
pnpm verify:gateway:ts/go/db
pnpm verify:migrations
pnpm verify:e2e
```

- GitHub Actions 只调用仓库内 wrapper（`.github/workflows/verify.yml`），不复制命令清单。
- `git diff --check` 提交前必须通过（无空白错误）。

## 5. 已知约束

- 全量 vitest 需 `--testTimeout=30000`（部分组件测试冷启动较慢）；`worker-contracts-db.test.ts` 由 `verify:worker-contracts:db` 单独覆盖，全量时排除。
- 每个验证 wrapper 保留真实退出码并受全局截止保护（见各 `verify-*.mjs`）。
- 环境变量修改必须先改 `contracts/runtime/v1/environment.json` 再同步 `src/lib/env.ts`、`.env.example`、README 与测试（`runtime-environment-contract.test.ts` 会校验一致性）。

## 6. 禁止与常见错误

- 禁止跳过 lint/tsc 提交；warning 可接受但 error 必须清零。
- 禁止测试直接连接开发/生产数据库；DB 测试只连 runner 自建 disposable PostgreSQL。
- 禁止测试内 `console.log` 残留、`it.only` / `test.only` / `describe.only`。
- 禁止在测试里断言实现细节（如 mock 调用次数）替代行为验证——优先断言响应/渲染结果。
