# Research: Phone Touch And Connection Editing

- Query: Which existing renderer/controller affordances need adaptation for the
  phone core creation loop, and which product decisions remain with the user?
- Scope: internal source, specs, tests and installed dependency declarations.
- Date: 2026-10-30.
- Status: historical planning evidence before final decision convergence.
  Current PRD and `mobile-final-planning-decisions-2026-10-30.md` supersede
  unapproved-alternative language below; this audit is not an executed UX test.
- Safety: read-only outside this report; no git operation, product edit, task
  activation, test/build, browser run, real dotenv read or service access.

## Findings

### 1. Files Found And Responsibility Boundaries

| File / Anchor | Current Responsibility |
| --- | --- |
| `src/components/create/hooks/use-studio-mode.ts:13` | Mounted mode preference and width-based canvas read-only flag. |
| `src/components/create/generator-studio.tsx:290` | Shared job port, independent canvas defaults, controller/runtime/viewer wiring. |
| `src/components/create/hooks/use-canvas-documents.ts:28` | Controller survives renderer switches; owner/enabled/jobs define lifetime. |
| `src/components/create/parts/canvas-stage.tsx:42` | Captured-canvas actions, selection, Flow events, insertion, inspector wiring. |
| `src/components/create/parts/canvas-stage.module.css:131` | Viewport, transformed cards, fixed-size controls and responsive inspector. |
| `src/components/create/parts/canvas-toolbar.tsx:28` | Add/import, manual account Save, metadata and camera actions. |
| `src/components/create/parts/canvas-sidebar.tsx:18` | New, canvas navigation, mobile select and paging. |
| `src/components/create/parts/canvas-node-inspector.tsx:86` | Nontransformed generation inputs, explicit ordering and parameter fields. |
| `src/components/create/parts/canvas-nodes/node-shell.tsx:21` | Header-only drag region, immediate node removal and typed ports. |
| `src/components/create/parts/canvas-nodes/prompt-node.tsx:16` | Scaled inline textarea and synchronous native input protection. |
| `src/components/create/parts/canvas-nodes/reference-node.tsx:16` | Reference preview lease, local replacement, view/download. |
| `src/components/create/parts/canvas-nodes/generation-node.tsx:15` | Explicit node Run, progress, uncertain-request recovery, settings opener. |
| `src/components/create/parts/canvas-nodes/result-node.tsx:14` | Stable result view/download and nonexecuting runtime recovery. |
| `src/components/create/canvas/renderer-adapter.ts:11` | Domain-to-Flow projection, measured dimensions and port validation. |
| `src/components/create/canvas/controller.ts:838` | Explicit canvas/node commands; ownership and durability stay here. |
| `src/components/create/canvas/commands.ts:70` | Validated pure edits, compact ordinals, capacity and terminal placement. |
| `src/lib/canvas/graph.ts:132` | Direct ready-input resolution, never graph traversal/scheduling. |

### 2. Current Phone Restriction Is More Than Presentation

- `use-studio-mode.ts:15` starts read-only for SSR safety. Its media query at
  `src/components/create/hooks/use-studio-mode.ts:30` is only
  `(min-width: 768px)`, not pointer capability or a phone-device test. Width
  changes can therefore flip permission, including a sufficiently wide phone
  in landscape. This is the current v1 policy, not a proposed mobile policy.
- The same flag feeds runtime credentials/challenge leases and the controller
  at `src/components/create/generator-studio.tsx:297`. It is updated without
  recreating the controller at
  `src/components/create/hooks/use-canvas-documents.ts:49`.
- `src/components/create/canvas/controller.ts:101` rejects mutation commands
  whenever read-only. `src/components/create/parts/canvas-stage.tsx:45` adds
  deleting-state protection. Removing hidden controls alone cannot enable the
  loop, and simply deleting the controller guard would remove useful defenses.
- Phone hides New, Rename/Delete/Save, node creation/import, inline editing,
  node/edge mutation and Run. Selection, canvas navigation, camera and image
  actions remain. See `src/components/create/parts/canvas-toolbar.tsx:45`,
  `src/components/create/parts/canvas-sidebar.tsx:22` and
  `src/components/create/parts/canvas-stage.tsx:172`.
- Camera changes currently stay runtime-only when read-only and join the local
  scene when editable (`src/components/create/canvas/controller.ts:928`). Full
  phone editing can reuse desktop local camera persistence; it must not become
  automatic cloud saving.

Design implication: separate responsive/touch presentation from whether an
initialized, enabled owner/controller may mutate. Keyboard, orientation or
pointer changes must not revoke work solely because layout changed. Preserve
safe SSR/mount behavior, disabled/not-ready/deleting guards and captured origin.

### 3. Existing Gestures And D1 Recommendation

Current behavior:

- Blank-area drag pans; pinch and wheel zoom. Zoom is bounded to 0.1-2 in
  `src/components/create/canvas/renderer-constants.ts:16`. The stage explicitly
  uses node drag threshold 3 and auto-pan on node/connection drag at
  `src/components/create/parts/canvas-stage.tsx:174`.
- Nodes use a header-only drag handle
  (`src/components/create/canvas/renderer-adapter.ts:25`). Inputs/actions carry
  `nodrag nopan nowheel nokey`
  (`src/components/create/canvas/renderer-constants.ts:19`). The viewport has
  `touch-action: none`; the prompt field declares `pan-y` and scrolling at
  `src/components/create/parts/canvas-stage.module.css:132` and
  `src/components/create/parts/canvas-stage.module.css:154`. These declarations
  are not proof of native phone scroll/gesture arbitration.
- Cards are 18rem wide; ports are 0.7rem, ordinary icon controls 1.9rem, and
  ordered-input icons only 1.35rem wide. All card controls shrink with zoom
  (`src/components/create/parts/canvas-stage.module.css:125`,
  `src/components/create/parts/canvas-stage.module.css:146`,
  `src/components/create/parts/canvas-stage.module.css:157`,
  `src/components/create/parts/canvas-stage.module.css:194`). Enabling the
  desktop UI on narrow screens alone is not a touch-safe editing design.
- Generation parameters already live outside Flow's transform. Only selected
  generation nodes open that inspector
  (`src/components/create/parts/canvas-stage.tsx:74`). Mobile CSS currently
  makes it a right overlay, not a bottom sheet
  (`src/components/create/parts/canvas-stage.module.css:248`).

Recommended D1 candidate: tap/select a node, then use a nontransformed
selected-node bottom sheet for prompt/reference/generation editing; retain the
canvas for overview and explicit node movement. Separate node movement from
blank-space pan and sheet scrolling. This reuses the mounted controller and
existing inspector boundary rather than introducing another scene/store.
Trade-off: more selection/open/close steps than inline editing, but readable
controls and text independent of graph zoom. Scaled inline editing remains a
possible user choice, with substantially more zoom/hit-target/IME validation.

Constraints that the final D1 design must address:

1. Selection is not an edit-open intent. Flow selects on drag by default;
   stage selection also comes from keyboard/events. Opening a sheet on every
   `selectedNodeId` update could interrupt dragging. Distinguish explicit tap
   or edit action from drag selection, and define how to enter/leave movement.
2. Image-view/action clicks can bubble to stage node selection
   (`src/components/create/parts/canvas-stage.tsx:158`,
   `src/components/create/parts/canvas-nodes/reference-node.tsx:42`). One tap
   must not open both a sheet and viewer or trigger a destructive/Run action.
3. Do not reuse `readOnly=true` merely to make mobile cards noneditable previews;
   it also removes ports/actions and blocks controller/runtime work. Presentation
   needs its own distinction from actual capability.
4. Prompt input currently commits accepted text synchronously per native event
   (`src/components/create/parts/canvas-nodes/prompt-node.tsx:18`). A sheet must
   preserve this rather than buffer until compositionend or close.
5. Inspector `CommitField` keeps unfinished/invalid parameter drafts in component
   state and commits on blur, Enter or Save shortcut
   (`src/components/create/parts/canvas-node-inspector.tsx:46`). Re-keying or
   unmounting it on orientation/keyboard changes can lose that draft. Define
   focus/validation/close behavior and use stable owner/canvas/node identity.
6. Explicit node/source context must survive asynchronous file picking, Save,
   runtime dialogs and Run. Do not bind results to the latest selected node.
7. Existing insertion can place new generation nodes beside the last prompt,
   outside a phone viewport (`src/components/create/parts/canvas-stage.tsx:76`).
   Terminal results are placed to the generation's right
   (`src/components/create/canvas/commands.ts:169`). Provide deliberate focus or
   result navigation; do not move every user's camera when background jobs finish.

### 4. Connection Editing And D2

Reusable facts:

- Inspector already provides select-source then explicit Connect controls,
  prompt disconnect, reference disconnect and up/down ordinal controls at
  `src/components/create/parts/canvas-node-inspector.tsx:74` and
  `src/components/create/parts/canvas-node-inspector.tsx:100`.
- The Flow surface supports drag or click/tap source-port then target-port
  via `connectOnClick`, with typed port checks
  (`src/components/create/parts/canvas-stage.tsx:160`). Existing tiny handles,
  offscreen targets and scale make this a poor *sole* phone path.
- `controller.connect(canvasId, source, target)` is sufficient for a picker;
  use `disconnect(canvasId, edgeId)` and
  `reorderInputs(canvasId, targetNodeId, orderedSourceIds)` for modification
  (`src/components/create/canvas/controller.ts:911`). No new execution API is
  required for these interactions.
- One prompt may feed multiple generators, but each target accepts at most one
  prompt. Each target accepts 0-16 ordered references/results. Identity duplicates
  at a target are rejected even when source nodes differ. Ordinal, not position
  or DOM order, controls input order (`src/lib/canvas/graph.ts:30`).
- A generation node is not an image input. A fixed completed result can feed
  its originating generator for another manual run; there is no general DAG ban
  (`src/lib/canvas/graph.ts:131`). Missing inputs block Run, not trigger upstream
  execution. Result connections require hydrated matching job identity
  (`src/components/create/canvas/controller.ts:914`).
- Connection-time structural validity is not the same as Run readiness. Local
  originals can be connected before their upload; Save/Run resolves them.
  Missing assets/results must remain visibly unavailable, not silently replaced
  or dropped (`src/lib/canvas/graph.ts:149`).
- User edge endpoint reconnection is currently disabled. Existing UI edits by
  disconnect/reconnect, not `onReconnect`
  (`src/components/create/canvas/renderer-adapter.ts:68`). Output-provenance
  edges are not selectable/deletable inputs; a new picker must not expose these
  as ordinary removable/reconnectable edges.

Recommended D2 candidate: reuse explicit target-node input selection in the
unscaled sheet, with identifiable source labels/previews/status, visible order,
large reorder/disconnect controls and typed validation. On-canvas port gestures
can remain a secondary shortcut only if the user includes them. This avoids
requiring two simultaneously visible endpoints or precision touching.

User-owned distinction: if "replace connection" means one atomic Change Source
action, existing `disconnect` then `connect` can lose the old input if the new
connection is rejected. Either retain today's two explicit actions or design a
validated atomic scene edit that preserves the old edge on failure. Do not
silently add destructive partial replacement to a picker. Reordering existing
inputs already preserves node identities and uses the validated command.

### 5. References, Results And D4 Scope

- Local file selection is already first-class, with multiple import and single
  replacement inputs constrained by `CANVAS_IMPORT_IMAGE_TYPES`
  (`src/components/create/parts/canvas-toolbar.tsx:58`,
  `src/components/create/parts/canvas-nodes/reference-node.tsx:56`). Desktop
  drop/paste exist but must not be required for phones.
- `importReference` creates a local original; `replaceReference` keeps the node
  and its connections while changing its source identity
  (`src/components/create/canvas/controller.ts:880`). Picking a file is not
  account saving or generation. A missing original supports explicit replacement.
- Current-scene reuse has two meanings: connect the same existing reference or
  result to another target; or clone a reference card using `reuseReference`.
  The latter only reads a reference node from the same canvas and is not exposed
  by the current renderer (`src/components/create/canvas/controller.ts:892`).
  It does not create another upload identity. A duplicate canonical input at one
  target remains forbidden, not deduplicated silently.
- Existing account-saved refs restored on the phone can be selected for Run
  without reuploading unchanged originals; reference Save/Run identity remains
  owned by the current runtime/controller, not by any new sheet.
- Account-wide library reuse is a separate scope choice. There is an owned
  paginated works GET (`src/app/api/me/works/route.ts:5`), but no imported-assets
  discovery GET (`src/app/api/me/canvas-assets/route.ts:4` only exports POST) and
  no current canvas command to insert arbitrary existing works/assets by ID.
  Such a library would need discovery/selection/state and canonical insertion
  contracts; the works side may reuse an existing API rather than invent one.
  Do not equate same-canvas reuse with full account-library support or silently
  choose either interpretation of the user's "reuse" requirement.
- Viewer and download actions already carry explicit canvas/node and canonical
  image identities; previews are leased independently from cards
  (`src/components/create/parts/canvas-nodes/reference-node.tsx:24`,
  `src/components/create/canvas/renderer-types.ts:20`). Keep these paths, including
  originals, when a sheet or selected card closes/disappears.
- New/select/manual account Save are needed for a self-contained core loop.
  Rename/delete/reload, custom-provider advanced fields and reference-card
  duplication already have varying levels of support; whether all receive
  phone controls remains D4, not automatic desktop parity. Do not add undo,
  multi-select, auto-layout, lasso, graph scheduling or account-library discovery
  merely because mobile editing is enabled.

### 6. Manual Run And Save Must Reuse Existing Authority

- Sheet Run should call `runNode(canvasId, nodeId)` exactly as the node button
  does. The controller captures scene/origin before asynchronous work and
  reserves capacity (`src/components/create/canvas/run-commands.ts:97`). UI
  disabling is feedback, not the sole duplicate-run defense.
- Uncertain acceptance keeps its original run ID/inputs and only offers explicit
  transport retry or read-only lookup. Do not reinterpret panel close, mode
  switch, return from background or orientation as Run/retry
  (`src/components/create/canvas/run-commands.ts:131`).
- `saveCanvas` captures scene/edit revision and all reference originals before
  uploads, then acknowledges only that snapshot
  (`src/components/create/canvas/controller.ts:551`). A sheet's Done/close action
  must not silently become account Save. Local draft ACK and account Save status
  already have separate labels in
  `src/components/create/canvas/renderer-constants.ts:28`.
- Removing a node changes scene/incident edges/bindings only; it does not cancel
  jobs, delete works or refund (`src/lib/canvas/graph.ts:203`). A mobile destructive
  affordance must retain that semantics and avoid accidental activation while
  entering move mode. Node deletion currently has no extra confirmation, whereas
  canvas deletion uses a confirmation dialog; any changed confirmation/undo UX
  is a product decision rather than a backend prerequisite.

### 7. Decision Inventory And Suggested Test Additions

| Decision | Repository Answers | Still User-Owned |
| --- | --- | --- |
| D1 | Existing untransformed inspector, header drag and controller are reusable; width currently changes permission. | Sheet vs inline editing; tap/open/move separation; sheet close/draft behavior. |
| D2 | Picker/disconnect/reorder work without new generation API; endpoint reconnect is absent. | Primary picker vs mandatory direct ports; explicit disconnect/reconnect vs atomic source replacement. |
| D3 | V1 evidence is read-only phone emulation, not physical phone editing. | OS/browser/version/minimum viewport/representative graph and required real-device evidence. |
| D4 | Current-canvas reuse is supported, account library insertion/discovery is not complete. | Reuse extent, metadata/advanced actions and phone-specific additions beyond the core. |

Existing tests provide reusable assertion patterns, not a new run this turn:

- `src/tests/unit/canvas-stage.test.tsx:64`: native prompt/selection/key/wheel
  isolation; extend to the new untransformed input rather than dropping it.
- `src/tests/unit/canvas-stage.test.tsx:308`: local import/replace, no upload on
  import and preview lease cleanup; add chooser cancellation and captured target.
- `src/tests/unit/canvas-stage.test.tsx:338`: picker/reorder/disconnect without
  generation; extend for touch-sized source identification and any approved
  replacement behavior, including rejection preserving the graph.
- `src/tests/unit/canvas-stage.test.tsx:377`: real Flow clicked typed-port
  success/failure; keep desktop coverage if ports become optional on phones.
- `src/tests/unit/canvas-stage.test.tsx:488`: focused parameter validation before
  keyboard Save; add sheet Close/Done/Run/manual Save while editing and composing.
- `src/tests/unit/canvas-stage.test.tsx:632`,
  `src/tests/unit/generator-studio-canvas.test.tsx:249` and
  `src/tests/unit/canvas-controller-documents.test.ts:474`: v1 phone read-only
  assertions must be deliberately revised for approved mobile capability, while
  preserving genuine read-only/disabled/loading defenses and phone chat creation.
- `src/tests/unit/use-canvas-runtime-lease.test.tsx:114`: capability changes abort
  waiting leases. Add layout changes that do NOT change capability or abort the
  active node's work, plus existing real owner/disabled/unmount cancellation.
- `src/tests/unit/canvas-controller-runs.test.ts:41`: frozen original/input order
  through asynchronous upload; combine with phone panel/node/canvas switches.
- `src/tests/unit/generator-studio-canvas.test.tsx:507`: viewer lease survives
  card removal; preserve against sheet unmount, preview replacement and downloads.

Required browser additions after implementation approval: touch tap vs drag vs
pinch; second finger arriving during a gesture; scrollable sheet/input vs canvas
pan; hit targets at the approved zooms; no sheet opening during a move or two
overlays opening from one image tap; offscreen source selection; explicit result
navigation; orientation/keyboard preserving drafts/focus; phone Save then a
separate desktop profile restore; no extra Save/Run on layout changes. Real
renderer/native IndexedDB tests and actual target-device/IME checks need separate
receipts. Native file picker and image download behavior require real device
evidence, not only `fireEvent.change` and mocked link clicks.

### 8. External References And Version Constraint

- Application pin: `package.json:41`, `@xyflow/react` 12.12.0 MIT core. No
  dependency change, Pro example or replacement editor is proposed here.
- Installed package declarations at
  `node_modules/@xyflow/react/dist/esm/types/component-props.d.ts:390` document
  select-on-drag default true. At line 394 they state mouse-button `panOnDrag`
  arrays do not disable touch panning. At line 532 they document tap-to-connect;
  at line 598 they expose connection radius. These are static API evidence, not
  a touch-compatibility result. No external website was accessed for this audit.

## Related Specs

- `.trellis/spec/frontend/canvas-studio.md`: controller/renderer ownership,
  input/measurement, captured save/run and existing read-only contract.
- `.trellis/spec/frontend/component-guidelines.md`: named exports, Chinese
  accessible controls, container boundaries and established appearance.
- `.trellis/spec/frontend/state-management.md`: mounted owners, initialization,
  no global store, scoped conversation preservation.
- `.trellis/spec/frontend/hook-guidelines.md`: input/layout listeners and lease
  cleanup must respect component lifetime.
- `.trellis/spec/frontend/quality-guidelines.md`: actual verification gates and
  isolated fixture limitations.
- `.trellis/spec/operations/canvas-contracts.md`: ready input, ownership, storage,
  manual generation, retained works and no implicit release authorization.

## Caveats / Not Found

- The current product is intentionally desktop-first; this audit identifies
  adaptation work, not regressions against the previously approved v1 scope.
- Archived parent AC1-AC17 and canvas CA1-CA13 remain predecessor evidence only.
  `handoff.md` in each archived task expressly leaves physical phones and native
  IME untested. Their phone checks cannot satisfy this task's MA1-MA4.
- No test/build, real browser, physical phone, native IME, service or actual CI
  verification was performed by this research. No performance claim is made.
- Recommendations cannot settle supported devices, acceptance risk, precise
  gestures or reference-library scope. The main session must ask the remaining
  D1-D4 decisions and obtain fresh final planning approval before implementation.
