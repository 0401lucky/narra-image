# Create Studio Workbench Redesign

## Goal

Transform `/create` from a two-column chat-bubble stream into a dedicated three-column **Image Generation Workbench** (**Generation Records** | **Generation Workbench** | **Generation Results**) tailored for iterative image creation, while keeping NARRA Image's warm cream/terracotta editorial light aesthetic, preserving Canvas mode coexistence, and unifying `1..4` multi-image output with per-image credit billing across both text-to-image and image-to-image workflows.

## Background & Confirmed Repository Constraints

- **Current `/create` implementation**: `src/app/create/page.tsx:22-101` and `src/components/create/generator-studio.tsx:113-1434` currently couple the non-canvas workspace to `Conversation` sessions (`SessionSidebar`, `ChatPane`, `ChatStream`, `GenerationBubble`, floating `Composer`, and collapsible `AdvancedSettings`). High-frequency controls (quality, count, custom dimensions, format, negative prompt, custom API) are hidden in bottom overlays and accordions, while output previews are compressed inside narrow chat bubbles.
- **Reusable sizing engine**: `src/lib/generation/sizes.ts:1-237` already provides `SIZE_MULTIPLE = 16`, `MAX_EDGE = 3840`, `MAX_ASPECT_RATIO = 3`, `MIN_PIXELS = 655_360`, `MAX_PIXELS = 8_294_400`, `SizeTier = "1K" | "2K" | "4K"`, `calculateImageSize(tier, ratio)`, `normalizeGenerationSize`, and `formatImageRatio` covering `1:1, 2:3, 3:2, 4:3, 3:4, 16:9, 9:16, 21:9, 9:21`.
- **Reusable discovery APIs**: `GET /api/prompts` (`src/lib/prompts/service.ts:41-96`) and `GET /api/me/works` (`src/lib/server/works.ts:119-160`) already support keyword/source/cursor browsing for prompt templates and user-generated image works.
- **Managed image storage ceiling (1..4)**: `contracts/media/v1/contract.json:7` (`outputCount: 4`), `contracts/media/v1/schema.json:5004` (`slot BETWEEN 0 AND 3`), `prisma/migrations/20261112090000_image_storage/migration.sql:88,365`, and `worker/internal/worker/image_contract.go:20` lock single-job outputs to `1..4` under `storageRevision = 3`. Unrelated additive nullable columns on `GenerationJob` do not affect `contracts/media/v1/schema.json` or `image-schema.test.ts` (`src/tests/unit/image-schema.test.ts:19`).
- **Artificial `image_to_image` clamp**: `src/lib/generation/parse-generate-request.ts:86,119`, `src/app/api/generate/route.ts:209`, `src/lib/generation/external-api.ts:193`, `src/lib/generation/gateway-client.ts:252`, `worker/internal/worker/generation.go:88-91,150,203-205`, and `worker/internal/worker/gateway.go:159-161` currently clamp `image_to_image` to `count = 1`. Canvas v1 independently pins `imageOutputCount: 1` in `contracts/canvas/v1/limits.json:16`.
- **Current billing**: `src/lib/credits.ts:16-29` charges a flat `builtInCreditCost` per job regardless of `count`.
- **Frontend state & media invariants**: `.trellis/spec/frontend/state-management.md` forbids global stores, forbids unguarded server-props-to-state sync effects, requires `STUDIO_READ_TIMEOUT_MS = 30_000` on read calls, and requires monotonic `cleaned` availability merging via `useStudioJobs`.

## Requirements

### R1. Three-Column Warm Editorial Workbench Layout
- Replace the `/create` non-canvas chat interface with a three-column workbench:
  - **Left column (`生成记录`)**: flat, chronological list of standalone image generation jobs (`TEXT_TO_IMAGE` and `IMAGE_TO_IMAGE`, newest first), with `+ 新建`, `全选`, and `删除` toolbar controls plus cursor pagination (`加载更多`).
  - **Middle column (`生图工作台`)**: permanently visible parameter workbench with scrollable sections and a sticky bottom submission area.
  - **Right column (`生成结果`)**: dedicated inspection gallery for the currently selected generation record.
- Retain NARRA Image's warm cream/terracotta editorial light theme (`#faf6ef`, `#fffaf2`, `--line`, `--accent: #d9643a`) consistent with the homepage, `/video`, and `/works`.
- On tablet/mobile viewports (`< 1024px`), adapt cleanly with a slide-over drawer for `生成记录` and a top tab switcher between `工作台` and `结果`, auto-switching to `结果` when a generation is submitted.

### R2. Flat Single-Job Record Model & Hide-Only Deletion
- Every submission of `开始生成` creates one independent `GenerationJob` record (no `Conversation` creation or grouping required) and prepends/selects it immediately at the top of the left column.
- Historical image jobs created before this redesign (whether previously inside conversations or standalone) automatically appear in the flat list without data migration.
- Each record card displays: selection checkbox, first-image thumbnail (or generating/failed indicator), prompt preview, generation mode badge (when reference images were used), status/result count badge (`成功 N` / `生成中` / `失败`), requested count (`N 张`), duration, and timestamp.
- Deleting a single record or batch-deleting selected records hides those jobs from `/create` across devices by persisting a nullable `GenerationJob.studioHiddenAt` timestamp via a dedicated hide endpoint:
  - Hidden records disappear immediately from `/create` and are not resurrected by `router.refresh()` or stale fetches.
  - `GenerationImage` rows, `/works` items, showcase/featured status, and admin billing/audit reports remain completely intact.
  - `PENDING` / `PROCESSING` jobs cannot be hidden/deleted until cancelled via `DELETE /api/me/generations/[id]`.

### R3. Independent Draft vs Record Selection
- Clicking a record in the left column updates the right `生成结果` panel (including its full prompt and parameter summary) **without** overwriting the user's current prompt, reference images, or parameters in the middle `生图工作台`.
- Submitting a generation keeps the middle workbench draft intact (no forced prompt/reference wipe) so users can iteratively refine and re-run.
- Clicking `+ 新建` in the left column clears the middle workbench draft (prompt, negative prompt, reference images, error) and focuses the prompt textarea.
- Clicking `复用参数` in the right panel explicitly populates the middle workbench with that record's prompt, parameters, model/channel (if available), and still-available reference image URLs.

### R4. Automatic Text-to-Image / Image-to-Image Mode Detection
- Remove the manual `文生图 / 图生图` mode toggle buttons.
- Automatically determine `generationType` from the attached reference images:
  - `referenceImages.length > 0` → submit as `image_to_image` (multipart `FormData`).
  - `referenceImages.length === 0` → submit as `text_to_image` (JSON).
- Display a lightweight read-only status indicator in the workbench header (`文生图` vs `图生图 · N 张参考图`) so the submission mode is always transparent.

### R5. Prompt Editor with Prompt Library & My Works Pickers
- Provide a multi-line prompt textarea (`maxLength = GENERATION_PROMPT_MAX_LENGTH`) with IME-safe `Ctrl/Cmd + Enter` shortcut, image paste support, and character count.
- Add header quick actions:
  - **`提示词库`**: opens a modal/drawer backed by `GET /api/prompts` with keyword search, source/category filtering, pagination, and one-click `填入提示词`.
  - **`我的作品`**: opens a modal/drawer backed by `GET /api/me/works` with cursor pagination and per-work actions to `加入参考图` (only for available images) or `填入提示词`.

### R6. Always-Visible Reference Image Zone & Clipboard Action
- Render a permanent reference image dropzone in the middle workbench with header buttons: **`剪切板`** (reads image from `navigator.clipboard.read()` with clear user feedback when permission is denied or no image is present) and **`上传`** (file chooser).
- Preserve all existing reference image capabilities: up to 16 images, drag-and-drop local files, drag-and-drop generated images from the right result gallery (`HISTORY_IMAGE_DRAG_MIME`), global paste (`Ctrl+V`), drag/button reordering, individual removal, and `清空`.
- Clicking `加入参考图` on a result image or work appends it to `referenceImages` **without** clearing the current prompt.

### R7. Visual Size, Resolution, Aspect Ratio & 16-Multiple Alignment Controls
- Replace the single size dropdown with linked workbench controls backed by `src/lib/generation/sizes.ts`:
  - **Width / Height (`W` ⇄ `H`)** numeric inputs with swap button and a **`16 倍数对齐`** toggle (default ON; snaps manual entries to multiples of 16 and previews normalized output dimensions).
  - **Resolution pills**: `1K`, `2K`, `4K`, `自动`.
  - **Visual Aspect Ratio cards**: `1:1`, `2:3`, `3:2`, `4:3`, `3:4`, `16:9`, `9:16`, `21:9`, `9:21`, `自动`, each displaying a proportional frame outline.
  - Selecting `自动` sets `size = "auto"`; selecting any ratio + resolution tier computes normalized `WxH` via `calculateImageSize(tier, ratio)` and syncs the `W`/`H` fields; editing `W`/`H` manually switches ratio selection cleanly and surfaces `customSizeWarning` when exceeding `3840px`, max pixels, or `3:1` ratio.

### R8. Model/Channel, Quality, Secondary Parameters & Unified `1..4` Multi-Output
- Keep all existing parameter capabilities accessible in the middle workbench:
  - Provider mode (`平台渠道` vs `自填 API` with Base URL, API Key, model, label, remember toggle, and `拉取模型` probe), channel selector, and model selector.
  - Quality pills: `自动`, `低`, `中`, `高`.
  - Batch count pills: `1 张`, `2 张`, `3 张`, `4 张` — enabled uniformly for **both** text-to-image and image-to-image.
  - Collapsible `更多设置` section for output format (`PNG / JPEG / WebP`), output compression slider (for non-PNG), moderation (`自动 / 低限制`), and negative prompt (for text-to-image).
  - Turnstile verification slot (when enabled) and full-width sticky `开始生成` CTA showing exact credit cost.
- Lift the artificial `count = 1` clamp on `image_to_image` across Next.js (`parse-generate-request.ts`, `/api/generate`, `external-api.ts`, `gateway-client.ts`) and Go Worker (`generation.go`, `gateway.go`), bounded strictly by existing `1..4` (`ImageMaxOutputCount = 4`). Leave `contracts/media/v1/*` and Canvas v1 (`imageOutputCount: 1`) untouched.

### R9. Per-Image Credit Billing (`builtInCreditCost × count`)
- Update `src/lib/credits.ts` (`calculateGenerationCost` and `hasEnoughCredits`) and all image generation entry points (`/api/generate`, `external-api.ts`, `gateway-client.ts`) so built-in image generations charge `builtInCreditCost × count` (`count` in `1..4`).
- Video generations continue charging `videoCreditCost` (`count = 1`); custom API generations remain `0` credits.
- Failed or cancelled jobs continue refunding the full pre-deducted `creditsSpent`.
- The sticky `开始生成` CTA displays the exact computed credit total (e.g., `开始生成 · 20 积分` when unit cost is 5 and count is 4; `开始生成 · 自填 API（免积分）` in custom mode).

### R10. Result Stage & Canvas Mode Coexistence
- The right `生成结果` column displays:
  - Pending state: aspect-ratio-aware shimmer cards matching requested `count` + `取消生成` button.
  - Succeeded state: clean gallery grid (large single-image focus when 1 image; 2-column grid when 2–4 images), dimension & ratio badges, size-downgrade alert when `describeSizeDowngrade` triggers, unavailable/cleaned placeholder via `<ImageUnavailable />`, and actions (`加入参考图`, `复用参数`, `放大查看`, `下载`).
  - Failed state: error alert + `重新生成` (submits a new job using that record's config/available references) + `复用参数`.
- Preserve `StudioModeSwitch` when `CANVAS_ENABLED=true` (relabeling `对话` to `工作台` while keeping `画布`), single root `useStudioJobs` poller, owner-switch cleanup, and all Canvas behavior/tests intact.

## Acceptance Criteria

- [x] **AC1 (R1, R10)**: Desktop `/create` renders the 3-column warm cream/terracotta workbench (`生成记录` | `生图工作台` | `生成结果`). When `CANVAS_ENABLED=true`, switching between `工作台` and `画布` works without losing pending job polling or breaking Canvas state. Mobile/tablet viewports (`390px` / `768px`) provide drawer access to `生成记录` and tab switching between `工作台` and `结果`.
- [x] **AC2 (R2)**: Submitting `开始生成` sends no `/api/me/conversations` request, creates one standalone `GenerationJob`, prepends & selects it in `生成记录`, and polls until terminal state. Existing pre-redesign image jobs load in `生成记录` with cursor pagination (`加载更多`).
- [x] **AC3 (R2)**: Single delete and `全选 -> 删除` call `POST /api/me/generations/hide`, immediately remove succeeded/failed items from `生成记录`, persist across page reload and `router.refresh()`, skip pending jobs with clear feedback, and leave `/works` and `GenerationImage` rows untouched.
- [x] **AC4 (R3)**: Selecting any record in `生成记录` updates `生成结果` without altering unsaved prompt/references/settings in `生图工作台`. Submitting keeps the workbench draft intact. Clicking `复用参数` populates the workbench; clicking `+ 新建` resets the draft and focuses the prompt field.
- [x] **AC5 (R4, R6)**: No manual `文生图/图生图` switch exists. Submitting with 0 references sends JSON `generationType: "text_to_image"`; submitting with 1–16 references (via upload, drag-drop, paste, `剪切板` button, `我的作品`, or result `加入参考图`) sends multipart `FormData` `generationType: "image_to_image"` and preserves the current prompt when appending references.
- [x] **AC6 (R5)**: Clicking `提示词库` searches/filters `/api/prompts` and fills the prompt textarea on selection; clicking `我的作品` paginates `/api/me/works` and supports both `加入参考图` (for available images only) and `填入提示词`.
- [x] **AC7 (R7)**: Selecting resolution tiers (`1K/2K/4K/自动`) and aspect ratio cards (`1:1..9:21/自动`) updates `W × H` via `calculateImageSize`; manual `W × H` edits respect the `16 倍数对齐` toggle, swap button works, and limit warnings display accurately.
- [x] **AC8 (R8)**: `image_to_image` accepts `count` `1..4` end-to-end across UI, `parseGenerateRequest`, `/api/generate`, `reserveManagedImageOutputs`, external API / gateway, and Go Worker (`/images/edits` sends `n=<count>`; `/responses` loops `count` times; max output validation allows up to `job.Count <= 4`). `contracts/media/v1/*` and Canvas v1 `imageOutputCount = 1` remain unchanged.
- [x] **AC9 (R9)**: Built-in image generations check balance and deduct `builtInCreditCost × count` (reflected live on `开始生成`), refund full `creditsSpent` on failure/cancel, keep video at `videoCreditCost`, and keep custom API at `0`.
- [x] **AC10 (Quality Gates)**: `pnpm lint`, `pnpm exec tsc --noEmit`, full non-DB `pnpm exec vitest run --testTimeout=30000`, `go test ./...` under `worker/`, `pnpm build`, and `git diff --check` all pass, accompanied by real-browser desktop & mobile visual verification of the rendered workbench.

## Out of Scope

- **Transparent background (`background: "transparent"`)**: excluded per user decision (no DB/API/Worker changes).
- **Single-job output count > 4 (`5..10` images) or extra quality tiers (`极高 / 最高`)**: excluded to avoid modifying `contracts/media/v1/schema.json` and `storageRevision`.
- **Dark mode / theme switcher**: excluded per user decision (retain NARRA Image warm light palette).
- **Removing legacy `/api/me/conversations` routes or dropping the `Conversation` table**: keep intact for zero-downtime compatibility and existing API tests.
- **Changes to `/video`, `/works`, `/prompts` standalone pages, Canvas v1 storage/run contracts, or production deployment/migrations execution**.

## Risks & Verification Boundaries

- **Upstream provider compatibility for `image_to_image` `n > 1`**: Standard OpenAI `/images/edits` supports `n: 1..10` and `/responses` loops `count` times in Go Worker, but third-party proxies vary (some may return fewer than `n` images or reject `n > 1`). Worker accepts `1..job.Count` returned images cleanly and surfaces upstream HTTP errors transparently with refund on pre-handoff/v0 failure.
- **Prisma migration & schema probe safety**: Adding nullable `GenerationJob.studioHiddenAt` + index is purely additive and verified against `contracts/media/v1/schema.json` and `image-schema.test.ts`; the new migration SQL must enforce LF line endings in `.gitattributes`.
- **Test surface**: Existing `generator-studio-*.test.tsx` tests target the old chat/conversation UI and must be updated/replaced cleanly to cover the new workbench while keeping all safety/origin/availability/canvas invariants tested.
- **Verification limits**: Real browser verification uses a local Next server/fixture; live third-party provider calls, physical iOS/Android devices, and production DB migration execution remain outside automated verification unless explicitly requested.
