# Research: Current studio and dual-view integration boundaries

- Query: What does removing history images affect, and how can the existing image studio support conversation and infinite-canvas views without duplicating generation logic?
- Scope: internal repository architecture, persistence, compatibility, and test inventory
- Date: 2026-10-28
- Method: static source/spec/task-history inspection; no application, database, or dependency changes

## Findings

### 1. Main conclusions

1. History images exist in two places: the desktop right rail and the mobile
   sidebar's recent-images tab. Removing only `HistoryRail` leaves the feature
   present on phones (`src/components/create/parts/session-sidebar.tsx:71`).
2. The history-image list is a presentation-level projection, not a separate
   media store. Existing jobs and images must not be deleted to remove this UI.
   Conversation deletion intentionally retains jobs and images; `/works` still
   finds them by user ownership, not conversation membership
   (`prisma/schema.prisma:453`, `src/lib/server/works.ts:128`).
3. One mounted studio controller can serve both renderers. Generation settings,
   references, provider configuration, CAPTCHA, submit/cancel/retry, polling,
   zoom, and download already live above `ChatStream`. Switching renderers is
   much safer than mounting independent copies of `GeneratorStudio`.
4. The latest-50-jobs query is NOT history-rail-only. It currently supplies the
   content used to hydrate and switch conversations. Removing it without a
   replacement conversation-scoped loader loses chat content
   (`src/app/create/page.tsx:28`,
   `src/components/create/generator-studio.tsx:189`,
   `src/components/create/generator-studio.tsx:937`).
5. No canvas scene, positions, viewport, edges, or draft-node persistence exists.
   A temporary client-side board can use local state, but durable/cross-device
   layouts require additive persistence and owner-scoped loading/saving
   (`prisma/schema.prisma:499`).
6. A spatial image board and a connected, per-node prompt/reference/result
   workspace have materially different scope. The current backend can execute
   individual node actions; it does not provide a graph scheduler or provenance
   graph. The intended canvas interaction is still a user-owned decision.

### 2. Files found and responsibility map

| File | Current responsibility / relevant evidence |
| --- | --- |
| `src/app/create/page.tsx:19` | Authenticated server page; queries jobs, conversations, channels, saved provider, and CAPTCHA configuration. |
| `src/components/create/generator-studio.tsx:79` | Single client container; owns all form/session state and wires both sidebars, stream, composer, modals, and generation actions. |
| `src/components/create/parts/history-rail.tsx:35` | Desktop thumbnails, context menu, URL drag source; hidden below the `md` breakpoint. |
| `src/components/create/parts/session-sidebar.tsx:24` | Conversation list and mobile recent-images tab; a second history-image surface. |
| `src/components/create/parts/chat-stream.tsx:21` | Conversation-scoped rendering and empty state; receives generation and action props. |
| `src/components/create/parts/generation-bubble.tsx:208` | Image-level edit/reuse/zoom/download controls; pending/failed/succeeded presentation. |
| `src/components/create/parts/composer.tsx:127` | File/URL drop handling, reference ordering, prompt input, IME-safe Enter, generation settings and submit controls. |
| `src/components/create/hooks/use-sessions.ts:37` | API-backed conversation list, create/rename/delete, local generation-ID bookkeeping, last-active preference. |
| `src/components/create/hooks/use-reference-images.ts:25` | Browser `File` and ObjectURL lifecycle, max-reference enforcement, reorder and cleanup. |
| `src/components/create/hooks/use-image-poller.ts:26` | Active-list pending-job polling with backoff, hidden-tab pause, and terminal-state completion. |
| `src/components/create/types.ts:33` | Shared generation DTO, references, settings and session types; no scene/viewport types. |
| `src/components/create/utils.ts:126` | Normalize reusable job settings and references into a composer-compatible configuration. |
| `src/app/api/generate/route.ts:40` | Auth/CAPTCHA/moderation/provider validation, source upload, transactionally enqueue job and precharge credits. |
| `src/app/api/me/conversations/route.ts:10` | Current-user conversation list (IDs only) and create API. |
| `src/app/api/me/conversations/[id]/route.ts:9` | Owner-scoped rename/delete only; no conversation-content GET endpoint. |
| `src/app/api/me/generations/[id]/route.ts:12` | Owner-scoped job read and cancellation with handoff/refund restrictions. |
| `src/lib/prisma-mappers.ts:75` | Conversation IDs/titles/timestamps serialization. |
| `src/lib/prisma-mappers.ts:331` | Job serialization; dimensions, references, images and collapsed client statuses. |
| `prisma/schema.prisma:404` | Canonical persisted generation request, lifecycle and media relations. |
| `prisma/schema.prisma:499` | Minimal conversation container, with no canvas-specific fields. |
| `src/app/works/page.tsx:19` | Separate user works page, initially loads 24 images with pagination metadata. |
| `src/lib/server/works.ts:117` | User-owned image query, independent of `conversationId`. |

### 3. Current layout and exact removal surface

Desktop layout is a fixed-height studio below `SiteHeader`, with left
conversations, central stream plus floating bottom composer, and right history
images (`src/app/create/page.tsx:78`,
`src/components/create/generator-studio.tsx:974`). The right rail is 18rem wide,
20rem on XL, and hidden on mobile
(`src/components/create/parts/history-rail.tsx:83`).

On mobile, the conversation sidebar is an off-canvas panel and has two tabs:
conversations and recent images. The image tab reads the same projected list
and opens the same zoom state
(`src/components/create/parts/session-sidebar.tsx:35`,
`src/components/create/parts/session-sidebar.tsx:72`,
`src/components/create/generator-studio.tsx:984`). There is no independent
mobile history API.

If the user's intent is to remove history images throughout the studio, the
presentation-only removal surface is:

- `HistoryRail` import and render wiring
  (`src/components/create/generator-studio.tsx:34`,
  `src/components/create/generator-studio.tsx:1210`).
- `historyImages` derived projection: merge initial and active-session jobs,
  retain succeeded images, deduplicate by image ID, sort by job creation time
  (`src/components/create/generator-studio.tsx:265`).
- `SessionSidebar` history-image props, images-tab state, mobile tab button,
  thumbnail grid, and history-only thumbnail helper import
  (`src/components/create/parts/session-sidebar.tsx:19`,
  `src/components/create/parts/session-sidebar.tsx:35`,
  `src/components/create/parts/session-sidebar.tsx:99`). Keep its conversations.
- Rail context-menu state/listeners and drag-source wiring disappear with the
  component (`src/components/create/parts/history-rail.tsx:38`,
  `src/components/create/parts/history-rail.tsx:75`).
- Update history-specific comments and tests; do not keep misleading statements
  that orphan jobs are visible in a now-removed rail
  (`src/components/create/generator-studio.tsx:171`,
  `src/components/create/generator-studio.tsx:599`).

Do NOT remove shared zoom/download/edit/reuse handlers, the modal, image URL
utilities, reference hooks, initial job data, or generation storage merely
because the rail used them. Chat bubbles independently expose those actions
(`src/components/create/generator-studio.tsx:1016`,
`src/components/create/generator-studio.tsx:1120`,
`src/components/create/parts/generation-bubble.tsx:208`).

`HISTORY_IMAGE_DRAG_MIME` currently has one producer (the rail) but the composer
and tests consume it (`src/components/create/constants.ts:44`,
`src/components/create/parts/composer.tsx:131`). Decide whether to retire/rename
this internal protocol or reuse a generic asset-drag protocol for canvas
images. Ordinary file drops and `text/uri-list` reference drops must remain.
There is a separate video history rail; the image-studio request does not
establish consent to remove `/video` history
(`src/components/video/video-studio.tsx:278`).

### 4. Existing generation lifecycle and reusable actions

```text
Authenticated /create server page
  -> serialized initial jobs + conversation IDs + provider/CAPTCHA configuration
  -> one GeneratorStudio container
       -> active-conversation job list -> ChatStream / future CanvasView
       -> shared composer/settings/references
       -> submit snapshot
       -> create conversation if necessary
       -> POST /api/generate -> PENDING persisted job + transactionally charged credits
       -> existing Go worker performs generation and persists media
       -> GET /api/me/generations/:id polling -> terminal DTO -> refresh server props
```

- The container owns prompt, negative prompt, generation type, provider/model,
  channel, dimensions, quality, output, count, references, errors and CAPTCHA
  state (`src/components/create/generator-studio.tsx:90`).
- Submission snapshots input and clears the composer immediately, preserving
  references in the snapshot for restore on failure
  (`src/components/create/generator-studio.tsx:541`,
  `src/components/create/generator-studio.tsx:575`).
- If there is no active conversation, creation happens before submitting the
  job. Creation failure restores input and prevents orphan jobs
  (`src/components/create/generator-studio.tsx:593`).
- Text-to-image submits JSON; image-to-image submits multipart files and/or
  existing `referenceImageUrls`. The image-to-image parser forces count 1 and
  accepts at most 16 references
  (`src/components/create/generator-studio.tsx:608`,
  `src/lib/generation/parse-generate-request.ts:59`,
  `src/lib/generation/parse-generate-request.ts:115`).
- The API verifies conversation ownership, validates public source URLs,
  persists uploaded reference files, and enqueues the worker job with the
  existing contracts. Canvas actions should call this path, not bypass its
  CAPTCHA, moderation, provider validation, precharge, or worker lifecycle
  (`src/app/api/generate/route.ts:44`,
  `src/app/api/generate/route.ts:136`,
  `src/app/api/generate/route.ts:153`,
  `src/app/api/generate/route.ts:175`).
- Client `pending` combines backend `PENDING` and `PROCESSING`; a canvas cannot
  assume that every pending node remains freely cancellable
  (`src/lib/prisma-mappers.ts:449`,
  `src/app/api/me/generations/[id]/route.ts:69`).
- Selecting a generated image for edit appends an existing source URL, switches
  to image-to-image, locks count to 1, and focuses the composer. Reuse restores
  normalized options and persisted source URLs
  (`src/components/create/generator-studio.tsx:760`,
  `src/components/create/generator-studio.tsx:782`).
- Retry creates a new job and replaces the failed bubble's job ID in local
  session bookkeeping. The API detaches the old failed job from its conversation
  rather than deleting it. A canvas node that tracks a retry must update its
  job reference or deliberately retain an attempt history
  (`src/components/create/generator-studio.tsx:875`,
  `src/components/create/generator-studio.tsx:704`,
  `src/app/api/generate/route.ts:223`).
- Download uses the existing `/api/proxy-image` flow with an external-open
  fallback (`src/components/create/generator-studio.tsx:470`).

### 5. Persistence, retention and current limitations

Conversations and generation records are server-persisted. `localStorage` only
stores `narra_active_conversation_id`; provider API keys, prompt drafts and
reference `File` objects are not a canvas persistence mechanism
(`src/components/create/hooks/use-sessions.ts:13`,
`src/components/create/hooks/use-sessions.ts:130`). The storage-event listener
currently performs no refresh or scene merging
(`src/components/create/hooks/use-sessions.ts:153`).

Conversation deletion uses `ON DELETE SET NULL`, verified in both the Prisma
relation and migration. Images remain attached to retained jobs
(`prisma/schema.prisma:453`,
`prisma/migrations/20260505000000_add_conversation/migration.sql:25`). The
owner-scoped DELETE route intentionally follows that contract
(`src/app/api/me/conversations/[id]/route.ts:38`).

After removing history, orphan generated images remain accessible through
`/works`: its image query filters `job.userId` and does not require a
conversation. The site header already exposes the works page
(`src/lib/server/works.ts:128`,
`src/components/marketing/site-header.tsx:37`). A separate explicit works
deletion endpoint deletes an image record; a canvas-node delete should not call
that endpoint unless the product intentionally means media deletion
(`src/app/api/me/works/[id]/route.ts:19`).

The existing main-view contract intentionally does not project orphan/global
history into an empty conversation. The September archived fix documents why;
its historical choice to keep the rail is not a decision against the user's
new removal request
(`.trellis/spec/frontend/state-management.md:78`,
`.trellis/tasks/archive/2026-09/09-13-fix-deleted-conversation-history-merge/prd.md:22`).

Important source-backed limitations for planning:

- The server queries only the user's latest 50 jobs while each conversation
  contains a full ID list, and the sidebar can list up to 100 conversations.
  Initial restore/switch silently filters IDs not present in the latest-jobs
  slice or browser cache. There is no conversation-content GET route or
  pagination today; `/api/me/generations` is also only a global latest-24 list
  (`src/app/create/page.tsx:36`, `src/app/create/page.tsx:49`,
  `src/components/create/generator-studio.tsx:189`,
  `src/components/create/generator-studio.tsx:937`,
  `src/app/api/me/generations/route.ts:26`). A durable board must not claim
  complete old-project restoration until this is addressed or explicitly
  bounded in the MVP.
- The current scene-equivalent is only an ordered generation-ID list. Source
  inputs persist as URLs, not graph edges or source-node IDs. Historical URLs
  alone cannot reliably reconstruct user-intended prompt/reference provenance
  (`src/components/create/types.ts:113`, `prisma/schema.prisma:439`).
- Uploaded reference nodes are browser files/ObjectURLs until generation
  uploads them. No general-purpose canvas asset-upload route was found; only
  generation reference uploads and avatar uploads exist. Saving unsubmitted
  imported reference nodes needs an asset lifecycle decision and likely an
  owner-scoped upload path
  (`src/components/create/hooks/use-reference-images.ts:58`,
  `src/app/api/generate/route.ts:153`).
- Layout persistence should reference canonical job/image IDs plus validated
  scene metadata; do not duplicate image bytes, encrypted provider secrets,
  temporary `blob:` URLs or browser `File` objects into scene JSON. Existing
  media URLs remain compatible across S3 and legacy storage
  (`prisma/schema.prisma:511`,
  `.trellis/spec/operations/media-storage.md:35`).

### 6. Candidate integration boundaries (recommendations, not approved scope)

Keep a single mounted container/controller above a `chat` / `canvas` renderer
switch. The view switch must be a separate concept from existing
`GenerationType` (`text_to_image`, `image_to_image`, and video types)
(`src/lib/types.ts:2`). Existing tests referring to "mode switching" currently
test text/image generation types, not chat/canvas views
(`src/tests/unit/generator-studio-retry-cancel.test.tsx:339`).

For shared conversation/project content:

- Render both views from the same owner-scoped canonical job state and active
  conversation ID; leave submit/poller/reference/CAPTCHA ownership outside
  mode-specific components.
- Put canvas-only selection, transform and node geometry in a local scene
  layer. Persist layout per conversation if durable layouts are in scope.
- Canvas node actions can call existing submit/edit/reuse/retry/cancel commands.
  Generating from a node is not justification to introduce a second generation
  API or a second worker/refund lifecycle.
- Load the canvas client module only when needed; the studio already has
  `next/dynamic` client-only patterns for heavy settings and zoom components
  (`src/components/create/generator-studio.tsx:49`). Keep the library's scene
  state distinct from app-wide business state.
- Preserve image dimensions and thumbnail helpers; they supply known aspect
  ratios and efficient preview URLs for zoomable assets
  (`src/lib/prisma-mappers.ts:397`, `src/lib/image-url.ts:35`).

If modes instead own independent projects, a new project/workspace ownership
model and conversion/import behavior must be designed. Do not repurpose the
existing global image history as an implicit shared canvas.

Connected prompt/reference/result nodes can remain individual API operations
in an MVP. Full graph execution, automatic upstream propagation, arbitrary
tools, realtime collaboration, video canvas, full-scene export and editing
masks are additional product capabilities, not implied by "infinite canvas."

### 7. Switching, race and interaction risks to test

| Risk / edge case | Repository evidence and verification needed |
| --- | --- |
| Renderer remount loses drafts/polling/previews | Hooks own cleanup on unmount (`use-reference-images.ts:37`, `use-image-poller.ts:29`). Switch renderers below the same controller; verify references, prompt, model and pending jobs survive. |
| A submit completes after switching conversations | `handleGenerate` reads an active ID, then asynchronously creates/submits, and later appends to the CURRENT list without checking that its conversation still matches (`generator-studio.tsx:594`, `generator-studio.tsx:704`). Capture origin ownership in the command and update the canonical map, deriving only the active view. This is a source-level race risk, not a runtime-reproduced bug in this research. |
| Stale polling after session switch/unmount | Timers stop for absent pending IDs, but `pollOnce` has no request abort or completion-generation guard (`use-image-poller.ts:48`, `use-image-poller.ts:104`). Delayed responses must not populate another scene or reschedule a removed task. |
| Polling accidentally duplicates or stops on view change | Current poller consumes the active job list (`generator-studio.tsx:263`). Verify view changes do not add another poller, cancel in-flight generation, or reset pending nodes. |
| Refresh resets mode/layout or resurrects deleted content | Preserve the guarded initial-prop boundary (`generator-studio.tsx:177`, state-management spec:43). Existing tests cover new/deleted conversations across fresh props. |
| Hydration mismatch from mode/layout preference | Read browser preference after mount, not during SSR render or lazy state initializer (`.trellis/spec/frontend/state-management.md:72`). Use a stable initial renderer/loading contract. |
| Retry breaks scene identity | Failed-job replacement changes the job ID; maintain node identity while rebinding job reference (`generator-studio.tsx:704`, `use-sessions.ts:100`). |
| Cancel falsely promises backend abort/refund | Submitted/uncertain jobs return 409; preserve existing API result semantics (`src/app/api/me/generations/[id]/route.ts:69`). |
| Canvas pan/zoom intercepts prompt editing and image drops | Current composer uses URL/file DnD, reference reorder, and IME-safe Enter (`composer.tsx:127`, `composer.tsx:219`, `composer.tsx:305`). Inputs, modals and controls need gesture/key isolation and touch targets. |
| Floating composer hides canvas nodes/controls | Current stream padding follows measured composer height (`generator-studio.tsx:226`, `chat-stream.tsx:29`). Canvas viewport/controls need equivalent reserved space, including mobile safe area and settings sheet. |
| Deleted scene is mistaken for deleted media | Conversation deletion retains jobs; works deletion removes images. Test layout/node removal independently of cancellation or media deletion. |
| Save/load crosses user or stale scene boundaries | New scene endpoints must verify current-user ownership, referenced job/media IDs and bounded schemas. Reject late loads/saves for a different active project and decide multi-tab conflict behavior explicitly. |

### 8. Existing tests and additional acceptance coverage

Preserve or adapt these existing behavior tests; none were executed during
this static research:

- `src/tests/unit/generator-studio-session-history.test.tsx:110`: orphan isolation.
- `src/tests/unit/generator-studio-session-history.test.tsx:142`: deletion and refreshed-props isolation.
- `src/tests/unit/generator-studio-session-history.test.tsx:180`: new conversation is not overwritten by refresh.
- `src/tests/unit/generator-studio-session-history.test.tsx:216`: conversation-create failure stops generation and restores input.
- `src/tests/unit/generator-studio-session-history.test.tsx:247`: restore the last active conversation.
- `src/tests/unit/generator-studio-feedback.test.tsx:236`: file drag/drop remains usable.
- `src/tests/unit/generator-studio-feedback.test.tsx:251`: history drag source needs replacement/adaptation if removed; generic source-to-reference behavior can remain.
- `src/tests/unit/generator-studio-feedback.test.tsx:268`: floating-composer inset tracks actual size.
- `src/tests/unit/generator-studio-feedback.test.tsx:294`: reference ordering.
- `src/tests/unit/generator-studio-feedback.test.tsx:321`: actual image resolution and aspect ratio.
- `src/tests/unit/generator-studio-feedback.test.tsx:338`: bubble config reuse stays valid without the rail.
- `src/tests/unit/generator-studio-feedback.test.tsx:367`: rail context menu is intentionally retired or replaced by a canvas equivalent.
- `src/tests/unit/generator-studio-feedback.test.tsx:384`: custom provider JSON submission.
- `src/tests/unit/generator-studio-feedback.test.tsx:432`: custom provider multipart submission.
- `src/tests/unit/generator-studio-feedback.test.tsx:472`: existing remote image references submit as `referenceImageUrls`.
- `src/tests/unit/generator-studio-edit.test.tsx:99`: continuous image-to-image editing.
- `src/tests/unit/generator-studio-retry-cancel.test.tsx:96`: failed-job replacement.
- `src/tests/unit/generator-studio-retry-cancel.test.tsx:186`: cancellation presentation.
- `src/tests/unit/generator-studio-retry-cancel.test.tsx:330`: keep existing generation-mode accessibility; add independent chat/canvas selection accessibility.
- `src/tests/unit/parse-generate-request.test.ts:204`: reference cap contract.
- `src/tests/unit/generation-cancel-route.test.ts:124`: cancellation race/conflict semantics.

New acceptance coverage should verify both desktop rail and mobile images tab
are absent; works still exposes orphan images; both renderers show the same
project content if sharing is chosen; renderer changes preserve draft/settings
and live jobs; stale project operations cannot contaminate another project;
scene positions/viewport restore according to the chosen persistence guarantee;
old conversations outside the latest-50 slice behave according to an explicit
loading policy; keyboard and mobile gestures work without blocking the composer.

Future implementation validation should follow the quality spec: targeted
studio tests, full non-DB Vitest with the specified timeout, lint, TypeScript,
production build, and migration verification if additive scene persistence is
introduced. Do not interpret the archived task's passing tests as this branch's
current test result.

## Related Specs And Prior Documents

- `.trellis/workflow.md`: research stays in planning; persist findings; no implementation before artifact review and subsequent approval.
- `.trellis/spec/frontend/directory-structure.md`: keep feature-local parts/hooks/types under `create`; server data access under `src/lib/server`.
- `.trellis/spec/frontend/component-guidelines.md`: controlled feature parts, named exports and accessible interaction patterns.
- `.trellis/spec/frontend/hook-guidelines.md`: imperative hook contracts and cleanup for timers/listeners/ObjectURLs.
- `.trellis/spec/frontend/state-management.md`: one controller, server initial data, guarded hydration, no global-list fallback or automatic global store.
- `.trellis/spec/frontend/type-safety.md`: typed scene DTOs, validation and serialization boundaries.
- `.trellis/spec/frontend/quality-guidelines.md`: Vitest/Testing Library, lint/tsc/build and disposable-DB test safety.
- `.trellis/spec/frontend/generation-worker-contracts.md`: do not create a parallel enqueue/handoff/cancellation/refund state machine for canvas.
- `.trellis/spec/operations/media-storage.md`: retain legacy/S3 media compatibility; no production media mutation during research.
- `.trellis/tasks/archive/2026-09/09-13-fix-deleted-conversation-history-merge/prd.md`: prior rationale and regression coverage for conversation isolation and retention.
- `docs/superpowers/specs/2026-06-01-video-workspace-design.md:13`: prior video research mentioned a node-style infinite canvas, but intentionally scoped `/video` as linear. It does not settle the user's new image-studio direction.

## External References And Versions

This report does not compare external canvas projects; that is a separate
research topic. Local integration constraints come from `package.json`: Next
16.2.4, React/React DOM 19.2.4, TypeScript 5, Tailwind CSS 4, Prisma 7, Vitest 4,
and project license AGPL-3.0-only (`package.json:5`, `package.json:47`).

## Caveats / Not Found

- No app UI, browser gesture, performance, build or test result was reproduced;
  findings are source-backed and recommendations require implementation-time
  verification.
- No existing canvas dependency, scene schema, layout endpoints, graph executor,
  general canvas-reference upload endpoint, or per-conversation content loader
  was found in the inspected source.
- Product decisions remain open: spatial board versus connected prompt nodes;
  shared versus separate workspaces; temporary versus durable/cross-device
  scene persistence; unsubmitted imported asset retention; exact first-version
  canvas actions; and whether history removal is studio-only. Recommendations
  here must not be treated as approved product requirements.
- The retained-images contract and the latest-50 loading limitation are
  different concerns. A canvas should neither erase retained media nor hide a
  content-loading gap behind an apparently empty project.
