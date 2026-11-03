# Research: Image-First Canvas Interaction Design Seams

- Query: Exact minimal command, import, prompt, drag and editor seams for the
  approved image-first/secondary-connections direction, preserving scene v1.
- Scope: Current source signatures, shared schemas/limits and local specs.
- Date: 2026-11-02 (Asia/Shanghai).
- Status: Planning-only recommendations; no implementation/tests/install/Git.
- Context size: Default injected research-file cap is 32768 bytes
  (`.codex/hooks/inject-subagent-context.py:167`; commented defaults at
  `.trellis/config.yaml:143`). `current-canvas.md` is 29872 bytes, so it needs no
  loss-prone split. Keep this report below that cap too.

## Findings

### 1. Atomic Quick Creation: Private Prompt + Generator + Ordered Inputs

Existing signatures return IDs synchronously and accept an explicit canvas:

```ts
controller.addPrompt(canvasId, position, text = ""): string;
controller.addGeneration(canvasId, position): string;
controller.importReference(canvasId, file, position): string;
controller.connect(canvasId, sourceNodeId, generationNodeId): string;
controller.runNode(canvasId, generationNodeId): Promise<string>;
```

Each add/connect currently independently copies, validates and publishes a
scene through `edit` -> `applyCanvasEdit` -> `changeScene`
(`src/components/create/canvas/controller.ts:604`,
`src/components/create/canvas/controller.ts:868`,
`src/components/create/canvas/commands.ts:71`). Chaining these as a toolbar
handler creates observable intermediate scenes and can leave partial groups
on node/edge capacity failure. Use one composite domain operation instead.

Recommended controller signature (types owned in `canvas/commands.ts` or a
small feature-local command-types module, not shared scene contracts):

```ts
type CanvasQuickGenerationInput = {
  position: CanvasPositionV1; // preferred generation-card world position
  promptText?: string;       // default blank; accepted draft, not yet runnable
  sourceNodeIds?: readonly string[]; // explicit input order
  parameters?: Partial<CanvasGenerationParametersV1>;
};
type CanvasQuickGenerationResult = {
  canvasId: string;
  promptNodeId: string;
  generationNodeId: string;
  promptEdgeId: string;
  imageEdgeIds: readonly string[];
};
controller.createQuickGeneration(
  canvasId: string, input: CanvasQuickGenerationInput,
): CanvasQuickGenerationResult; // synchronous; throws; no Run/HTTP/upload
```

Implementation design:

1. `getEntry(canvasId, true)` provides active/enabled/owner/ready/readOnly and
   document-loaded/not-deleting guards; these do not rely on viewport width
   (`src/components/create/canvas/controller.ts:98`). Copy ordered source IDs
   so caller mutation cannot reorder the operation.
2. Validate all sources against the explicit entry, not `snapshot.active`.
   Allowed kinds: reference/result only. Result must match canonical
   `image.id/image.jobId` and have URL; reference must have an available captured
   local original or READY asset+URL. Reuse the existing stricter replacement
   checks as a private controller helper rather than copying weaker
   `connect` behavior (`src/components/create/canvas/controller.ts:911`,
   `src/components/create/canvas/controller.ts:920`). This helper performs no
   upload and does not call async `references.resolve`.
3. Allocate IDs only after cheap validation; copy current accepted defaults,
   apply optional patch through `canvasGenerationParametersSchema`, and make
   a *new private prompt node* for every quick creation. Private means unique
   new node/edge identity, not a new persisted visibility/private flag.
4. Check combined growth once: 2 nodes and `1 + sourceNodeIds.length` edges
   against `reservations(entry)`. Existing output reservations include original
   pending count/preparations; unknown unhandled output count blocks additions
   (`src/components/create/canvas/controller.ts:113`,
   `src/lib/canvas/graph.ts:212`). Do not reserve outputs for an unsubmitted
   quick group: actual Run reserves its frozen effective count separately
   (`src/components/create/canvas/run-commands.ts:110`).
5. Create all nodes/edges on a copied candidate. Position generation near the
   requested point with `canvasInsertionPosition`; put prompt left of it using
   column spacing and occupied-position scan. Never move old nodes or delete
   incident edges. Image edges use ordinals 1..N; validate canonical duplicates
   including reused asset/blob/image identities through `validateCanvasGraphV1`.
6. Validate complete local scene schema, whose `validateCanvasScene` refinement
   already checks serialized scene bytes and graph validity. Schema allows an
   empty prompt to save but Run later requires trimmed length >=2. Shared scene
   limit is 512KiB; reuse this actual refined schema, not an unrefined node or
   structural object parse
   (`src/lib/validators.ts:317`, `src/lib/validators.ts:337`,
   `contracts/canvas/v1/limits.json`). Then set selected generation if desired
   *before* one `changeScene` so UI observes one coherent group/selection.
7. Publish one accepted scene/draft revision and return captured IDs. Failure
   before publication leaves nodes/edges/selection/originals/outbox untouched;
   UUID sequence consumption alone is harmless. No billable request occurs.

Recommended pure command seam: add a specific `create-generation` union variant
to `CanvasEditCommand` containing the already allocated prompt/generation/edges,
or introduce a narrow `applyCanvasCreation` candidate function. Prefer explicit
composite operations over a generic arbitrary-scene replace API, which would
make run bindings/outputsHandled too easy to overwrite. Keep final graph/schema
validation shared with the existing command pipeline.

UI opens the returned generation's existing editor target and uses the existing
manual Run. A one-click *Generate* action may create then explicitly Run, but
must keep the created group's captured IDs on submission failure: do not create
another group/new run on automatic retry. Creation should normally occur when
the user clicks New generation; typing then updates its private prompt in
domain immediately. No new pre-node draft format is needed.

Failure codes remain existing contracts: invalid kind/target ->
`CANVAS_INVALID_CONNECTION`; missing source bytes/canonical image ->
`CANVAS_INPUT_UNAVAILABLE`; repeated canonical identity ->
`CANVAS_DUPLICATE_INPUT`; >16 references/invalid size or prompt too long ->
existing limit/input errors; unknown/reserved node/edge exhaustion ->
`CANVAS_OUTPUT_CAPACITY_EXCEEDED`. Do not weaken retained reservations or
silently drop a source to make creation succeed.

### 2. Integrated Prompt Editing Without Changing Shared-Prompt Semantics

Current generation has parameters but no prompt field
(`src/lib/canvas/contracts.ts:85`, `src/lib/canvas/contracts.ts:90`). Its prompt
is exactly one incoming `prompt-input` edge; incomplete graphs with no edge
are valid drafts (`src/lib/canvas/graph.ts:73`,
`src/lib/canvas/graph.ts:137`). Several generators may use the same prompt.
Old graphs must preserve that relationship.

Recommended narrow controller helper:

```ts
controller.updateGenerationPrompt(
  canvasId: string,
  generationNodeId: string,
  input: { text: string; expectedPromptNodeId: string | null },
): { promptNodeId: string }; // throws; synchronous; no generation
```

- Composer derives connected prompt from current scene edge and writes using
  the captured generator/source ID. If `expectedPromptNodeId` is non-null,
  require the same edge source and actual prompt kind, then update *that existing
  prompt*. This preserves old shared-source semantics. Show a small 'shared by
  N generation nodes' indicator when N>1; do not secretly clone/rebind a shared
  prompt merely because input moved into a composer.
- If no prompt exists and expected ID is null, create one new private prompt
  and its edge atomically with the same growth/complete-candidate checks as
  section 1 (1 node + 1 edge), then accept the first text. This is repair on an
  explicit user edit; just selecting/opening the composer need not dirty scene.
  Empty/one-character accepted draft text remains allowed, Run still rejects
  incomplete text. New quick groups always already have a private prompt.
- If connection changed since input was captured, or expected null now has a
  source, reject rather than overwrite whichever prompt is now connected.
  A dangling edge/wrong-kind source is not ordinary 'missing prompt': graph
  validation rejects corruption, and helper must not silently repair it by
  deleting old edges. User-facing error keeps the old scene.
- Existing `CanvasPromptField` accepts a boolean callback and acknowledges only
  successful synchronous domain writes, preserving focused composition/late
  acknowledgement protection (`src/components/create/parts/canvas-prompt-field.tsx:12`).
  Reuse it with the new captured helper. For first-input repair, callbacks must
  obtain latest accepted prompt binding synchronously (ref/controller snapshot)
  before the next native input event; a stale closure that still expects null
  would reject the user's second keystroke before React rerenders.
- Preserve the textarea DOM/key by generation target, not prompt ID, across
  missing-prompt repair so the first accepted character does not replace the
  focused element/IME selection. Keep all accepted text in domain, not among
  the five raw parameter fields. Capacity rejection during repair is a rejected
  edit with a visible error; do not display unaccepted text as saved/runnable.
- Keep source picker/atomic replacement available in Advanced connections.
  No detach/shared-prompt-copy action is required for MVP; if later added, it
  must be an explicit action with atomic new-source replacement, not a silent
  edit side effect.

Exact files: `canvas/controller.ts` and `canvas/commands.ts` for the guarded
prompt-update/repair operation; `parts/canvas-node-editor.tsx` (currently shows
prompt editing only for prompt nodes at line 46) plus a new
`parts/canvas-generation-composer.tsx` for generation-side integrated prompt;
`parts/canvas-prompt-field.tsx` stays the shared native writer.

### 3. Image-Focused Chrome With All Existing Nodes/Positions Retained

`canvasFlowNodes` already projects every domain node one-to-one without changing
position, preserving renderer-only measurements
(`src/components/create/canvas/renderer-adapter.ts:13`). Retain this mapping;
do not hide prompt/generation nodes or synthesize merged coordinates.

- Reference/result images become the visually dominant part of their cards;
  minimize header/status/parameter chrome and move secondary actions to a
  selected-card toolbar/context composer. Keep prompt cards as visible notes
  and generation cards as visible compact creation cards, each at its old
  position. Old graphs remain selectable/editable/locatable from node chooser.
- Keep all semantic edges/provenance present; lower visual emphasis when
  unrelated, emphasize selected node's input/output paths, and expose ports
  in an Advanced connections affordance. Port hiding changes connectability/
  hit areas, not edge membership/order or persisted scene.
- Default reference/result surfaces select and permit whole-card drag; explicit
  toolbar View/download opens existing original viewer. Double-click to view
  may supplement a visible labelled View action; drag release must not trigger
  it. Current image surfaces are buttons that stop selection click propagation
  (`parts/canvas-nodes/reference-node.tsx:59`, `result-node.tsx:35`); simply
  enlarging them would retain the interaction mismatch.
- Use responsive renderer CSS for image aspect/size; use known result
  `actualWidth/actualHeight` at runtime if desired, with safe bounded fallback.
  Do not persist dimensions/z-order or fetch/decode every original just for card
  layout. Existing thumbnails/original leases remain intact. Bigger card CSS
  means existing position-spacing heuristics are not a new universal collision
  guarantee; preserve old coordinates instead of auto-layout.
- Maintain live measurement cache and remove only measurements for deleted IDs.
  Compact/selected-card chrome changing real size should produce a genuine
  ResizeObserver notification, not drop existing measured size on each
  snapshot (`renderer-adapter.ts:63`; `canvas-stage.tsx:272`).

Exact files: all `parts/canvas-nodes/*`, `canvas-stage.module.css`,
`renderer-adapter.ts`, `renderer-types.ts`, `renderer-constants.ts`. No changes
to shared scene schema, SQL, Worker, storage version or cloud save format.

### 4. World-Position Import And Targeted Attachment

Current stage drop correctly computes world coordinates with
`flow.screenToFlowPosition({x:event.clientX,y:event.clientY})`
(`src/components/create/parts/canvas-stage.tsx:259`). Toolbar/clipboard import
uses a chosen default position; each file is added separately, so a batch can
partially succeed and selection ends on last imported node (stage line 162).
Current original allocation validates basic size/MIME synchronously
(`canvas/controller.ts:619`; `canvas/reference-runtime.ts:35`).

Recommended atomic controller import:

```ts
type CanvasImportInput = {
  files: readonly File[];
  position: CanvasPositionV1; // captured world point
  attachToGenerationNodeId?: string; // absent => board import only
};
controller.importReferences(
  canvasId: string, input: CanvasImportInput,
): { canvasId: string; referenceNodeIds: readonly string[];
     imageEdgeIds: readonly string[] };
```

- Validate every file, finite position, combined original-account count,
  combined scene growth, optional target kind and existing reference count
  before publishing. Allocate Blob wrappers/IDs in temporary memory; build
  candidate references and optional image edges, preserving all old input edges
  and their IDs/order. Append ordinals after current maximum/valid count.
- Reserve total new nodes and attachment edges against current pending-output
  reservations. Recheck copied complete graph/strict schema/scene-byte limit.
  Add all originals to entry only after candidate validation; no preview URL,
  digest, upload, account Save or Run is started by this local import command.
- For targeted append, existing inputs can change while the OS chooser is open:
  append to the current accepted list of the *captured target*, never replace
  it. Reject on current capacity/type/target deletion. No full-scene revision
  fence is required for safe append; a scene edit elsewhere is not a reason to
  discard an explicitly targeted import. Replacement, if separately offered,
  uses captured edge identity/expected source and existing atomic replacement.
- Bulk UI reports one accepted batch or one error; it does not remove old inputs
  or quietly accept only the files that fit. Keep single-file `importReference`
  as a compatibility wrapper if existing tests/callers require it.
- Drop onto blank canvas remains import-only at exact world pointer location;
  composer 'Add references' captures its generation target and appends there.
  An image-node context action uses existing source IDs through quick creation
  or targeted connect, not file re-download/re-import.
- Freeze world position when opening a chooser. Returning after camera changes
  must not reinterpret old client coordinates using the new viewport. On actual
  drop, derive world point at the event, before async work.

Chooser safeguard: `canvas-toolbar.tsx:31` currently stores an import callback,
but `onChange` falls back to latest `onImport` if capture was cleared
(`canvas-toolbar.tsx:69`). Do not copy that fallback into targeted attachment.
Use an active captured session `{id,ownerId,canvasId,generationNodeId?,position,
controller}`; completion requires the same live session and controller owner/
enabled/ready/mutable target. Cancel/unmount/owner switch invalidates it; an
event with no capture is a no-op, never redirected to current selection.
Accepted old-canvas targeting may continue only via its captured controller;
selection changes must never redirect it to another canvas/node. If UI unmount
invalidates the chooser session, report/cancel it rather than retarget. Reference
replacement chooser needs the same requirement.

Exact files: `commands.ts` for atomic reference batch construction;
`controller.ts` for validation/original publication; `canvas-stage.tsx` for drop
conversion/target commands; `canvas-toolbar.tsx` and new composer for capture.
`reference-runtime.ts` stays the sole original/upload/preview owner.

### 5. Whole-Card Desktop Drag: Preview Then One Accepted Move

Existing desktop Flow callback translates every position change to domain
`moveNode` (`canvas-stage.tsx:272`; `renderer-adapter.ts:113`). The pure command
copies/validates whole scene every time. Existing touch Move already has the
desired preview/one-commit primitives:

```ts
beginCanvasMove(target, pointerId, client, position, viewport): Gesture | null;
previewCanvasMove(gesture, pointerId, client): Gesture | null;
finishCanvasMove(gesture, {target, position, viewport, pointerId, pointerCount}):
  CanvasPositionV1 | null;
```

`finishCanvasMove` validates captured owner/canvas/node key, same source position,
same camera, one pointer and 3px screen movement threshold
(`canvas/mobile-interaction.ts:17`, `canvas/mobile-interaction.ts:29`).
`canvasFlowNodes` already accepts renderer-local preview position
(`canvas/renderer-adapter.ts:11`). Reuse rather than add another domain drag store.

Recommended path: one custom captured pointer drag adapter, shared by desktop
whole-card drag and existing explicit touch Move. Configure Flow node native
dragging off for these pointer paths to prevent a second position writer;
intercept permitted pointer gestures at viewport capture. Preserve port
connections/background pan/pinch as separate paths.

- Desktop primary-pointer press on non-control card/image surface may begin
  tracking without requiring Edit/Move. Ignore button/input/textarea/select/link,
  contenteditable, port handle and interactive toolbar targets. Right/middle
  button/background press belongs to existing pan/browser/context behavior;
  don't accidentally start card drag.
- Separate candidate press from active drag. Under threshold, release remains
  selection click with no domain edit; after crossing threshold capture pointer,
  suppress click/view/selection side effects and project only local preview.
  Update final preview from pointerup coordinates before validating completion
  so a last coalesced movement does not drop at an older pointermove position.
- Target is the card pressed, not whichever was previously selected. Carry
  `{target, origin:"desktop"|"move", startPosition, camera, pointerId}`. At
  completion check live controller owner/feature/ready/mutable document/node,
  captured source position and camera. Desktop validity does not require
  editor `intent.mode === "move"`; touch still does.
- One accepted release invokes `moveNode` once. Cancel, second pointer,
  pointercancel/lost capture/blur/hidden/layout change, stale source position,
  owner/canvas/deletion switch discard preview. Window pointerup outside the
  allowed viewport accepted path cancels, never commits. Existing stage's
  listener/pointer cleanup logic at lines 93..118 is the reference.
- If changing selection opens/closes a composer, avoid changing viewport bounds
  during drag. A screen-overlay composer (section 6) does not shrink the Flow
  viewport. Do not open competing editor on the transient press/drag path; make
  selected UI stable and revalidate before capture if layout changed.
- Current effect cancels on `moveMode`/editor-node changes and current release
  explicitly demands Move intent (`canvas-stage.tsx:88`, `canvas-stage.tsx:228`).
  Refactor that guard by origin, not remove it. Touch browse still pans on one
  finger and pinches on two; touch node drag still requires explicit Move.
- Native Flow keyboard movement currently emits node position changes. Turning
  pointer native dragging off must not silently remove promised keyboard
  movement: handle focused-card Arrow commands through explicit controller
  movement (except text/buttons/ports/IME/readOnly), or preserve a separately
  discriminated keyboard-only adapter. Never accept all generic position
  callbacks merely to restore keyboard movement, as that reintroduces the
  uncontrolled pointer writer. Keep Delete scoped to focused viewport.

Exact files: `canvas-stage.tsx`, `renderer-adapter.ts`/`renderer-types.ts`,
`mobile-interaction.ts` (optionally rename/generalize feature-local gesture
types; preserve exported compatibility if used in tests), `renderer-constants.ts`,
and image/node-shell chrome. `controller.moveNode` need not change signature.

### 6. Screen-Sized Contextual Composer Placement And Lifecycle

Existing registry is feature-local and long-lived:

```ts
type CanvasEditorTarget = { ownerId: string; canvasId: string; nodeId: string };
editor.open(target, mode = "edit"); editor.close();
editor.readDraft(target); editor.applyPending(canvasId, nodeId?);
```

`createCanvasEditorState` owns intent and five raw parameter drafts; `close`
clears only intent/focus, not fields. Registry is memoized by owner/controller
above the lazy renderer and subscribes through `useSyncExternalStore`
(`canvas/editor-state.ts:47`, `canvas/editor-state.ts:106`,
`hooks/use-canvas-editor.ts:10`, `generator-studio.tsx:304`). Keep this lifetime.

- Use `intent.mode:"edit"` as the single existing generation-composer open
  state, rather than another independent selected-node overlay. Prompt/reference/
  result editor/view behavior can keep using the same target port; one target
  owns one editor overlay at a time. No new secret/global/canonical store.
- Parameters and Advanced inputs reuse `CanvasNodeInspector` validation/fields;
  integrated prompt uses section 2. Primary Run remains existing actions with
  `editor.applyPending(canvasId,nodeId)` before captured `controller.runNode`.
  Save continues canvas-wide pending validation. New composer cannot bypass
  raw invalid fields because Advanced is collapsed.
- Add new renderer-local placement helper/module and component. Suggested pure
  signature:

```ts
canvasComposerPlacement({
  visibleBounds, nodeScreenRect, composerSize, gap, touchPresentation,
}): { left: number; top: number; maxWidth: number; maxHeight: number };
```

  Use the selected generation's actually measured screen rect or project domain
  position+renderer measurement with Flow viewport. Clamp/fallback inside visible
  studio/visualViewport intersection. Prefer below/alongside selected card on
  desktop; fall back to anchored edge when clipped/offscreen. Touch retains
  bottom screen sheet/short-height scrolling, not a shrunken world-space form.
  Coordinates are client/screen CSS pixels, never stored scene positions.
- Overlay must be a sibling of `.viewport`, not a child of scaled Flow viewport:
  current node editor already has this structure (`canvas-stage.tsx:320`). Use
  fixed/client coordinates or a clear relative wrapper with client-to-wrapper
  conversion; do not mix client coordinates with an offset parent's coordinates.
  Portal to document body is optional and needs explicit style-variable passing;
  existing sibling overlay avoids that dependency.
- Reuse visible-region hook bounds/CSS variables for keyboard/orientation changes
  (`hooks/use-canvas-mobile-viewport.ts:16`, line 44). Bounds update UI only,
  not controller permission or scene camera. Observe measured composer/card
  size with cleanup; limit width/height and permit native scroll so it never
  disappears below keyboard or intercepts scene gestures invisibly.
- Keep stable DOM keyed by generation editor target across camera/size/prompt
  binding changes. Native textarea/input composition, caret and pending raw
  fields cannot reset because placement changes or Advanced opens. Stop
  propagation of wheel/pointer/touch inside controls but do not prevent native
  scroll/browser accessibility pinch (`canvas-node-editor.tsx:34`,
  `canvas-stage.module.css:230`).
- Close/selection/mode switch does not clear raw fields; deleting/disabling/owner
  disposal reconciles only invalid targets. Toolbar Save remains reachable
  through Close -> Save when overlay covers it; Close itself never Save/Run.
  Existing invalid-field focus can open the editor target via `reject`
  (`canvas/editor-state.ts:64`); new generation composer must respond to that
  same intent instead of rendering an unrelated hidden panel.
- Contextual reference selection/import also targets the editor intent's
  captured node, not live visual selection. A callback from an old overlay may
  not write to a new editor target.

Recommended exact files: new `canvas/composer-placement.ts` (pure geometry) and
`parts/canvas-generation-composer.tsx`; integrate in `canvas-stage.tsx`, adapt
`canvas-node-editor.tsx`/`canvas-node-inspector.tsx` and CSS. Existing
`editor-state.ts` needs no new field type to hold accepted prompt or secret
credentials. Add optional view intent (e.g. Advanced expanded) only if retaining
that presentation across remount is useful, still owner/controller-scoped and
not persisted.

## Genuine Product Decisions / Technical Defaults

The user approved image-first creation/editing with connections secondary.
The compatibility goal resolves these defaults without another product question:
keep shared existing prompt semantics, make new quick creations use new prompt
identities, show every old node/position, retain manual account Save and manual
single-node Run, keep mobile browse/explicit Move and existing original bytes.
Atomic operations, strict validation, captured chooser/owner targets, placement
math and preview-only pointer movement are engineering choices, not preferences
to ask the user to decide.

No blocking product choice is identified by these six seams if the plan states
those defaults explicitly. Adding detach-shared-prompt, image resizing persisted
to scene, undo/multiselect/group moves, mask/photo editing, account-wide asset
discovery, automatic generation/account autosave, or a hidden/merged node model
would expand scope and require a new decision; none is needed for this plan.
Final planning summary approval is still required before implementation.

## Related Specs / Caveats

- Read `.trellis/spec/frontend/canvas-studio.md`, `state-management.md`,
  `component-guidelines.md`, `hook-guidelines.md`, `quality-guidelines.md`, and
  `.trellis/spec/operations/canvas-contracts.md` during implementation/check.
- Source anchors for unprefixed filenames in this report refer to
  `src/components/create/` paths. Shared schemas are `src/lib/validators.ts`,
  graph contracts `src/lib/canvas/graph.ts`, and fixtures `contracts/canvas/v1/`.
- Proposed new signatures/files are design recommendations, not existing APIs.
  No running/browser verification or performance measurement was performed.
- Confirmed byte-validation boundary: `src/lib/validators.ts:337` refines both
  accepted scene schemas with `canvasJsonByteLength` and graph validation, so
  existing `applyCanvasEdit` does enforce the 512KiB accepted-scene limit. Reuse
  that refined schema for complete composites. The draft store independently
  bounds the entire envelope (`canvas/draft-store.ts:41`, line 145); local memory
  acceptance is not an IndexedDB commit acknowledgement, and quota/CAS failures
  must still be reported honestly after a valid accepted local edit.
- Keep original renderer source tests and add atomic failure negative controls;
  future native browser evidence must verify pointer/IME/scroll/hit behavior on
  current source, not reuse archived success receipts. Physical-phone acceptance
  remains separate from Chromium touch emulation.
