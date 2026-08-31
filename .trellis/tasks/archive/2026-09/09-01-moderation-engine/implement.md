# 执行计划：审核引擎

## 依赖
- 无外部依赖；`moderation-admin` 依赖本任务的模型与 repository。

## 执行清单（有序）

1. **数据模型** `prisma/schema.prisma`：新增 `ContentReview`、`ModerationConfig`，`User` 增加 `contentReviews` 关系。
2. **迁移**：`prisma/migrations/<ts>_add_content_moderation/migration.sql`（Additive 建两表 + 索引）。
3. **env 四件套**：`src/lib/env.ts` 加 `MODERATION_*`；同步 `contracts/runtime/v1/environment.json`、`.env.example`、`README.md`、`runtime-environment-contract.test.ts`。
4. **词库** `src/lib/moderation/sensitive-words.ts`：结构 + matcher（英文 `\b`、中文 `includes`），模块级编译缓存。
5. **配置 lib** `src/lib/moderation/config.ts`：`getModerationConfig`（DB 优先，fallback env）/`updateModerationConfig`，key 加密复用 `provider-secret`。
6. **审核 lib** `src/lib/moderation/check.ts`：`checkGenerationInput`（敏感词 → AI → 记录 → 返回 allowed/blocked）；AI 调用带超时与降级。
7. **接入 WEB 入口** `src/app/api/generate/route.ts`：`requireCurrentUserRecord` 后、成本/建 job 前，用 `body.prompt` / `negativePrompt`。
8. **接入外部入口** `src/app/v1/images/generations/route.ts`、`src/app/v1/images/edits/route.ts`：`requireApiUser` 后、gateway/直连前。
9. **单测** `src/tests/unit/`：
   - `sensitive-words.test.ts`：命中（中/英/短语）、免杀（艺术词）、类别。
   - `moderation-check.test.ts`（mock db + fetch）：敏感词阻断、AI 阻断（阈值）、AI 异常放行、禁用放行、记录落库参数。
10. **验证**

## 验证命令

- `pnpm db:generate`
- `pnpm verify:migrations`（disposable Postgres）
- `pnpm exec tsc --noEmit`
- `pnpm exec eslint`（改动文件）
- `pnpm exec vitest run src/tests/unit/sensitive-words.test.ts src/tests/unit/moderation-check.test.ts --testTimeout=30000`
- `pnpm build`
- `pnpm exec vitest run --testTimeout=30000`（全量回归）

## Review 门槛

- [ ] 词库命中/免杀用例全绿（误杀是核心）
- [ ] check 流程四分支（敏感词阻断 / AI 阻断 / AI 异常放行 / 禁用放行）有单测
- [ ] env 四件套同步一致（runtime-environment-contract 过）
- [ ] 迁移 Additive 可应用，`verify:migrations` 过
- [ ] WEB 与 v1 images 入口都接入（防绕过），`pnpm build` 过

## 回滚点

- 默认 `MODERATION_ENABLED=false`：线上开启前零影响。
- 代码回退：删除 `src/lib/moderation/*`、移除两处接入点、还原两表即可（Additive 列不强制回退）。