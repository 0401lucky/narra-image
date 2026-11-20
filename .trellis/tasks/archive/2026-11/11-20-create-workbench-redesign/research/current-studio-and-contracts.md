# Research: Current `/create` Studio, Media Storage Contracts, and Generation Pipeline

> Captured on 2026-11-20 for task `11-20-create-workbench-redesign`.

## 1. Current `/create` Studio Architecture

- **Server Entry**: `src/app/create/page.tsx:22-101`
  - Fetches `getActiveChannels()`, `getCheckInSummary(user.id)`, `listStudioConversations(user.id)`, `savedProviderConfig`, `getPublicTurnstileConfig()`, plus `initialGenerationPage` for `conversations[0]`.
  - Passes `ownerId`, `canvasEnabled`, `checkInSummary`, `currentUser`, `initialPrompt`, `initialGenerationPage`, `initialConversations`, `channels`, `savedProvider`, `turnstile` to `<GeneratorStudio />`.
- **Client Container**: `src/components/create/generator-studio.tsx:113-1434`
  - Uses `useStudioMode(ownerId, canvasEnabled)` (`src/components/create/hooks/use-studio-mode.ts:14-52`) with `StudioMode = "conversation" | "canvas"`.
  - When `canvasEnabled === true`, renders `<StudioModeSwitch />` (`src/components/create/parts/studio-mode-switch.tsx:11-27`) above the workspace.
  - Non-canvas mode currently renders a 2-column chat UI:
    - Left: `<SessionSidebar />` (`src/components/create/parts/session-sidebar.tsx:21-120`) backed by `useSessions` (`/api/me/conversations`).
    - Right: `<ChatPane />` (`src/components/create/parts/chat-pane.tsx:28-111`) -> `<ChatStream />` -> `<GenerationBubble />` (`src/components/create/parts/generation-bubble.tsx:52-279`) + floating `<Composer />` (`src/components/create/parts/composer.tsx:83-466`) + collapsible `<AdvancedSettings />` (`src/components/create/parts/advanced-settings.tsx:62-429`).
  - Root job polling & canonical availability cache: `useStudioJobs` (`src/components/create/hooks/use-studio-jobs.ts:74-180`) + `useImagePoller`.
  - Video studio reference in same repo: `src/components/video/video-studio.tsx:38-285` and `src/components/video/parts/video-composer.tsx:44-242` already demonstrate warm cream/terracotta (`#faf6ef`, `#fffaf2`, `--line`, `--accent: #d9643a`) workbench styling.

## 2. Existing Size, Ratio, Resolution, and Parameter Capabilities

- **Size & Ratio engine**: `src/lib/generation/sizes.ts:1-237`
  - Constants: `SIZE_MULTIPLE = 16`, `MAX_EDGE = 3840`, `MAX_ASPECT_RATIO = 3`, `MIN_PIXELS = 655_360`, `MAX_PIXELS = 8_294_400`.
  - Types: `GenerationSizeToken = "auto" | "${number}x${number}"`, `SizeTier = "1K" | "2K" | "4K"`.
  - Helpers already implemented and unit-tested:
    - `calculateImageSize(tier, ratio)` (`sizes.ts:120-155`)
    - `normalizeImageSize(size)` / `normalizeGenerationSize(value)` (`sizes.ts:112-169`)
    - `formatImageRatio(width, height)` (`sizes.ts:181-226`) with exact common ratio list: `1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16, 21:9, 9:21`.
- **Supported generation parameters**: `src/lib/validators.ts:41-96`, `src/lib/types.ts:1-15`
  - `quality`: `"auto" | "low" | "medium" | "high"`
  - `outputFormat`: `"png" | "jpeg" | "webp"`
  - `outputCompression`: `0..100` (null when `png`)
  - `moderation`: `"auto" | "low"`
  - `negativePrompt`: max 1000 chars (text-to-image JSON path; FormData currently sets `null`)
  - `prompt`: 2..8000 chars (`GENERATION_PROMPT_MAX_LENGTH`)
  - `referenceImages`: up to 16 images (files + URLs)
  - `providerMode`: `"built_in" | "custom"` (custom supports probe `/api/provider-models/probe` + remember)
  - `background` (transparent background): **NOT** present in Prisma schema, Zod validators, or Go Worker (explicitly out of scope per user decision).

## 3. Hard Constraints on Output Count (`count`) & `image_to_image`

### 3.1 Single-Job Storage Contract Limit (`1..4`)
- `contracts/media/v1/contract.json:7`: `"outputCount": 4`
- `contracts/media/v1/schema.json:5004`: `"expression": "((slot >= 0) AND (slot <= 3))"`
- `prisma/migrations/20261112090000_image_storage/migration.sql:88`: `slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 3)`
- `prisma/migrations/20261112090000_image_storage/migration.sql:365`: `jsonb_array_length(p->'slotBytes') NOT BETWEEN 1 AND 4`
- `src/lib/storage/image-contract.ts:17,50,130,159`: `MAX_IMAGE_OUTPUT_COUNT = fixture.limits.outputCount` (`slot: z.number().int().min(0).max(3)`)
- `src/lib/storage/image-schema.ts:14-109`: Verifies exact PostgreSQL 17 catalog definitions and MD5 of every PG function body (`storageRevision: 3`).
- `worker/internal/worker/image_contract.go:20,47,368`: `const ImageMaxOutputCount = 4` (verified against `contracts/media/v1/contract.json` on startup).
- `worker/internal/worker/gateway.go:147` & `worker/internal/worker/generation.go:55`: `if job.Count < 1 || job.Count > ImageMaxOutputCount`.
- **Implication**: Raising a single `GenerationJob`'s `count` above 4 requires a new PostgreSQL migration modifying `image_object` CHECK constraints and `image_reserve` PL/pgSQL function, bumping `storageRevision` (3 -> 4), recapturing PG17 `contracts/media/v1/schema.json`, and updating Node/Go contract checks + rollback-preflight rules.

### 3.2 Artificial Clamps on `image_to_image` (`count` currently hardcoded to 1)
- `src/lib/generation/parse-generate-request.ts:86,119`: FormData branch hardcodes `count: 1` (ignores any `count` field in FormData).
- `src/app/api/generate/route.ts:209`: `count: body.generationType === "image_to_image" ? 1 : body.count` when calling `reserveManagedImageOutputs`.
- `worker/internal/worker/generation.go:88-91`: `if job.GenerationType == "IMAGE_TO_IMAGE" { maximumOutputs = 1 }`.
- `worker/internal/worker/generation.go:150`: `generateWithImageEdit` hardcodes `"n": "1"` in multipart fields.
- `worker/internal/worker/generation.go:203-205`: `generateWithResponsesImageTool` forces `count = 1` for `IMAGE_TO_IMAGE`.
- `src/components/create/generator-studio.tsx:877,904,929` & `advanced-settings.tsx:293-296`: UI locks `count = 1` whenever `generationType === "image_to_image"`.
- **Implication**: Enabling `image_to_image` for `count = 1..4` requires **zero** database schema or `contracts/media/v1/schema.json` changes because `slot 0..3` and `slotBytes 1..4` already support up to 4 outputs.

### 3.3 Credit Billing Today
- `src/lib/credits.ts:16-29`: `calculateGenerationCost({ providerMode, builtInCreditCost })` returns flat `builtInCreditCost` (default `5`) per `GenerationJob` regardless of `count`!
- `src/app/api/generate/route.ts:126-129,250,321-330`: Pre-deducts `cost` on job creation; refunds `creditsSpent` on failure/cancellation (`src/lib/generation/job-refund.ts`, `worker/internal/worker/job_lifecycle.go`).

## 4. Flat Generation History, Deletion, Prompts, and Works APIs

- **Current `/api/me/generations`**: `src/app/api/me/generations/route.ts:8-32`
  - Returns up to 24 jobs across ALL `GenerationType`s (including videos!), no pagination cursor, no filtering.
- **Current `DELETE /api/me/generations/[id]`**: `src/app/api/me/generations/[id]/route.ts:46-146`
  - ONLY cancels `PENDING` / `PROCESSING` jobs; returns `409` for `SUCCEEDED` / `FAILED` jobs.
- **Deletion vs Retention Boundaries**:
  - `prisma/schema.prisma:435-501`: `GenerationJob` holds `creditsSpent`, `images`, `attempts`, `canvasRuns`, `canvasAssetUses`. Admin dashboard (`src/lib/server/admin-overview.ts`, `src/app/api/admin/generations/route.ts`) reads `GenerationJob` for metrics and audit diagnostics.
  - `src/lib/server/works.ts:131-149`: `/works` lists `GenerationImage` joined via `job: { userId }`.
  - `.trellis/spec/operations/image-storage.md:27,113`: `ImageAsset` / `ImageObject` and showcased/referenced images have independent retention guards and must not be cascade-deleted by business records.
  - Previous Conversation deletion (`src/app/api/me/conversations/[id]/route.ts:40-58`) used `onDelete: SetNull` on `GenerationJob.conversationId`, removing history from `/create` while preserving `/works` and admin billing records.
- **Prompt Library API**: `src/app/api/prompts/route.ts` + `src/lib/prompts/service.ts:41-96`
  - `GET /api/prompts?keyword=&source=&tag=&page=&pageSize=` returns `{ categories, items, page, pageSize, tags, total }`.
- **My Works API**: `src/app/api/me/works/route.ts` + `src/lib/server/works.ts:119-160`
  - `GET /api/me/works?cursor=&limit=` returns `{ hasMore, items: SerializedWork[], nextCursor }` (image works only, each with `id, jobId, url, prompt, size, model, availability, createdAt`).
