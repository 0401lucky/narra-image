# 前端类型安全

## 1. 适用范围与触发条件

- 适用于 TypeScript 类型组织、输入校验、server/client 边界类型与 Prisma 类型使用。
- 新增业务类型、zod schema、序列化函数或 server-only 模块前，必须先读本规范。

## 2. 类型组织

- **跨域业务类型**聚合在 `src/lib/types.ts`：以字面量联合类型表达领域枚举，不复制 Prisma 枚举。

```ts
// src/lib/types.ts
export type ProviderMode = "built_in" | "custom";
export type GenerationType = "text_to_image" | "image_to_image" | "text_to_video" | "image_to_video";
export type GenerationQuality = "auto" | "low" | "medium" | "high";
export type GenerationOutputFormat = "png" | "jpeg" | "webp";
export type GenerationModeration = "auto" | "low";
export type UserRole = "user" | "admin";
```

- feature 内私有类型放该 feature 的 `types.ts`（如 `create/types.ts` 的 `GenerationItem`、`ReferenceImage`、`SessionInfo`）。
- 类型与值分开：只用类型时用 `import type`，避免运行时打包引入。

## 3. 输入校验（zod）

- 所有外部输入（API body、表单、URL 参数）必须经 zod schema 校验，schema 集中在 `src/lib/validators.ts`。
- 错误消息写中文，内联在 schema 上：

```ts
// src/lib/validators.ts
export const registerSchema = z.object({
  email: z.email("请输入正确的邮箱"),
  inviteCode: z.string().trim().default(""),
  password: z.string().min(8, "密码至少 8 位"),
  turnstileToken: z.string().optional(),
});
```

- 需要归一化的字段用 `transform` + `z.RefinementCtx`（如 `generationSizeSchema` 把任意尺寸字符串归一到 `GenerationSizeToken`）。
- 解析失败统一走 API 层错误映射（`openAiError` / 中文错误响应），不在路由内裸 `console.log`。

## 4. Server / Client 边界类型

- **server-only 模块**必须 `import "server-only"`（`src/lib/server/`、`src/lib/generation/*` 等），防止被 client bundle 引用。
- **Prisma 实体禁止直接跨边界传递**。用 `src/lib/prisma-mappers.ts` 的 `SerializedXxx` 类型 + serialize 函数转纯 JSON：

```ts
// src/lib/prisma-mappers.ts
export type SerializedGeneration = {
  cancelRequestedAt: string | null;
  completedAt: string | null;
  // ...日期已字符串化、枚举转字面量联合
};
export function serializeGeneration(job: GenerationJob & {...}): SerializedGeneration { ... }
```

- client 组件 props 一律使用 Serialized 类型，不用 Prisma 生成类型。

## 5. API 返回类型

- 路由响应结构用明确的返回类型（`formatImageGenerationData`、`SerializedGeneration` 等），不裸返回 `any`。
- fetch 响应先按已知结构断言（`as { data?: { generation: GenerationItem } }`），缺失字段按防御处理，不假设存在。

## 6. 禁止与常见错误

- 禁止把 `process.env` 直接读进组件——统一经 `src/lib/env.ts` / `src/lib/public-env.ts` loader（环境契约审计会拒绝）。
- 禁止 `any` 泄漏：未知输入先 zod 校验，再收窄到明确类型。
- 禁止在 client 组件 import server-only 模块（构建即报错）。
- 禁止两端各自维护一份字段清单——共享字段以 `contracts/*` JSON + 对应 TS/Go 类型为准（见 `generation-worker-contracts.md`）。
