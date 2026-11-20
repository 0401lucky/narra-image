# Implementation Plan: Create Studio Workbench Redesign

> Execution begins ONLY after explicit user approval of this planning summary and `python ./.trellis/scripts/task.py start 11-20-create-workbench-redesign`.

## Ordered Implementation Checklist

### Phase A: Database Schema & Additive Migration
- [x] **A1**: Add `studioHiddenAt DateTime?` and `@@index([userId, studioHiddenAt, createdAt(sort: Desc)])` to `model GenerationJob` in `prisma/schema.prisma`.
- [x] **A2**: Create additive migration `prisma/migrations/20261120093000_generation_studio_hidden_at/migration.sql` (exact LF line endings) and add its path to `.gitattributes` (`text eol=lf`).
- [x] **A3**: Run `pnpm exec prisma generate` to refresh Prisma Client types.
- [x] **A4**: Verify `src/tests/unit/image-schema.test.ts` remains green (confirms zero impact on `contracts/media/v1/schema.json`).

### Phase B: Unified `1..4` Multi-Output & Per-Image Credit Billing (Next.js + Go Worker)
- [x] **B1**: Update `src/lib/credits.ts` (`calculateGenerationCost` and `hasEnoughCredits`) to accept optional `count` (default `1`) and multiply `builtInCreditCost × count` for built-in mode.
- [x] **B2**: Update `src/lib/generation/parse-generate-request.ts` so multipart `FormData` parses `count` (`1..4`, default `1`) instead of hardcoding `1`.
- [x] **B3**: Update `src/app/api/generate/route.ts`:
  - Pass `billableCount = isVideoGenerationType(body.generationType) ? 1 : body.count` to `calculateGenerationCost` & `hasEnoughCredits`.
  - Pass `count: body.count` to `reserveManagedImageOutputs` for both `text_to_image` and `image_to_image`.
- [x] **B4**: Update `src/lib/generation/external-api.ts` and `src/lib/generation/gateway-client.ts` to allow `count: 1..4` for `image_to_image` and pass `count` to `calculateGenerationCost`.
- [x] **B5**: Update Go Worker:
  - `worker/internal/worker/generation.go`: remove `IMAGE_TO_IMAGE` `maximumOutputs = 1` clamp, send `n = strconv.Itoa(count)` in `generateWithImageEdit`, and allow `count` loop in `generateWithResponsesImageTool`.
  - `worker/internal/worker/gateway.go`: remove `IMAGE_TO_IMAGE` `count != 1` rejection (keep `1..ImageMaxOutputCount` guard).
- [x] **B6**: Update and add backend + Go tests:
  - `src/tests/unit/credits.test.ts`
  - `src/tests/unit/parse-generate-request.test.ts`
  - `src/tests/unit/canvas-generate-route.test.ts` (per-image billing expectation on `count: 2`)
  - `src/tests/unit/external-generation-service.test.ts` & `src/tests/unit/gateway-client.test.ts`
  - `worker/internal/worker/generation_test.go` & `worker/internal/worker/gateway_test.go` (multi-output edit & responses tests).

### Phase C: Flat Workbench Records Backend & SSR Wiring
- [x] **C1**: Create `src/lib/server/studio-generations.ts` with `listStudioGenerations({ ownerId, limit, cursor })` filtering `studioHiddenAt: null` and `generationType IN (TEXT_TO_IMAGE, IMAGE_TO_IMAGE)` with owner-scoped keyset cursor pagination.
- [x] **C2**: Extend `src/app/api/me/generations/route.ts` to support `?scope=studio&cursor=...&limit=...` while preserving legacy response when `scope` is absent.
- [x] **C3**: Add `studioHideGenerationsSchema` to `src/lib/validators.ts` and implement `src/app/api/me/generations/hide/route.ts` (terminal-only hide via `studioHiddenAt`, skipping pending jobs).
- [x] **C4**: Update `src/app/create/page.tsx` to load initial `listStudioGenerations({ ownerId: user.id, limit: 30 })` instead of `listStudioConversations` / `listConversationGenerations`, passing `initialGenerations`, `initialHasMore`, and `initialNextCursor` to `<GeneratorStudio />`.
- [x] **C5**: Add unit tests for `studio-generations` loader, `GET /api/me/generations?scope=studio`, `POST /api/me/generations/hide`, and `src/app/create/page.tsx`.

### Phase D: Frontend Workbench State, Helpers & Components
- [x] **D1**: Add `src/components/create/size-controls.ts` (resolution tiers `1K/2K/4K/auto`, 10 aspect ratio presets, `16`-multiple alignment, swap, reverse derivation for `复用参数`) + unit tests.
- [x] **D2**: Update `src/components/create/hooks/use-studio-jobs.ts` to support `registerWorkbench` (keeping `registerConversation` compatible) and create `src/components/create/hooks/use-workbench-records.ts` with mount-only init guard, convergent availability merging, `hiddenIdsRef` resurrection protection, timeout-bounded pagination, and multi-select/hide helpers.
- [x] **D3**: Build UI components in `src/components/create/parts/` (warm editorial light palette matching NARRA Image):
  - `workbench-history-rail.tsx`
  - `workbench-size-panel.tsx`
  - `workbench-composer.tsx`
  - `workbench-result-stage.tsx`
  - `prompt-picker-modal.tsx`
  - `works-picker-modal.tsx`
  - Update `studio-mode-switch.tsx` (`对话` → `工作台`).
- [x] **D4**: Refactor `src/components/create/generator-studio.tsx` to wire the 3-column workbench, responsive mobile drawer/tabs, auto T2I/I2I submission, draft preservation on submit/record switch, `+ 新建`, `复用参数`, `加入参考图` (without wiping prompt), `重新生成`, `取消生成`, live `ImageZoomModal`, and `CanvasLazyPane`.
- [x] **D5**: Clean up orphaned chat-only components (verified legacy components still covered by existing standalone unit tests; kept intact for zero breaking removals).

### Phase E: Frontend Regression Tests & Verification Gates
- [x] **E1**: Update/replace chat-coupled tests and add comprehensive workbench tests:
  - Workbench layout, auto T2I/I2I detection, draft preservation on record selection & submit, `+ 新建`, `复用参数`, `加入参考图` (preserves prompt).
  - Left rail: select-all, batch hide, skip pending warning, `加载更多` cursor pagination, no resurrection on `router.refresh()`.
  - Size panel: resolution pills + ratio cards + W×H + swap + 16-multiple alignment + warnings.
  - Pickers: `提示词库` search/fill and `我的作品` pagination/add-reference/fill-prompt.
  - Clipboard button: success path + permission denied fallback.
  - Multi-output `1..4` for both T2I and I2I + live credit total on CTA.
  - Retry/cancel, image availability (`cleaned`/`unavailable`), origin/owner isolation, and Canvas mode switching (`generator-studio-canvas.test.tsx`).
- [x] **E2**: Run full verification commands:
  ```powershell
  pnpm lint
  pnpm exec tsc --noEmit
  pnpm exec vitest run --testTimeout=30000
  cd worker && go test ./...
  pnpm build
  git diff --check
  ```
- [x] **E3**: Perform real-browser visual & interactive verification on desktop (`1440×900`) and mobile (`390×844`) viewports (screenshots inspected directly to confirm layout balance, scrolling, warm palette consistency, and zero clipping/overlap).

## Risky Files & Rollback Points

| Risky Area | Files | Mitigation / Rollback |
| --- | --- | --- |
| Credit billing formula | `src/lib/credits.ts`, `src/app/api/generate/route.ts`, `src/lib/generation/external-api.ts`, `src/lib/generation/gateway-client.ts` | Default `count = 1` preserves caller safety; all billing & refund unit tests updated and verified. |
| Go Worker multi-image edit | `worker/internal/worker/generation.go`, `worker/internal/worker/gateway.go` | Strictly capped by `ImageMaxOutputCount = 4`; Go unit tests cover `n=1..4` for `/images/edits` and `/responses`. |
| Prisma additive migration | `prisma/schema.prisma`, `prisma/migrations/20261120093000_generation_studio_hidden_at/migration.sql` | Purely nullable column + index; zero impact on `contracts/media/v1/schema.json` or legacy workers; easily reversible via dropping column/index if unapplied. |
| `GeneratorStudio` & Canvas coexistence | `src/components/create/generator-studio.tsx`, `src/components/create/hooks/use-studio-jobs.ts`, `src/components/create/parts/studio-mode-switch.tsx` | Keep `CanvasLazyPane`, `useCanvasDocuments`, `useCanvasEditor`, `useCanvasRuntimeLease`, and `generator-studio-canvas.test.tsx` intact. |
| RSC props sync & cache convergence | `src/components/create/hooks/use-workbench-records.ts`, `src/components/create/hooks/use-studio-jobs.ts` | Enforce mount-only init ref, `hiddenIdsRef`, and identity-preserving `mergeImageAvailability` per `state-management.md` §5. |

## Pre-Start Checklist (Before `task.py start`)
- [x] Codebase evidence persisted in `research/current-studio-and-contracts.md`.
- [x] All user-owned product, scope, UX, billing, and risk decisions resolved.
- [x] `prd.md` passed lossless convergence pass with zero blocking open questions.
- [x] `design.md` and `implement.md` completed.
- [x] User explicitly approves the final planning summary below (gate before `task.py start`).
