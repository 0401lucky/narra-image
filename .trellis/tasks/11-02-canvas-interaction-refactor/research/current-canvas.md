# Research: Current Canvas Workflow And Refactor Boundaries

- Query: What users do on the current canvas, what source-backed interaction
  friction exists, and what compatibility/verification constraints govern a UX
  refactor informed by an image-centric infinite canvas.
- Scope: Internal source, shared contracts, tests, specs, and archived plans.
- Date: 2026-11-02 (Asia/Shanghai).
- Method: Read-only source/spec/history inspection. No application execution,
  browser observation, product changes, dependency installation, or Git operation.

## Findings

### 1. The Current Product Is A Manual Node Graph, Not An Image Board

The previous parent explicitly approved connected creative nodes, not a
placement-only board: editable prompt/reference inputs, generation actions,
stable results and actual semantic input connections. See
`.trellis/tasks/archive/2026-10/10-28-studio-dual-mode-canvas/prd.md:77`.
Explicit per-node Run, empty independent New, separate local/manual account
saving, and no automatic whole-graph execution were requirements, not accidents
(`.trellis/tasks/archive/2026-10/10-28-studio-dual-mode-canvas/prd.md:80`,
`.trellis/tasks/archive/2026-10/10-28-studio-dual-mode-canvas/prd.md:86`,
`.trellis/tasks/archive/2026-10/10-28-studio-dual-mode-canvas/prd.md:92`).

Current observable source-level flow:

1. Switch from conversation to canvas through the studio's mode switch. The
   controller/editor/jobs remain mounted above the lazy canvas; switching itself
   does not import chat or history or generate anything
   (`src/components/create/generator-studio.tsx:291`,
   `src/components/create/generator-studio.tsx:298`,
   `src/components/create/generator-studio.tsx:1186`).
2. Select an existing canvas or click New. New publishes a local UUID immediately,
   schedules local persistence, then registers an account shell. It is empty
   (`src/components/create/parts/canvas-sidebar.tsx:22`,
   `src/components/create/canvas/controller.ts:623`). Opening the canvas without
   an active document does not create one (`src/components/create/parts/canvas-stage.tsx:382`).
3. Add a prompt node and type its description. Add a separate generation node.
   Neither operation connects them (`src/components/create/parts/canvas-toolbar.tsx:63`,
   `src/components/create/parts/canvas-stage.tsx:172`,
   `src/components/create/parts/canvas-stage.tsx:191`). The blank-state instruction
   explicitly asks users to add both, connect, and manually run
   (`src/components/create/parts/canvas-stage.tsx:311`).
4. Connect prompt output to generation prompt input, using desktop ports or the
   generation inspector's source select followed by its confirmation button.
   The generation requires exactly one prompt with at least two trimmed
   characters (`src/components/create/parts/canvas-stage.tsx:291`,
   `src/components/create/parts/canvas-node-inspector.tsx:84`,
   `src/lib/canvas/graph.ts:132`).
5. Optionally import PNG/JPEG/WebP files through a chooser, external file drop or
   clipboard file paste. Each becomes its own reference node. Import selects the
   new node but does not connect it to any generation
   (`src/components/create/parts/canvas-stage.tsx:162`,
   `src/components/create/parts/canvas-stage.tsx:258`,
   `src/components/create/parts/canvas-toolbar.tsx:66`). Add image inputs through
   ports or generation inspector source selection. Existing same-canvas result
   nodes can also feed a generation; order is explicit, not geometric
   (`src/components/create/parts/canvas-node-inspector.tsx:118`,
   `src/components/create/parts/canvas-node-inspector.tsx:137`).
6. Inspect/configure the generation's provider/model/size/quality/format/etc.
   Desktop selection of a generation auto-opens the editor; touch selection does
   not (`src/components/create/parts/canvas-stage.tsx:124`). Provider credentials
   are configured through a captured-node runtime dialog, not copied from chat
   (`src/components/create/generator-studio.tsx:1178`).
7. Click Run in the node or editor. Pending fields are validated/applied before
   capture. Only direct connected inputs are frozen; there is no graph traversal
   or automatic upstream run (`src/components/create/parts/canvas-stage.tsx:139`,
   `src/components/create/canvas/run-commands.ts:97`,
   `src/lib/canvas/graph.ts:131`). Busy/uncertain nodes prevent a new run and expose
   explicit same-request retry/read-only recovery
   (`src/components/create/parts/canvas-nodes/generation-node.tsx:50`).
8. On success, immutable result cards appear in a column to the generation's
   right, with non-user-editable provenance links. Rerunning adds new results;
   it does not replace old cards or their positions
   (`src/components/create/canvas/commands.ts:160`). Desktop image click opens
   the existing full-size viewer; explicit download preserves original bytes
   (`src/components/create/parts/canvas-nodes/result-node.tsx:24`,
   `src/components/create/generator-studio.tsx:1196`).
9. Scene edits debounce to native IndexedDB. Account snapshot saving is explicit
   and includes all imported originals, even unconnected/unrun references
   (`src/components/create/canvas/controller.ts:187`,
   `src/components/create/canvas/controller.ts:533`,
   `src/components/create/canvas/controller.ts:551`).

### 2. Interaction Friction Supported By Source

These are UX mismatch hypotheses, not independently reproduced defects. The
user's report establishes dissatisfaction; source establishes the steps below.

| Current behavior | Likely friction if the desired workflow is image-first | Evidence |
| --- | --- | --- |
| First generation requires separate prompt and generation creation plus explicit connection. No combined create-and-connect action exists in the toolbar. | Users must understand graph wiring before producing their first image; changing CSS alone will not remove that burden. | `src/components/create/parts/canvas-toolbar.tsx:63`; `src/components/create/parts/canvas-stage.tsx:172`; `src/components/create/parts/canvas-stage.tsx:191` |
| Import creates/selects reference nodes but never supplies them to a generation automatically. | Dragging an image onto the canvas does not make it the active input; another target/source choice is needed. | `src/components/create/parts/canvas-stage.tsx:162`; `src/components/create/parts/canvas-node-inspector.tsx:137` |
| Desktop movement is limited to the card header; the image itself is a zoom/view button which stops click propagation. | A user dragging or clicking the prominent image gets a different action from dragging/selecting the card header. | `src/components/create/canvas/renderer-adapter.ts:27`; `src/components/create/parts/canvas-nodes/node-shell.tsx:25`; `src/components/create/parts/canvas-nodes/reference-node.tsx:59`; `src/components/create/parts/canvas-nodes/result-node.tsx:35` |
| Desktop prompt can be edited on-card, generation opens a side editor on selection, touch nodes are previews and require explicit Edit. | Interaction entry points vary by node kind and device; selecting a generation changes available canvas space while selecting an image can open a viewer instead. | `src/components/create/parts/canvas-nodes/prompt-node.tsx:21`; `src/components/create/parts/canvas-stage.tsx:124`; `src/components/create/parts/canvas-stage.tsx:197` |
| Touch movement is select -> Move -> fit/locate -> whole-card drag -> Done. | Safe gesture arbitration adds multiple actions to a common spatial operation and moves the camera on entry. | `src/components/create/parts/canvas-stage.tsx:151`; `src/components/create/parts/canvas-stage.tsx:198`; `src/components/create/parts/canvas-stage.tsx:208` |
| Background drag pans; wheel zooms; multi-selection/selection-key behavior is explicitly disabled. | Users expecting selection marquee, Shift selection, trackpad scroll pan, or a pan/select tool may find the gesture vocabulary unfamiliar. | `src/components/create/parts/canvas-stage.tsx:303` |
| Sources are selected from text dropdowns plus a separate confirm button. References/results use six-character identifiers; preview appears after choosing. | Larger boards are harder to recognize/reuse visually than a thumbnail-first selector or context action. | `src/components/create/parts/canvas-node-inspector.tsx:84`; `src/components/create/canvas/renderer-adapter.ts:44`; `src/components/create/parts/canvas-node-picker.tsx:44` |
| All cards are 18rem wide; images occupy a fixed 10.5rem-high box with labels/status/buttons/headers. | The canvas presents workflow metadata more prominently than image composition/visual comparison. | `src/components/create/parts/canvas-stage.module.css:147`; `src/components/create/parts/canvas-stage.module.css:162` |
| Desktop document rail is 15rem; editor is 21rem. At tablet widths the editor overlays the viewport. Touch editor can consume 72dvh and cover toolbar Save. | Controls/panels compete with the spatial workspace, especially on small screens. Existing approved Close -> Save interaction intentionally compensates for overlay coverage. | `src/components/create/parts/canvas-stage.module.css:17`; `src/components/create/parts/canvas-stage.module.css:230`; `src/components/create/parts/canvas-stage.module.css:282`; `.trellis/spec/frontend/canvas-studio.md:71` |

No undo/redo, marquee, group movement, resize command, copy/paste scene objects,
space-pan tool, context menu, or duplicate-generation UI is exposed by the
current controller/renderer command set. This is an absence of capability, not
a failed existing capability (`src/components/create/canvas/controller.ts:840`,
`src/components/create/canvas/commands.ts:28`,
`src/components/create/parts/canvas-stage.tsx:303`). The prior mobile plan
explicitly excluded undo/lasso/multi-select/duplication/auto-layout
(`.trellis/tasks/archive/2026-10/10-28-studio-mobile-canvas-editor/prd.md:121`).

Performance risk, not measured regression: every desktop position callback
currently goes through `moveNode` -> copy/validate/serialize candidate scene ->
publish/debounce, and viewport callbacks also dirty/publish the domain camera.
Touch Move already uses a renderer-only preview and one final accepted move.
Evaluate this seam if refactoring gestures; do not claim lag/FPS without a
browser measurement (`src/components/create/parts/canvas-stage.tsx:272`,
`src/components/create/canvas/commands.ts:71`,
`src/components/create/canvas/controller.ts:201`,
`src/components/create/canvas/controller.ts:604`,
`src/components/create/canvas/controller.ts:943`).

### 3. Compatibility Contracts That Must Survive Unless Explicitly Changed

#### Stored Scene And Runtime Separation

- Scene v1 contains only `schemaVersion`, four domain node kinds, typed semantic
  `edges`, `viewport`, and accepted `runBindings`. Generation parameters do not
  contain a prompt; prompt lives on a separate node. Node sizes, arbitrary layer
  ordering, selection collections, UI tool state, URL, job DTO, callbacks,
  credentials, and library state are not allowed persisted fields
  (`contracts/canvas/v1/scene.json`; `src/lib/canvas/contracts.ts:84`).
- Zod scene/node objects are strict; adding width/height/embedded prompt to saved
  nodes without a real contract transition is rejected
  (`src/lib/validators.ts:317`, `src/lib/validators.ts:341`). Shared fixture
  contracts are consumed across Node, Go Worker and database checks; a renderer
  swap is not a schema migration.
- IDs: client prompt/reference/generation IDs are UUIDs; results use
  `result:<imageId>` and fixed job/image/run provenance. Keep original IDs,
  negative/finite geometry and ordered edges on old drafts/snapshots
  (`src/lib/canvas/contracts.ts:204`; `src/lib/canvas/graph.ts:48`).
- Renderer measurements are deliberately cached/projected, not stored. Dropping
  them on controlled snapshot refresh previously caused hidden cards; maintain
  real measured semantics if React Flow stays
  (`src/components/create/canvas/renderer-adapter.ts:13`,
  `src/components/create/canvas/renderer-adapter.ts:63`,
  `.trellis/spec/frontend/canvas-studio.md:58`).

#### Ownership, Persistence And Destructive Actions

- Controller/jobs/editor lifetime stays above lazy renderer and mode switches;
  owner/feature changes dispose it, layout changes do not. Async actions carry
  explicit owner/canvas/node IDs, never a late-read current selection
  (`src/components/create/hooks/use-canvas-documents.ts:28`,
  `.trellis/spec/frontend/canvas-studio.md:38`).
- IndexedDB `narra-canvas-drafts` v1 owns drafts and separately structured-cloned
  original blobs, keyed `[ownerId,canvasId]`. Writer stamps/CAS/tombstones and
  explicit local failure states must not be replaced by naive localStorage
  snapshots (`src/components/create/canvas/draft-types.ts:8`,
  `src/components/create/canvas/draft-types.ts:25`,
  `.trellis/spec/frontend/canvas-studio.md:51`).
- Keep manual account Save separate from local autosave and account metadata.
  Save captures scene/editRevision/deletionEpoch/revision/saveId, resolves every
  original once, and confirms only the captured edit revision. Late ACK may not
  mark later edits saved; ambiguous retries retain exact identities
  (`src/components/create/canvas/controller.ts:551`).
- Removing a card/canvas removes organization, not generated works, media, a
  submitted job or billing. Originals remain protected by last saved scene and
  job roots; seven-day GC only targets eligible detached imports
  (`.trellis/spec/frontend/canvas-studio.md:98`,
  `.trellis/spec/operations/canvas-contracts.md:29`).
- Keep conversation/canvas spaces independent; no global history fallback or
  automatic copying on switch (`src/components/create/generator-studio.tsx:1188`,
  `.trellis/spec/frontend/state-management.md:85`).

#### Generation And Editing Safety

- Run requires one prompt and up to 16 distinct canonical reference/result
  inputs, ordered by ordinal; input ownership/readiness is validated. Text runs
  produce up to 4 images; image-to-image is one output. Limits also include 200
  scene nodes, 400 edges, 512KiB scene, 8MiB imported image
  (`contracts/canvas/v1/limits.json`; `src/lib/canvas/graph.ts:30`,
  `src/lib/canvas/graph.ts:132`).
- Connecting/editing/viewing/moving must not create billable jobs. Keep manual
  run, frozen input capture, durable outbox, same-run transport retry, read-only
  recovery, shared studio poller and reserved output capacity
  (`src/components/create/canvas/run-commands.ts:66`,
  `src/components/create/canvas/run-commands.ts:97`,
  `src/components/create/canvas/run-commands.ts:131`).
- Replacement is atomic validation/publication, not disconnect then connect;
  preserve edge identity and reference order on rejection
  (`src/components/create/canvas/commands.ts:110`,
  `src/components/create/canvas/controller.ts:920`).
- Results materialize exactly once, preserve older output placement, and keep
  `outputsHandled` with the terminal batch. Undo or group commands must not
  roll back accepted runs/outbox/materialization flags or resurrect deleted
  organization inadvertently (`src/components/create/canvas/commands.ts:160`).
- Preserve separate runtime-only node credentials/CAPTCHA leases and captured
  original preview/viewer/download lifetimes
  (`src/components/create/canvas/studio-bridge.ts:18`,
  `.trellis/spec/frontend/canvas-studio.md:56`).
- IME edits synchronously reach domain; external value forwarding must not
  replace focused composition. Pending raw fields survive panel/node/mode
  changes, validate/apply before Run/Save, and never pretend to be durable. An
  explicit empty custom size cannot fall back to accepted `auto`
  (`src/components/create/parts/canvas-node-inspector.tsx:44`,
  `.trellis/spec/frontend/canvas-studio.md:67`).
- Permission is capability/owner/readiness/deletion, not media width. Editor
  scrolling/browser accessibility pinch is distinct from scene pan/pinch.
  Short viewport changes must not replace focused DOM
  (`src/components/create/hooks/use-studio-mode.ts:35`,
  `.trellis/spec/frontend/canvas-studio.md:73`).

### 4. Refactor Seams And Scope Trade-Offs

**Lower-risk interaction-first refactor:** keep controlled React Flow 12.12.0
and scene v1, redesign gestures/card chrome/selection toolbar/context entry
points, consolidate editor UI, make insertion spatial and context-aware, and
add captured controller convenience commands. A single user-facing creation
action can internally create prompt + generation + semantic edges, without
requiring the user to hand-wire the first image. Image-context 'use as reference'
or 'create variation' can similarly create/link a target through existing graph
semantics. This is a proposal, not an inferred user approval.

**Image-first presentation with unchanged backend:** keep domain prompt and
generation nodes for compatibility but expose consolidated compose/edit UI.
If nodes are hidden/merged in the new renderer, define projected positions,
fit/selection/deletion/provenance/source-reuse behavior and a way to inspect old
graphs; simply hiding nodes can make previous layouts unmanageable. Existing
source UUIDs and Run projection still need to survive. Decide whether the user
still wants visible connected workflow nodes before taking this path.

**Wider changes needing explicit scope:** multi-select/group drag requires a
renderer-local collection plus atomic group domain edits (controller currently
owns one `selectedNodeId`, `src/components/create/canvas/controller-types.ts:35`).
Undo/redo needs an owner/canvas-scoped domain-edit history that excludes
network/persistence/job state; arbitrary snapshot rollback is unsafe. Persisted
image resizing/layering or replacing the domain graph with freeform objects
requires a versioned shared contract/migration decision, not just a new library.
An account-wide works/reference library requires discovery/insertion APIs,
whereas existing reuse only discovers sources on the current canvas. Changing
manual cloud Save to background account autosave is also a product/data
consistency decision, not an incidental polish task.

Primary affected files if the lower-risk direction is chosen:

Minimal command seams for contextual creation/editing while retaining visible
domain nodes (proposal only, requires the user's workflow decision):

- Add an owner/controller-scoped convenience command such as
  `createGenerationGroup(canvasId, { position, promptText, sourceNodeIds })`
  returning explicit prompt/generation IDs. It internally creates ordinary v1
  prompt + generation nodes and prompt/image-input edges; old and new domain
  nodes remain individually visible/manageable. There is no need to add prompt
  to the generation schema or merge/hide old nodes.
- Do not implement this as unrelated UI calls to `addPrompt`, `addGeneration`,
  and `connect` without a transactional domain seam: those currently each publish
  a copied/validated scene. Capacity/readiness rejection partway through could
  leave an orphan prompt or half-constructed group. Extend the pure command
  layer with one composite candidate operation: compute the total node/edge
  addition against current output reservations, validate original source
  identities/readiness and the completed graph/schema, then invoke one
  `changeScene`/publish. Existing `applyCanvasEdit`/`edit` are the seam
  (`src/components/create/canvas/commands.ts:71`,
  `src/components/create/canvas/controller.ts:604`). IDs/geometry use existing
  UUID allocator and `canvasInsertionPosition`, not library state.
- A canvas-wide contextual composer can call that convenience command at a
  captured insertion point. Clicking its explicit Generate then calls the
  existing `runNode(canvasId,generationId)` after accepted field/input validation.
  Showing a composer, selecting an image, adding references, or creating the
  group alone must remain non-billable. Failure before/after submission must
  continue using the existing outbox/recovery semantics, not retry a new group
  and a new run automatically.
- For a selected existing generation, locate its prompt through the single
  `prompt-input` edge and use existing `updatePrompt`/`updateParameters`, pending
  editor fields, and `runNode`. Prompt sharing is legal: changing a shared prompt
  changes input for several generators' next manual runs. A contextual composer
  therefore needs a defined shared-prompt UX (edit existing shared source vs
  create private source and atomically replace the edge), not an accidental
  silent clone/overwrite decision. Existing `replaceConnection` preserves edge
  identity atomically (`src/components/create/canvas/controller.ts:920`).
- For selected reference/result image context, creating a new generation group
  can attach the selected same-canvas source with ordinary ordered `image-input`
  edges; existing image/job/asset IDs and provenance stay unchanged. Multiple
  selected sources, if approved later, use explicit selection order rather than
  canvas coordinates. The existing reuse path validates canonical identities;
  no works-wide discovery API is needed for same-canvas contextual reuse.
- Updating an existing generator's prompt-and-image selection as one contextual
  Apply needs an atomic batch domain operation analogous to the existing
  `replace-connection` branch, not disconnect-all then add-one-at-a-time. A
  rejection must retain the whole old prompt/input order and output reservations.
- Keep toolbar/editor/composer gesture/tool state renderer-local or in the
  existing owner/controller-scoped editor port. Context buttons capture
  `ownerId/canvasId/nodeId` (and generation/prompt/source IDs as appropriate) so
  late chooser/dialog responses cannot operate on a newly selected target.
- Existing native scene/run/owner/Save contracts and visible nodes can therefore
  be preserved while making image creation/editing primary. The costs are a
  small transactional convenience-command surface and clearly defined shared
  prompt/context behavior, not a renderer/schema transplant. Whether this is the
  primary UX, and whether graph tools remain foreground or secondary, remains a
  user-owned product decision.

| File/module | Responsibility |
| --- | --- |
| `src/components/create/parts/canvas-stage.tsx` | Viewport gestures, selection, insertion, connection/keyboard adapter, editor/context placement. |
| `src/components/create/parts/canvas-stage.module.css` | Canvas layout, card size/chrome, panels, touch/short viewport and hit areas. |
| `src/components/create/parts/canvas-toolbar.tsx` | Creation/management/camera affordances and captured file chooser. |
| `src/components/create/parts/canvas-nodes/*` | Prompt/reference/generation/result presentation, ports, image/viewer/drag semantics. |
| `src/components/create/parts/canvas-node-editor.tsx` and `canvas-node-inspector.tsx` | Consolidated input/parameter/source editing and pending-field validation. |
| `src/components/create/canvas/renderer-adapter.ts` and `renderer-types.ts` | Domain-to-renderer projection, measurements, selection and permitted UI changes. |
| `src/components/create/canvas/commands.ts` and `controller.ts` | Atomic semantic convenience/group commands if approved; leave lifecycle intact. |
| `src/components/create/canvas/editor-state.ts`, `mobile-interaction.ts` and associated hooks | Captured editor targets, draft retention, gesture cancellation and layout-only state. |
| `src/components/create/generator-studio.tsx` | Only minimal wiring; long-lived controller/jobs/leases/viewer stay here. |

### 5. Verification Entry Points And Existing Test Coverage

Existing source-backed coverage, to extend rather than replace with only new
happy-path UI tests:

- `src/tests/unit/canvas-stage.test.tsx:41`: empty New, input isolation, IME,
  Delete scoping, measurement stability, import/preview leases, ordered
  connections, immutable reruns, uncertain recovery, targeted node settings,
  apply-before-Save, captured Save, conflict/read-only/readiness.
- `src/tests/unit/canvas-node-editor.test.tsx:108`: touch selection/Edit,
  focused DOM/caret stability across layout, retained invalid drafts/empty size,
  external composition, source replacement/order, Move preview/final drop,
  captured deletion/chooser, read-only viewing and modal keyboard safety.
- `src/tests/unit/canvas-renderer-adapter.test.ts:54`: all node kinds, stable
  identities, negative geometry, renderer-only dimensions, read-only edge/node
  projection and explicit ordinals. `canvas-terminal-placement.test.ts` covers
  bounded placement without rearranging old outputs.
- `src/tests/unit/canvas-controller-connections.test.ts:15`: atomic replacement,
  duplicate/type/readiness rejection, source reuse, reservation preservation.
  `canvas-controller-documents.test.ts`, `canvas-controller-runs.test.ts`,
  `canvas-draft-store.test.ts`, `canvas-reference-runtime.test.ts` protect
  durable storage, capture/outbox, assets and owner/lifetime behavior.
- `src/tests/unit/generator-studio-canvas.test.tsx:189`: feature-off chat,
  real root/lazy integration, owner/mode/media isolation, retained drafts,
  credentials/CAPTCHA, unmounted acceptance, balance refresh, viewer/download
  lifetimes, chunk recovery and no resubmission on reload.
- `canvas-mobile-interaction.test.ts`, `canvas-mobile-viewport.test.tsx`,
  `use-canvas-editor.test.tsx`, `use-canvas-runtime-lease.test.tsx`, and
  `use-studio-jobs.test.tsx` cover the cross-layer invariants new UI must preserve.

Documented baseline commands: `pnpm lint`, `pnpm exec tsc --noEmit`,
`pnpm exec vitest run --testTimeout=30000`, `pnpm build`
(`.trellis/spec/frontend/quality-guidelines.md:35`). Follow existing safe
environment/isolated dependency/source rules before executing; this research
did not execute them. Tests/mock passes are not native interaction proof.

Native browser verification must bind to current copied/hashed production
inputs, use actual Next SSR/lazy hydration + native IndexedDB, and exercise
native pointer/keyboard/touch/IME, hit-testing and downloads. Archived scripts
are a reference, not a ready current-task harness:

- `.trellis/tasks/archive/2026-10/10-28-studio-mobile-canvas-editor/checks/prepare-mobile-fixture.mjs`
  copies source and installed packages into a temporary owned fixture.
- `checks/verify-mobile-fixture.mjs` in that same archive verifies hashes and
  installed-package links before/after build/browser.
- `checks/mobile-browser-check.mjs` and `checks/mobile-phone-browser-checks.mjs`
  drive desktop Chromium/CDP fixtures. They contain dated task/temp paths and
  cannot safely be rerun unchanged after archive
  (`.trellis/tasks/archive/2026-10/10-28-studio-mobile-canvas-editor/closure.md:48`).

Server/DB/Worker/storage verification remains separate:
`pnpm verify:canvas-contracts:db`, worker TS/Go/DB wrappers, `pnpm verify:e2e`,
and `pnpm verify:ci`. E2E runs safe infrastructure preflight before building and
tests legacy plus enabled embedded/dedicated/mismatch scenarios with fixture
object storage (`scripts/verify-e2e.mjs:272`,
`scripts/verify-e2e.mjs:287`). Do not run real DB/provider/S3 or paid generation
just to research UX; frontend-only scope still needs correct generation wire
tests without claiming those are deployed-service acceptance.

Historical mobile code-scope archive does NOT establish real-phone acceptance.
MA1-MA4 remained unchecked; iOS18+ Safari/Android12+ Chrome, native Chinese
IME/keyboard, safe areas/accessibility zoom, OS chooser/download and actual CI
were explicitly deferred
(`.trellis/tasks/archive/2026-10/10-28-studio-mobile-canvas-editor/closure.md:21`).
Preserve that distinction in the new task; new code requires new source-bound
browser evidence, not inherited historical green receipts.

## Related Specs And External References

- `.trellis/spec/frontend/canvas-studio.md`: renderer/domain boundary, captured
  jobs/save/originals/editor gestures, mobile and browser acceptance contract.
- `.trellis/spec/frontend/state-management.md`: feature-local lifecycle,
  bootstrap-only server props, no global store/history fallback.
- `.trellis/spec/frontend/quality-guidelines.md`: validation commands,
  environment safety, native measurement/IME/touch/hit-testing evidence.
- `.trellis/spec/frontend/component-guidelines.md` and
  `.trellis/spec/frontend/hook-guidelines.md`: component/hook conventions for
  future implementation context.
- `.trellis/spec/operations/canvas-contracts.md`: shared Node/Go/SQL account,
  run idempotency, import-root/GC, capability and verification boundaries.
- External reference requested by user: https://github.com/basketikun/infinite-canvas.
  Its implementation/license is intentionally researched separately; no claim
  about its behavior is made here.
- Installed direct renderer dependency is `@xyflow/react` 12.12.0, React 19.2.4,
  Next 16.2.4 (`package.json`). Current spec permits MIT core, not Pro examples.

## Caveats / Not Found

- No native browser/usability experiment was performed. Friction items are
  code-evidenced behavior plus explicitly labelled UX hypotheses, not reproduced
  bugs or performance measurements.
- The user's requested reference may motivate an image-first composer, a
  graph-first workflow with easier gestures, or a mixed model. Repository history
  confirms previous choices but cannot settle this new product decision.
- No independent proof of current production flag, deployed schema readiness,
  physical-device behavior or service health was sought.
- No account-wide source-discovery library, persisted size/z-order, undo/redo,
  multi-selection command, or combined create/connect convenience operation was
  found in the inspected canvas controller/renderer.
- Existing historical mobile scripts carry temporary paths and archived
  assumptions. They are evidence/design references, not commands to rerun blindly.
