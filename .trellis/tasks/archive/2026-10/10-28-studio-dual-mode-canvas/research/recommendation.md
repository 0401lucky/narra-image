# Research: Dual-Mode Studio Recommendation

- Query: How should narra-image approach history removal and a switchable
  conversation/infinite-canvas studio?
- Scope: synthesis of local architecture and live primary-source research
- Date: 2026-10-28
- Status: research complete; independent spaces, actual node-input bindings and
  manual node execution confirmed; local-autosave/manual-account-save selected;
  presentation-only history removal and generated-media preservation selected;
  account snapshots include unsubmitted imported reference originals;
  new/select/rename/delete management and deletion without job cancellation selected;
  desktop core editor and read-only phone canvas selected; full phone editing
  is explicitly tracked as an independent deferred follow-up;
  seven-day new-import-only cleanup selected; product choices resolved;
  final technical planning review/implementation approval pending

## Executive Recommendation

The direction is feasible without replacing the image-generation backend.
The user selected independent conversation/canvas spaces after the linked-node
decision: new canvases should be easy to create without mixed content. The
earlier same-content/shared-view recommendation is superseded. Reuse generation
services, but isolate workspace documents, content, selection, and drafts. A
mode button must not implicitly copy content, submit another job, or assign a
result to whichever space happens to be visible when it arrives.

After this research was presented, the user selected prompt/reference/result
node connections for the first version on 2026-10-28. The initial spatial-first
recommendation is therefore superseded: the target is a linked creative-node
canvas. Pan/zoom, movable cards, selected references, visible job states and a
fit-view control remain useful capabilities to discuss. The user subsequently
selected step-by-step manual node execution. Graph-wide automatic execution is
excluded from the first version.

The first-version linked-node direction, independent workspace relationship,
actual prompt/reference input bindings through connections, and individually
triggered generation are confirmed here. Following the cost-sensitive saving
proposal, the user also accepted local draft autosave plus an explicit save to
their account. Other devices restore the last successfully saved account version,
not newer local edits. Background cloud autosave is not selected. The user also
confirmed presentation-only history removal and canvas/node deletion without
deleting generated images, retaining the separate works experience. They
accepted that canvas deletion does not free retained generated-image storage.
The user additionally approved including imported reference originals in an
explicit account save before any generation, allowing complete reference recovery
on another device; later saves must reuse unchanged persisted files. This adds
reference-file storage, not background scene autosave. Other recommendations are
not automatically approved requirements. The user also selected new/select/
rename/delete management, deferred canvas duplication, and chose canvas/node
deletion that does not automatically cancel/refund submitted jobs. Normal
generation results remain in works; existing cancellation and lifecycle refunds
stay separate. The user selected desktop pan/zoom/drag, node editing/connections,
reference upload/reuse, manual generation, and image view/download. Phone canvas
selection/view/pan/zoom is initially read-only; existing phone conversation
creation remains. Full phone editing must be tracked as a later task, now created
independently at `.trellis/tasks/10-28-studio-mobile-canvas-editor/prd.md` without
activation. The user accepted seven-day grace for cleaning newly owned unused
reference imports while protecting saved-canvas/job roots and generated/legacy
media, including the risk of re-upload from older unsynced local drafts. All
currently identified first-version product decisions are resolved.

## What The Repository Establishes

- History removal has two UI surfaces: desktop `HistoryRail` and the mobile
  `SessionSidebar` recent-images tab. Removing only the right rail is incomplete
  (`src/components/create/generator-studio.tsx:1210`,
  `src/components/create/parts/session-sidebar.tsx:71`).
- Image operations are shared with conversation bubbles. Zoom, download, reuse,
  editing, reference selection, and generation commands must not disappear with
  the rail (`src/components/create/parts/generation-bubble.tsx:208`).
- Conversations intentionally retain their images when deleted; `/works` loads
  user-owned images without requiring a conversation. This supports the user's
  selected presentation-only history removal and retained-images deletion rule
  (`prisma/schema.prisma:453`, `src/lib/server/works.ts:128`). It does not authorize
  adding implicit media deletion to conversation or canvas APIs.
- The global latest-50-jobs query also hydrates conversations. It cannot simply
  be deleted as "history-only" data. Complete old-conversation loading is already
  limited and needs an explicit restoration policy in any durable-board design
  (`src/app/create/page.tsx:36`,
  `src/components/create/generator-studio.tsx:189`,
  `src/components/create/generator-studio.tsx:937`).
- No canvas layout/viewport/edge persistence exists. Reference files are only
  uploaded as part of generation today; a saved unsubmitted reference-card
  experience requires an asset-lifecycle decision
  (`prisma/schema.prisma:499`, `src/app/api/generate/route.ts:153`).
- Submission and polling have source-level stale-response risks during
  conversation changes. Keep business ownership above the renderer boundary and
  test origin-conversation updates rather than adding independent view pollers
  (`src/components/create/generator-studio.tsx:704`,
  `src/components/create/hooks/use-image-poller.ts:48`). No runtime reproduction
  is claimed by this research.

The full file/handler/API/test inventory is in `current-studio.md`.

## GitHub Applications Worth Referencing

| Project | Verified useful pattern | Why not adopt it wholesale |
| --- | --- | --- |
| [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) | Closest linked creative canvas: image/text/configuration nodes, SVG links, contextual assistant, project viewport and media identity | Custom DOM-transform engine, frontend/browser-direct providers and local stores; contextual canvas chat is not proof of a shared-data conversation/canvas mode switch |
| [tigerowo/infinite-canvas](https://github.com/tigerowo/infinite-canvas) | Related Next.js/Go variant, useful for server-backed canvas concepts | Explicitly derived from basketikun/HuFakai; AGPL root instead of MIT, SQLite/GORM/storage architecture differs from narra-image |
| [fancyboi999/Loomic](https://github.com/fancyboi999/Loomic) | Independent spatial-board example: canvas-owned conversations, generated artifacts placed onto a saved Excalidraw scene, hydration-safe autosave | Supabase/Fastify/LangGraph dependencies and drawing-editor scope are not required by a mode switch |
| [binghe1980/AI-Canvas](https://github.com/binghe1980/AI-Canvas) | Preserve earlier versions and place a new edit alongside its source for comparison | Local Codex/MCP application and separately licensed tldraw dependency; its MIT application license is not SDK production clearance |

Observed source commits and licenses are pinned in `ai-canvas-references.md`.
These projects provide interaction evidence, not a ready-made narra-image
integration or a tested shared-mode conversion contract.

## Canvas Infrastructure Shortlist

| Candidate | Recommendation for this project |
| --- | --- |
| [React Flow / xyflow](https://github.com/xyflow/xyflow) | Leading candidate for interactive React prompt/reference/status/image cards. MIT core, current React 19 peers satisfied, pan/zoom/selection/resize and optional links. It can also operate with no edges. |
| [react-zoom-pan-pinch](https://github.com/BetterTyped/react-zoom-pan-pinch) | A reasonable lean viewport for a deliberately small spatial board; custom dragging, selection, resize, keyboard interaction and persistence are still application work. |
| [Excalidraw](https://github.com/excalidraw/excalidraw) | MIT and suitable if drawing/annotation is central; less direct for rich live React generation cards. Requires client-only loading. |
| [tldraw](https://github.com/tldraw/tldraw) | Technically capable, but not the default choice: current SDK default terms prohibit production without a separate granted license. A public/MIT reference application does not remove this condition. |
| [React Konva](https://github.com/konvajs/react-konva) | Better suited to a graphics/image editor than this DOM-card studio. Latest wrapper requires React 19.3; matching 19.2.7 exists for current React 19.2.4 if this direction is later selected. |

React Flow Pro example code has separate terms from the MIT core. Do not copy
the paid undo/redo example just because the base library is MIT. Preserve notices
and review all reused assets/dependencies before implementation.

Versions, peer dependencies, license texts, official API references, source
snapshots, and a technical-spike checklist are in `canvas-library-comparison.md`
and `canvas-library-source-snapshot.json`. Peer compatibility is static evidence,
not a completed build or browser test.

## Proposed Integration Shape

```text
Studio shell / mode selection
  conversation space -> conversation list + existing ChatStream
                        conversation-owned jobs and draft
  canvas space       -> separate canvas list + new/select canvas
                        canvas-owned nodes/links/jobs and draft
  shared services    -> authenticated generation submission, polling,
                        provider validation, billing, retry/cancel, media
                        every command/response carries origin workspace
```

The proposal deliberately keeps workspace mode separate from generation type
(text-to-image/image-to-image). Reusing settings/command implementations must not
cause draft content or job membership to leak between independent spaces.
Preserving each space's draft/selection across switches is a useful behavior to
discuss, not evidence that the documents should be shared.

Canvas layout and generated artifacts should be keyed to an explicit owner-
scoped canvas identity, not the active conversation. The current schema has no
such model, so additive ownership/persistence design is needed. Reuse canonical
job/image IDs without automatically displaying conversation or global-history
jobs. The generation database remains authoritative. Do not serialize API keys,
callbacks, browser files, `blob:` URLs, or temporary media URLs as a durable
canvas document. Explicit import/copy, if later requested, is separate from
automatic mode synchronization and is not implied by this decision.

Keep the current cream/orange visual tokens and Chinese controls. Put the
composer and toolbars outside the transformed viewport. Preserve input focus,
IME text entry, textarea scrolling, reference drag/drop, keyboard access and
mobile safe areas. Do not inherit an unrelated reference application's styling
or pointer-only interaction model.

## Selected First-Version Scope

The individual scope decisions are selected. Their converged technical proposal
is in the parent and canvas-child design/plan; no implementation is approved:

- Honor the confirmed desktop/mobile history removal and retained generated-media
  rule; preserve conversation navigation and the separate works experience.
- Add a clearly labelled conversation/canvas button control.
- Honor the confirmed independent spaces: canvas-specific new/select behavior,
  no automatic conversation-to-canvas or canvas-to-conversation synchronization,
  and no inherited content in a new canvas.
- Honor the selected new/select/rename/delete lifecycle without duplication.
  Canvas/node deletion does not automatically cancel jobs or trigger refunds;
  late job completion must not recreate deleted organization, while works retains
  the generated results and normal cancellation/refund contracts remain intact.
- Support pan/zoom, image placement, selection, fit view, and existing
  image/reference/generation actions.
- Honor the selected desktop core editor and read-only phone canvas selection/
  view/pan/zoom. Full phone editing/connections/generation belongs to the explicit
  independent mobile follow-up after v1, not to this release or an omitted item.
- Show pending/failure/completion without duplicating the existing worker or
  polling mechanism.
- Honor the selected local-autosave/manual-account-save contract with visible
  local/unsynced and account-saved states. Include the selected unsubmitted
  reference-original saving/reuse guarantee. Seven-day cleanup protects saved/
  submitted-job inputs and excludes generated/legacy media; local-only drafts
  are not cross-device persistence and expired unrooted files may need re-upload.
- Include the confirmed first-version node connections as actual prompt/reference
  input bindings, with validated input resolution when the user manually runs a
  node. Whole-workflow execution and automatic upstream/downstream runs are
  excluded from the first version. Collaboration, masks/photo editing, and video
  canvas are additional capabilities, not implied by this selection.

## Server-Burden Findings

The focused follow-up is in `canvas-persistence-costs.md`:

- Pan/zoom, dragging, connecting and local buffering happen in the browser;
  cloud saving does not require server-side canvas rendering.
- A scene can reference existing job/image identities without duplicating media
  bytes. Local-only scenes still incur the existing manual-generation/backend
  media costs (`prisma/schema.prisma:404`, `prisma/schema.prisma:511`).
- The selected reference-save scope requires upload and retention before
  generation when the user explicitly saves a canvas containing new references
  (`src/components/create/hooks/use-reference-images.ts:58`,
  `src/app/api/generate/route.ts:153`).
- Incremental burden depends on active editors, metadata bytes, save frequency,
  total retained assets and image retrieval. Saving every drag event is avoidable;
  batching/drag-end saves, bounded retries and upload-once identities are design
  proposals, not currently implemented controls.
- Explicit manual account saving reduces metadata write frequency and can avoid
  uploading discarded drafts, but it does not remove the final storage cost of
  references that users ultimately save.
- Production storage follows the media spec; source support for S3 does not prove
  the actual deployment's storage/configuration or spare capacity. No load test,
  actual canvas-size measurement or production-capacity guarantee is claimed.

## Next Planning Gate

Connected nodes, independent spaces, actual connection-driven inputs, and
manually triggered generation have been selected, as has local draft autosave
with explicitly saved account snapshots. History/canvas/node organization removal
now preserves generated images and works by user decision. Saving imported
reference originals before generation and reusing persisted unchanged references
are also selected. New/select/rename/delete and non-cancelling deletion are now
selected too, as are desktop-first editing and read-only phone canvas use, with
full phone editing tracked in a later independent task. Seven-day cleanup grace
for newly owned unused references is also selected, with saved-canvas/job roots,
generated works and legacy media protected. Old unsynced drafts may require
re-upload; missing references stay actionable without dropping the draft. Source
evidence and proposed race/ownership safeguards are in
`canvas-reference-retention.md`. Complete the technical design, child-task plan,
and context curation, then present the latest final review for fresh approval.

Resolved decisions are in `product-decision-inventory.md`. The parent PRD is now
converged and parent/v1-child designs/plans are drafted. Validate their contracts,
real context manifests and sequential dependency, then present the latest final
review and wait for a subsequent explicit implementation approval. Detailed
source-backed frontend/backend contracts are split between
`canvas-frontend-contracts.md`, `canvas-frontend-persistence.md`,
`canvas-backend-contracts.md`, and `canvas-backend-operations.md`; they are not
passing runtime-test reports.

## Verification And Limits

- Research was static source/documentation inspection and live public
  GitHub/npm/official-doc retrieval.
- No third-party application was run; no dependency was installed; no app code,
  schema, stored image or generation record was modified.
- No browser, runtime, mobile, performance, lint, typecheck or application-test
  result is claimed. Such verification belongs to the approved implementation
  and narrow technical spike.
- This task remains `planning`. Individual product decisions are approved;
  research/design completion is not implementation or final phase-gate approval.
