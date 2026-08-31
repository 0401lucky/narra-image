# 设计：审核引擎（敏感词 + AI 审核 + 拦截）

## 边界 / 范围

- 审核对象：`prompt` 与 `negativePrompt` 文本（不做图片/视觉审核，MVP）。
- 覆盖入口：WEB `POST /api/generate`、外部 `v1/images/generations`、`v1/images/edits`（网关与直连两路径同一 lib）。`v1/chat/completions`、`v1/responses` 文本入口列入后续（本设计备注，不扩大范围）。
- 行为（已确认）：**严格阻断**——任一命中即拒绝生成，不扣积分、不建 job；事件落库 + 用户可聚合标记。
- 降级：AI 审核未配置/异常/超时 → 放行并记 warn 日志；整体可开关；审核关闭时行为等于现状。

## 数据模型（Additive）

```prisma
model ContentReview {
  id             String   @id @default(cuid())
  userId         String
  kind           String   // "sensitive_word" | "ai_moderation"
  prompt         String
  negativePrompt String?
  hitWords       String[] @default([])   // 敏感词命中列表
  category       String?                 // 词库类别 / AI 类别
  aiScore        Float?                  // AI 违规分（0-1）
  aiModel        String?
  createdAt      DateTime @default(now())
  user           User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
  @@index([kind, createdAt])
}

model ModerationConfig {
  id                    String   @id @default(cuid())
  scope                 String   @unique @default("default")
  isEnabled             Boolean  @default(false)
  sensitiveWordsEnabled Boolean  @default(true)
  aiEnabled             Boolean  @default(false)
  aiBaseUrl             String?
  aiApiKeyEncrypted     String?  // AES-GCM, 复用 provider-secret
  aiModel               String?  @default("text-moderation-latest")
  aiThreshold           Float    @default(0.5)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

- `User` 增加 `contentReviews ContentReview[]` 关系（后台聚合触发次数）。
- 用户「标记」= 存在 `ContentReview` 记录 + 后台聚合，不在 User 加冗余字段（MVP）。

## 词库（`src/lib/moderation/sensitive-words.ts`）

- 结构化 `Record<Category, string[]>`，类别 `NSFW | VIOLENCE | HATE | ILLEGAL`。
- 匹配策略（模块级编译缓存）：
  - 英文词/短语：整体小写 + `\b(?:word|phrases)\b` 正则（短语用 `\s+`/转义连接），避免 `ass`/`sex` 子串误杀。
  - 中文词：直接 `includes`（中文无词边界）。
- 误杀控制是验收核心：词库用精确词/短语，补充艺术词免杀用例（`naked portrait`、`blood moon` 不触发）。
- 词库导出结构供后台只读展示（类别/计数）。

## 审核流程（`src/lib/moderation/check.ts`）

```ts
export async function checkGenerationInput(input: {
  userId: string;
  prompt?: string | null;
  negativePrompt?: string | null;
}): Promise<{ allowed: true } | { allowed: false; message: string }>
```

流程：
1. `getModerationConfig()`（DB 单行；未启用 → allowed）。
2. 敏感词（`sensitiveWordsEnabled` 时）：`prompt + negativePrompt` 做匹配；命中 → 写 `ContentReview`（kind=sensitive_word, hitWords, category）→ `{ allowed: false }`。
3. AI（`aiEnabled && aiBaseUrl && key` 时）：仅对 prompt 调用 OpenAI 兼容 `POST {baseUrl}/moderations`（`model=aiModel`）；解析 `results[0].flagged` 或按 `category_scores` 最高分 ≥ `aiThreshold` → 写 `ContentReview`（kind=ai_moderation, aiScore, category）→ blocked。
   - 网络异常/超时（≤8s）/非 2xx → catch：`console.warn` 后**放行**。
4. 未命中 → `{ allowed: true }`。

- 配置读取优先级：DB `ModerationConfig` > env（`MODERATION_*` 提供默认/兜底）。
- `getModerationConfig/updateModerationConfig` 沿用 `TurnstileConfig` 单行 scope 模式；`aiApiKeyEncrypted` 复用 `encryptProviderSecret/decryptProviderSecret`。

## env（同步四件套）

`src/lib/env.ts`（zod）新增：
- `MODERATION_ENABLED`（默认 "false"）
- `MODERATION_SENSITIVE_WORDS_ENABLED`（"true"）
- `MODERATION_AI_ENABLED`（"false"）
- `MODERATION_BASE_URL`（optional url）
- `MODERATION_API_KEY`（optional）
- `MODERATION_MODEL`（"text-moderation-latest"）
- `MODERATION_THRESHOLD`（0.5）

同步：`contracts/runtime/v1/environment.json`、`.env.example`、`README.md`、`runtime-environment-contract.test.ts`（质量规范 #5）。

## 接入点

- `POST /api/generate`：`requireCurrentUserRecord` 后、成本计算/建 job 前：`body.prompt` / `negativePrompt` 过 `checkGenerationInput`；blocked → `jsonError(message, 400)`。
- `v1/images/generations`、`v1/images/edits`：`requireApiUser` 后、gateway/直连分支前：以 `auth.user.id` + `body.prompt`/`negativePrompt` 过同一函数。

## 契约

- 新增：`ContentReview`（记录）、`ModerationConfig`（配置）。
- 拦截响应：统一 message「提交内容包含违规描述，已拒绝生成」；前端/调用方按现有 jsonError 处理。
- AI 请求体兼容 OpenAI moderations v1。

## 上线 / 回滚

- DB：Additive 建两表，历史数据不受影响。
- 默认 `MODERATION_ENABLED=false`（线上先不生效）；后台/环境开启后逐层生效。
- 回滚：关闭开关即可回到现状；代码回退为删除 lib 文件与接入点 + 不再写记录。