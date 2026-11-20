# Technical Design: Create Studio Workbench Redesign

## 1. Architecture Overview

The `/create` page (`src/app/create/page.tsx`) shifts its default non-canvas mode from a session-grouped chat stream to a three-column **Image Generation Workbench** backed directly by flat `GenerationJob` records, while retaining `GeneratorStudio` as the single owner-scoped root container shared with Canvas mode.

```
src/app/create/page.tsx (SSR)
  ├── listStudioGenerations({ ownerId, limit: 30 })   [new bounded keyset loader]
  ├── getActiveChannels(), getCheckInSummary(), savedProviderConfig, turnstileConfig
  └── <GeneratorStudio /> (Client root container, key={ownerId})
        ├── StudioModeSwitch (when canvasEnabled: "工作台" | "画布")
        ├── useStudioJobs (single canonical poller + monotonic availability cache)
        ├── [mode === "canvas"] -> CanvasLazyPane (unchanged contract & hooks)
        └── [mode === "conversation" (Workbench)]
              ├── useWorkbenchRecords (flat list, selection, multi-select, pagination, hide)
              ├── useReferenceImages (0..16 images, drag/reorder/paste/clipboard)
              ├── WorkbenchHistoryRail (Left column / mobile drawer)
              ├── WorkbenchComposer (Middle column)
              │     ├── Prompt header -> PromptPickerModal (/api/prompts)
              │     ├── Prompt header -> WorksPickerModal (/api/me/works)
              │     ├── ReferenceDropzone (drag, upload, clipboard, reorder)
              │     ├── Provider & Model selector (built_in / custom + probe)
              │     ├── Quality pills (auto/low/medium/high)
              │     ├── WorkbenchSizePanel (W×H + swap + 16x align + 1K/2K/4K/自动 + 10 ratio cards)
              │     ├── Batch count pills (1..4, both T2I and I2I)
              │     ├── Collapsible More Options (format, compression, moderation, negativePrompt)
              │     └── Sticky Submit CTA (Turnstile + Alert + credit total)
              ├── WorkbenchResultStage (Right column / mobile tab)
              └── ImageZoomModal (shared viewer reading canonical availability)
```

## 2. Database & Migration Design

### 2.1 Additive Schema Change (`prisma/schema.prisma`)
Add a single nullable timestamp column and index to `GenerationJob`:

```prisma
model GenerationJob {
  ...
  studioHiddenAt DateTime?
  ...
  @@index([userId, studioHiddenAt, createdAt(sort: Desc)])
}
```

### 2.2 Additive Migration
Create `prisma/migrations/<timestamp>_generation_studio_hidden_at/migration.sql` (with explicit LF rule in `.gitattributes`):

```sql
-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN "studioHiddenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GenerationJob_userId_studioHiddenAt_createdAt_idx" ON "GenerationJob"("userId", "studioHiddenAt", "createdAt" DESC);
```

### 2.3 Contract & Rollback Compatibility
- `contracts/media/v1/schema.json` only inspects a fixed allowlist of `GenerationJob` columns (`id`, `userId`, `generationType`, `count`, `workerId`, `status`, `sourceImageUrls`) and tolerates unrelated additive columns (`src/tests/unit/image-schema.test.ts:19`).
- `worker/internal/worker/schema.go` and `contracts/canvas/v1/schema.json` do not inspect `studioHiddenAt`.
- Zero-downtime / rollback safe: older Next.js and Go Worker binaries ignore the nullable column; rows default to `NULL` so all historical image jobs automatically appear in the workbench.

## 3. Server & Worker Contracts

### 3.1 Flat Studio Records Loader & API
- **New server module**: `src/lib/server/studio-generations.ts` (`import "server-only"`)
  - Exports `StudioGenerationsPage = { generations: SerializedGeneration[]; hasMore: boolean; nextCursor: string | null }` and `listStudioGenerations({ ownerId, limit = 30, cursor = null })`.
  - Filter:
    ```ts
    where: {
      userId: ownerId,
      studioHiddenAt: null,
      generationType: { in: [GenerationType.TEXT_TO_IMAGE, GenerationType.IMAGE_TO_IMAGE] },
      ...keysetCursorFilter,
    }
    ```
  - Order: `[{ createdAt: "desc" }, { id: "desc" }]`.
  - Cursor: base64url JSON `{ at: isoDate, id: string, ownerId: string }` verified against `ownerId` (rejecting mismatched/malformed cursors with `400`).
  - Limit clamped to `1..60`, default `30`.
  - Uses `serializeGenerationsForClient(visible)` so `availability` and canonical managed image URLs (`projectGenerationSourceUrls`) are always projected accurately.
- **Extend `GET /api/me/generations`** (`src/app/api/me/generations/route.ts`):
  - If `searchParams.get("scope") === "studio"`: parse `cursor` and `limit`, call `listStudioGenerations`, and return `jsonOk(page)` (`{ generations, hasMore, nextCursor }`).
  - Without `scope=studio`: preserve existing behavior (`take: 24` across all types) so existing callers remain 100% compatible.

### 3.2 Hide Records API (`POST /api/me/generations/hide`)
- **New route**: `src/app/api/me/generations/hide/route.ts`
- **Validator** (`src/lib/validators.ts`):
  ```ts
  export const studioHideGenerationsSchema = z.object({
    ids: z.array(z.string().trim().min(1)).min(1, "请选择要删除的生成记录").max(100, "单次最多删除 100 条生成记录"),
  });
  ```
- **Behavior**:
  - Require authenticated user (`getCurrentUserRecord` -> `401`).
  - Deduplicate `ids`.
  - Query owned rows matching `id IN ids` to partition into terminal (`SUCCEEDED` / `FAILED`) vs active (`PENDING` / `PROCESSING`).
  - Update terminal rows with `studioHiddenAt = new Date()` (`where: { id: { in: terminalIds }, userId: user.id, status: { in: [SUCCEEDED, FAILED] }, studioHiddenAt: null }`).
  - Return `jsonOk({ hiddenIds, skippedPendingIds })`.
  - Never deletes `GenerationJob`, `GenerationImage`, `ImageAsset`, or `GenerationAttempt`.
- **Existing `DELETE /api/me/generations/[id]`**: unchanged (remains the cancel-pending/processing endpoint).

### 3.3 Unified `1..4` Output Count & Per-Image Billing
1. **Credits (`src/lib/credits.ts`)**:
   - Extend `CreditInput` with `count?: number`.
   - Helper `normalizeCreditCount(count?: number)`: returns `Number.isFinite(count) && count >= 1 ? Math.trunc(count) : 1`.
   - `calculateGenerationCost({ providerMode, builtInCreditCost, count = 1 })`:
     `shouldChargeCredits(providerMode) ? builtInCreditCost * normalizeCreditCount(count) : 0`.
   - `hasEnoughCredits({ providerMode, credits, builtInCreditCost, count = 1 })`:
     `credits >= calculateGenerationCost({ providerMode, builtInCreditCost, count })`.
2. **FormData Parser (`src/lib/generation/parse-generate-request.ts`)**:
   - Read `count: toNullableNumber(formData.get("count")) ?? 1` in `parseFormData`, validated by `generateSchema` (`z.number().int().min(1).max(4).default(1)`), and return `count: body.count` (instead of hardcoded `count: 1`).
3. **Web Generation Route (`src/app/api/generate/route.ts`)**:
   - Compute `const billableCount = isVideoGenerationType(body.generationType) ? 1 : body.count;`.
   - Pass `count: billableCount` into `calculateGenerationCost` and `hasEnoughCredits`.
   - Pass `count: body.count` into `reserveManagedImageOutputs` for both `text_to_image` and `image_to_image` (removing `body.generationType === "image_to_image" ? 1 : body.count`).
   - `conversationId` remains optional (omitted by workbench submissions).
4. **External API & Gateway (`src/lib/generation/external-api.ts`, `src/lib/generation/gateway-client.ts`)**:
   - Remove the `image_to_image ? 1 : input.count` clamp so `count = input.count` (`1..4`).
   - Pass `count` to `calculateGenerationCost`.
   - Canvas v1 (`src/lib/validators.ts:375`, `contracts/canvas/v1/limits.json:16`) keeps `imageOutputCount: 1` untouched.
5. **Go Worker (`worker/internal/worker/generation.go`, `worker/internal/worker/gateway.go`)**:
   - `generation.go:88-91`: remove `if job.GenerationType == "IMAGE_TO_IMAGE" { maximumOutputs = 1 }`; keep `maximumOutputs := job.Count` (already bounded to `1..ImageMaxOutputCount` at line 55).
   - `generation.go:148-153` (`generateWithImageEdit`): set `"n": strconv.Itoa(editCount)` where `editCount = job.Count` (fallback `1` if `<= 0`).
   - `generation.go:201-206` (`generateWithResponsesImageTool`): remove `if job.GenerationType == "IMAGE_TO_IMAGE" { count = 1 }`; keep `count := job.Count` (clamp `< 1` to `1`) so Responses image tool loops `count` times for both text-to-image and image-to-image.
   - `gateway.go:159-161`: remove `if env.Payload.GenerationType == "IMAGE_TO_IMAGE" && env.Payload.Count != 1`; line 147 already enforces `1 <= env.Payload.Count <= ImageMaxOutputCount`.

## 4. Frontend State & Component Architecture

### 4.1 Canonical Polling & State Boundaries
- **`useStudioJobs` (`src/components/create/hooks/use-studio-jobs.ts`)**:
  - Add `registerWorkbench(job)` using an immutable `{ kind: "workbench", ownerId }` origin and `onWorkbenchUpdate?: (job: GenerationItem) => void` callback (keeping `registerConversation` for backward compatibility with existing unit tests).
  - Convergent media merge (`mergeJob` + `mergeImageAvailability`): identical object reference returned when nothing changed, preventing feedback loops with `useWorkbenchRecords`.
- **`useWorkbenchRecords` (`src/components/create/hooks/use-workbench-records.ts`)**:
  - State: `records: GenerationItem[]`, `selectedId: string | null`, `checkedIds: Set<string>`, `nextCursor: string | null`, `hasMore: boolean`, `loadingMore: boolean`, `loadError: string | null`, `hiding: boolean`.
  - Mount-only initialization from `initialGenerations` + `initialNextCursor` + `initialHasMore`; subsequent `router.refresh()` updates merge only canonical image availability/URLs for existing IDs (respecting `.trellis/spec/frontend/state-management.md` §5.1 & §5.4) and NEVER resurrect IDs present in `hiddenIdsRef`.
  - `loadMore()`: calls `GET /api/me/generations?scope=studio&cursor=...` with `STUDIO_READ_TIMEOUT_MS = 30_000`, `AbortController`, and owner/epoch guard.
  - `hideRecords(ids)`: excludes `status === "pending"` upfront (returns skipped pending count for UI notice), optimistically records `hiddenIdsRef`, calls `POST /api/me/generations/hide`, rolls back on network/HTTP failure, and advances `selectedId` cleanly to the next visible record (or `null` if empty).
  - `prependRecord(job)`: inserts at index 0 (deduplicated by `id`) and selects `job.id`.
  - `updateRecord(job)`: updates matching record in-place only if reference changed (convergent).

### 4.2 Size / Resolution / Aspect Ratio State Model
Create a pure, unit-tested helper module `src/components/create/size-controls.ts` built on `@/lib/generation/sizes`:
- Constants:
  - `RESOLUTION_TIERS = ["1K", "2K", "4K", "auto"] as const`
  - `ASPECT_RATIO_PRESETS = ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "auto"] as const`
- State fields in `GeneratorStudio`:
  - `size: GenerationSizeToken` (`"auto"` or `"WxH"`)
  - `resolutionTier: SizeTier | "auto"` (default `"auto"`)
  - `aspectRatioPreset: AspectRatioPreset` (default `"auto"`)
  - `widthInput: string`, `heightInput: string`
  - `alignMultiple16: boolean` (default `true`)
- Interaction rules:
  1. Clicking a **Resolution pill** (`1K` / `2K` / `4K`):
     - If `aspectRatioPreset === "auto"`, default ratio to `"1:1"`.
     - Compute `calculateImageSize(tier, activeRatio)` -> sync `size`, `widthInput`, `heightInput`.
  2. Clicking **`自动` resolution** or **`自动` aspect ratio**:
     - Set `resolutionTier = "auto"`, `aspectRatioPreset = "auto"`, `size = "auto"`, clear manual dimension display (placeholder `自动`).
  3. Clicking an **Aspect Ratio card** (e.g. `3:4`):
     - Effective tier = `resolutionTier === "auto" ? "1K" : resolutionTier` (and update `resolutionTier` to effective tier so UI highlights both!).
     - Compute `calculateImageSize(effectiveTier, ratio)` -> sync `size`, `widthInput`, `heightInput`.
  4. Editing **`W` / `H` inputs** manually:
     - Store raw string while typing; compute normalized preview via `alignMultiple16` (using `normalizeImageSize` when ON, or clamping bounds while noting backend 16-multiple normalization when OFF).
     - Derive matching `aspectRatioPreset` if exact/nearest match or `null` (custom), keep `customSizeWarning` accurate.
  5. Clicking **Swap (`⇄`)**: swaps `widthInput` and `heightInput` and re-computes `size` & matched ratio.
  6. Calling **`复用参数`** on a historical generation:
     - Reverse-maps `generation.size` back to `(resolutionTier, aspectRatioPreset, widthInput, heightInput)` via `deriveSizeControlState(generation.size)` so the UI highlights the exact tier/ratio or custom W×H!

### 4.3 Component Breakdown
All new/updated components follow `.trellis/spec/frontend/component-guidelines.md` (named exports, `cn()`, warm editorial tokens, semantic buttons/labels):
1. `src/components/create/parts/workbench-history-rail.tsx`:
   - Left sidebar (desktop `w-[264px] xl:w-[292px]`, mobile slide-over drawer).
   - Top bar: `生成记录` + `+ 新建` + `全选` + `删除`.
   - Scrollable cards with checkbox, thumbnail, 2-line prompt, status badge (`成功 N` / `生成中` / `失败`), count, duration, timestamp, hover delete button, and `加载更多`.
2. `src/components/create/parts/workbench-composer.tsx`:
   - Middle column (`w-[360px] xl:w-[412px]` on desktop, full width on mobile tab).
   - Scrollable parameter body + sticky footer CTA (`开始生成 · X 积分`).
   - Sections: Header (mode pill) → Prompt (with `提示词库` & `我的作品` buttons) → Reference Dropzone (with `剪切板` & `上传` buttons + drag/reorder grid) → Provider/Channel/Model → Quality pills → `WorkbenchSizePanel` → Batch Count (`1..4 张`) → Collapsible `更多设置` (outputFormat, compression, moderation, negativePrompt).
3. `src/components/create/parts/workbench-size-panel.tsx`:
   - Encapsulates `W ⇄ H` inputs, `16 倍数对齐` switch, `1K / 2K / 4K / 自动` pills, 10 visual aspect ratio cards, and live dimension/warning readout.
4. `src/components/create/parts/workbench-result-stage.tsx`:
   - Right flexible panel (`flex-1 min-w-0`).
   - Renders selected record's header, parameter summary strip, reference preview chips (if any), pending skeleton grid (matching `count` & aspect ratio), succeeded image grid (with `加入参考图`, `复用参数`, `放大查看`, `下载`, dimension/ratio badges, downgrade warnings, `<ImageUnavailable />`), or failed error card (`重新生成`, `复用参数`).
5. `src/components/create/parts/prompt-picker-modal.tsx` (lazy loaded):
   - Accessible modal (`role="dialog"`, `Escape` to close, backdrop click) fetching `/api/prompts` with debounced keyword input, source tabs, pagination, and `使用提示词`.
6. `src/components/create/parts/works-picker-modal.tsx` (lazy loaded):
   - Accessible modal fetching `/api/me/works` with cursor `加载更多`, displaying user image works with `加入参考图` (disabled if unavailable/cleaned) and `填入提示词`.
7. `src/components/create/parts/studio-mode-switch.tsx`:
   - Update button text `对话` → `工作台` (`aria-label="创作模式"` preserved), icon `SlidersHorizontal` / `LayoutGrid` + `Workflow` for `画布`.
8. `src/components/create/generator-studio.tsx`:
   - Re-orchestrated around `useWorkbenchRecords`, `useStudioJobs`, `useReferenceImages`, `useStudioMode`, and `CanvasLazyPane`.
   - Retains backward-compatible props (`initialGenerations`, `initialNextCursor`, `initialHasMore`, plus optional ignored legacy props if any test passes them — or clean prop contract updated with tests).
   - Submission flow:
     - Captures immutable `GenerateSnapshot` (prompt, references, auto-derived `generationType`, `count`, `size`, `quality`, `outputFormat`, `outputCompression`, `moderation`, `negativePrompt`, provider/channel/model, turnstile token).
     - Does **NOT** clear middle workbench draft on submit.
     - Sends multipart `FormData` when `snapshot.referenceImages.length > 0` (including `count`), else JSON `POST /api/generate`.
     - Prepends & selects accepted `GenerationItem`, registers with `useStudioJobs`, calls `router.refresh()` for credit balance update, resets consumed Turnstile token.
     - On mobile (`< 1024px`), switches active mobile tab to `"result"` once submitted.

### 4.4 Cleanup of Superseded Chat-Only UI Parts
- Check whether `chat-pane.tsx`, `chat-stream.tsx`, `composer.tsx`, `generation-bubble.tsx`, `session-sidebar.tsx`, `advanced-settings.tsx`, `use-sessions.ts`, `use-conversation-generations.ts` are referenced outside `/create` and tests.
- Keep `/api/me/conversations/*` and `src/lib/server/conversation-generations.ts` intact (zero breaking API changes; their dedicated API unit tests continue passing).
- Remove unused chat-only UI components once replaced (or retain only what is shared/tested), ensuring zero dead code and zero broken imports.

## 5. Trade-offs & Edge Cases

1. **Clipboard button browser compatibility**: `navigator.clipboard.read()` requires HTTPS/localhost and explicit permission; Firefox/Safari/older browsers may deny or throw `NotAllowedError`. Clicking `剪切板` catches errors cleanly and shows an actionable hint ("浏览器未授权读取剪贴板，请直接按 Ctrl+V 粘贴图片"), while global `onPaste` continues working everywhere.
2. **`16 倍数对齐` toggle vs backend normalization**: Turning OFF the toggle allows typing arbitrary integers freely without immediate snap-back while editing, while still displaying the backend's 16-multiple normalization note (`实际将规整为 WxH`) so there is never a silent mismatch between UI and server.
3. **Concurrent submissions**: Users can submit a new generation while a previous job is still `pending` (only blocking while the short HTTP enqueue `POST /api/generate` itself is in flight). Each submission creates its own record in the left sidebar and registers independently in `useStudioJobs`.
4. **Reference image reuse on unavailable images**: When clicking `复用参数` or `重新生成` on an old `image_to_image` job, if `sourceImageUrls` is empty (e.g., all cleaned/removed by `projectGenerationSourceUrls`), gracefully fall back to `text_to_image` and show an informative notice instead of submitting a broken request.
5. **Zoom modal freshness**: Track zoomed image by `{ recordId, imageId }` (or resolve latest URL/availability from canonical records/jobs) so if an image transitions to `cleaned` while open, actions disable immediately per `state-management.md` §5.4.
