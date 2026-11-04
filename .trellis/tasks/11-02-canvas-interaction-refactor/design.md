# Canvas Interaction Refactor Design

## Active Revision 2 Approved Design

Status: revision 2 approved on 2026-11-04; see
`checks/unified-cards-and-dock/approval.md` and the active section of `prd.md`.
The remaining sections record revision 1. This proposal replaces only the
default projection, primary editor presentation and toolbar layout; it does not
authorize changing durable scene or execution contracts.

### Presentation And Identity

Keep React Flow, canonical scene v1, the existing controller and the owner-scoped
editor registry. Add a renderer-local creation/graph view choice. In creation
view, omit prompt-source cards and prompt-input edges from the rendered set;
derive each generator's prompt text/source/shared count from the canonical graph.
In graph view, render the full original graph. Reference/result IDs and output
provenance stay intact in both views. Do not persist view flags or copied prompt
text in nodes, rewrite source IDs or remove canonical nodes to simplify the UI.

Centralize the projection and visible-target resolution so node lookup, selection,
Locate, fit, measurement caching, deletion and editor placement agree. Selecting
a standalone prompt via lookup opens graph view before locating/editing it.
Returning to creation view maps an actively selected prompt to an attached
generation when unambiguous; otherwise close only its visible editor/selection,
retaining text and raw registry drafts. Do not create a synthetic domain node.
Keep measurements for live canonical IDs even when a node is temporarily folded;
reconcile genuine remeasurement without dirtying the scene.

Creation-card movement/removal continues targeting the generation ID. A folded
prompt keeps its own stored coordinate and survives generator removal; graph
view remains the explicit place to organize/remove source notes. Do not turn a
visual merge into implicit grouped movement, cascading cleanup or job cancellation.

### One Creation Surface

Refactor the current generation card/composer/editor so prompt, thumbnail inputs,
compact model/size and Generate form one primary surface, not a summary card
plus a duplicate settings form. The inactive card previews its content; selecting
or creating opens an attached editor at the same card, not the old side-inspector
layout. Suppress duplicate primary controls while that editor is active.

Reuse `CanvasPromptField` and `controller.updateGenerationPrompt` with captured
expected source and immediate repaired-binding acknowledgement. Reuse the current
parameter CommitField/registry and applyPending pipeline; extract shared UI only
as needed, never create parallel validation or save/run state. Show shared-source
effects before editing. Provider controls and advanced connections remain behind
explicit secondary affordances and retain current captured targets.

Keep one editor target/DOM subtree and adapt its placement with existing
screen-space measurement hooks. Editing controls remain readable across scene
zoom; the dock, graph-view toggle and short mobile layout must not remount a
focused textarea. Mobile uses the existing native-scroll sheet behavior, with
safe-area/keyboard bounds and explicit Move separate from Browse. Do not replace
native textarea with upstream contentEditable/reference-token machinery.

### Dock And Camera

Separate document header, creation dock and camera controls. Dock lives in
screen-space within the canvas workspace and does not consume another permanent
row. Keep existing document navigation. Node lookup and graph-only creation
actions move into a reachable compact control/popover rather than disappearing.
Panels open away from the dock with pointer and keyboard-safe dismissal.

Use transient select/pan state on desktop: select retains click selection and
whole-card drag; hand mode pans the scene instead of moving cards. Preserve
native field/control exclusions and existing phone Browse/Move behavior. Tool
switch cancels uncommitted movement, never applies an unfinished gesture. All
buttons have Chinese accessible names, visible focus and meaningful pressed/
disabled states; do not imply unsupported marquee selection or canvas undo.

Fit considers visible cards. Keep existing zoom bounds and controlled viewport
writer; merely opening editor/dock or changing view/tool does not change camera.
Small screens may consolidate camera controls into the dock's secondary panel
to avoid overlap without removing reachable controls.

### Reuse, Validation And Boundaries

Reference source is pinned in `research/unified-cards-and-dock.md`. Adapt its dock
grouping, tool affordances and prompt/settings hierarchy into existing Narra
components/CSS. Substantial source reuse requires an upstream MIT notice and a
clear source-file/commit record; no dependency/provider/store transplant.

Affected seams are `renderer-adapter.ts`, `renderer-types.ts`, generation node,
composer/editor/inspector, toolbar/stage/picker, placement hooks/styles and their
tests. Runtime, schema, SQL, Worker, billing and media storage remain untouched.
No new limits/timeouts or graph history are required. The old full graph view is
a compatibility/diagnostic surface, not a second persistence implementation.

## Revision 1 Design Record (Historical Below)

## Status

The user approved the complete final design/execution plan on 2026-11-02;
see `checks/implementation-approval-2026-11-02.md`. Implementation and scoped
verification are authorized. GitHub `main` delivery was separately approved on
2026-11-03, including preservation of newer remote commits; deployment remains
out of scope. Read
`prd.md` for requirements and acceptance criteria. Research reports contain
source anchors and pinned upstream evidence.

## Architecture Decision

Retain controlled React Flow 12.12.0, the existing canvas controller/editor,
scene v1, original runtime and studio job port. Refactor interaction and UI
boundaries; do not transplant upstream DOM renderer, Zustand/localforage store,
provider execution, batch image metadata or document format.

```text
Explicit UI action + captured owner/canvas/node/world position
  -> narrow guarded controller command
  -> one copied, validated domain scene edit
  -> native local draft scheduling
  -> one-to-one renderer projection + renderer-local gesture/placement

Explicit Generate
  -> existing editor.applyPending(captured canvas, generation)
  -> existing runNode -> frozen outbox -> existing authenticated pipeline
  -> existing shared job port -> immutable terminal result materialization

Explicit Save
  -> apply all pending fields of captured canvas
  -> existing captured snapshot/original upload/CAS/ACK path
```

No presentation state, measurements, URLs, credentials or job DTOs enter scene.
The long-lived owner/controller/editor/jobs stay above lazy CanvasStage and mode
switches. Permission is never inferred from viewport width or pointer type.

## Primary Interaction Model

### Direct Creation

An empty New stays empty. The primary New image/creation action prepares a
connected private prompt plus generation card in one accepted edit, selects
the captured generation, and opens its composer. It does not Run or cloud Save.
Prompt text immediately enters domain through the native-safe prompt writer.
Only the composer's explicit Generate starts the existing run pipeline.

Selected images show a small screen-sized contextual toolbar. Continue creating
prepares a new private prompt/generator with the selected live same-canvas image
as an ordered input, then opens the new target's composer. Use accepted canvas
defaults, not another node's secret configuration or conversation credentials.
Keep the source image. New results retain the existing distinct result identity
and adjacent placement; never overwrite an old result to imitate upstream.

### Image And Workflow Presentation

Keep every domain node one-to-one at its existing coordinate. Reference/results
are image-dominant with quieter labels/status; prompt nodes remain visible
notes, and generation nodes compact creation cards. Use safe runtime image
dimensions/aspect ratios and bounded fallbacks, without persisted resize or
decoding/fetching all originals for layout. Bound card geometry to the existing
insertion clearance where practical; preserve old positions even when layouts
overlap. Do not promise arbitrary-size collision-free packing.

Unrelated edges become visually quieter; selected input/output paths and ordinal
information remain discoverable. Keep direct ports and old source controls in
secondary Connections/workflow affordances. Node chooser/Locate can still find
all old prompts, generators, imported sources and results. No merged projection,
hidden old nodes, migration, extra view format or automatic graph rearrangement.

Single image click selects. Whole image/card is a desktop drag surface except
controls. Visible View and Download use existing captured original APIs;
double-click may supplement View, but is not the only accessible preview path.
Keep existing document New/select/rename/delete/Save navigation. Settings no
longer occupy a permanent selection-dependent column that shrinks the viewport.

### Composer And References

Use the existing editor intent as the only active editor/composer target. A
generation composer contains its connected prompt, identifiable ordered
reference thumbnails, compact model/size controls, explicit Generate and
Advanced settings/connections. Reuse current parameter fields/normalizers and
raw-field registry; do not create a second parameter validation implementation.
Collapsing Advanced never hides invalid pending fields from Run/Save validation.

Thumbnail picker lists current-canvas references and canonical completed results
with preview, status and meaningful identity; unavailable choices are disabled
and remain controller-validated. Add, replace, remove and up/down ordering use
explicit semantic edges/ordinals, not geometric order. Existing prompt-source
selection/replacement is available in Advanced connections. Rejected operations
keep accepted input thumbnails/order; do not optimistically disconnect first.

## Narrow Domain Command Contracts

These are feature-local command types, not shared schema additions. Exact names
may follow local conventions; preserve the behavior and atomic boundaries.

```ts
type CanvasQuickGenerationInput = {
  position: CanvasPositionV1;
  placementBounds?: CanvasInsertionBounds;
  promptText?: string;
  sourceNodeIds?: readonly string[];
  parameters?: Partial<CanvasGenerationParametersV1>;
};
type CanvasQuickGenerationResult = {
  canvasId: string;
  promptNodeId: string;
  generationNodeId: string;
  promptEdgeId: string;
  imageEdgeIds: readonly string[];
};
controller.createQuickGeneration(canvasId, input): CanvasQuickGenerationResult;

controller.updateGenerationPrompt(canvasId, generationNodeId, {
  text,
  expectedPromptNodeId,
}): { promptNodeId: string };

controller.importReferences(canvasId, {
  files,
  position,
  placementBounds?,
  attachToGenerationNodeId?,
}): { canvasId: string; referenceNodeIds: readonly string[];
      imageEdgeIds: readonly string[] };
```

### Atomic Creation

Use `getEntry(canvasId, true)` and the existing reservation/complete graph/schema
checks. Validate copied ordered sources against the captured entry, including
live canonical result provenance, local-original/READY imported availability,
duplicate identities and 16-input maximum. Reuse stricter existing replacement
source checks via a common private helper; do not weaken legacy Run validation.

Allocate private prompt, generator and edge UUIDs. Normalize parameters using
existing defaults/schema. Check total growth (2 nodes, 1+N edges) against pending
and unknown output reservations, then build one complete candidate. Use shared
`canvasInsertionPosition` around the captured generation anchor and left-side
prompt position without moving old nodes. Validate the refined local scene
schema, including graph and serialized-byte limits. Publish selection/scene
coherently once and return captured IDs. Failure leaves scene, selection,
originals, outbox and reservations unchanged; consumed unused UUIDs are harmless.

Extend the pure command layer with specific composite creation/prompt-repair/
reference-batch variants or narrow equivalent helpers. Do not expose arbitrary
scene replacement or roll back accepted runs through snapshot history.

### Prompt Binding And Shared Sources

Generation has no embedded prompt. Derive its incoming prompt edge, then update
the captured existing source only if it matches `expectedPromptNodeId`. Several
generators may share that source: preserve sharing, show the shared count, and
do not silently clone/rebind. Future runs consume later edits; already frozen
runs do not change.

For a valid draft with no prompt edge and expected null, an explicit first text
edit creates one private prompt+edge atomically. Merely opening/selecting does
not repair or dirty the graph. Reject changed/dangling/wrong-kind bindings rather
than overwriting a new source. Keep textarea keyed by generation target, not
prompt ID. Update the accepted binding synchronously before the next native
input event so first-input repair does not reject subsequent keystrokes. Reuse
`CanvasPromptField`'s immediate accepted-domain/local-value acknowledgment and
focused-composition guards. Empty short text is a valid draft; Run still enforces
the existing runnable prompt constraint.

### Batch Import And Captured Choosers

Keep existing single-file import as a compatibility wrapper where needed.
Validate all files/MIME/size, finite world anchor, original count, target kind,
reference limit and combined node/edge growth before publication. Stage originals
in temporary memory, build all reference nodes/optional appended edges, and
validate the complete graph/refined schema before adding originals to the entry
and publishing once. No partial accepted files, preview side effects, upload,
cloud Save or Run. Preserve all existing input edges/IDs; new ordinals append.

Native verification exposed an unbounded occupied-column displacement after the
initial visible preferred-point fix. Primary actions now pass optional captured
`CanvasInsertionBounds={minX,maxX,minY,maxY}` through the controller's final shared
insertion helper. It searches nearby visible columns using the unchanged legacy
scan; when the entire visible region is occupied, finite overlap is preferable
to moving new primary content offscreen. Old positions/camera remain intact.
Manual graph insertion, explicit spatial drop and terminal placement still use
the unbounded path. This is a scoped correction within the original no-relayout,
no-packing-guarantee design, not a document/permission/Run behavior change.

Blank-canvas drop remains board import at its captured world point. Toolbar or
paste uses a captured visible anchor; composer Add references captures its
generation target. Camera changes while OS chooser is open do not reinterpret
old screen coordinates. Existing-source reuse never reimports/downloads bytes.

Chooser state is an explicit session including controller/owner/canvas/optional
generation/position identity. No-capture, cancel, unmount or owner/controller
invalidation produces no operation. Never fall back to the latest onImport or
current selection. A surviving session may operate only on its original live
target, using current capacity and accepted input list. Target deletion rejects.
Source replacement captures edge identity and expected old source; a changed
edge/source cannot be silently overwritten by a late picker completion.

## Pointer, Keyboard And Camera Boundaries

Reuse/generalize the existing pure Move primitives and renderer-local position
preview; keep one pointer-position writer. Disable native Flow pointer dragging
for the custom whole-card path rather than committing generic position callbacks.

- A primary desktop pointer on a non-control card starts a captured candidate
  for that pressed node, not a previously selected node. Inputs/buttons/links,
  editable content, ports and contextual controls opt out.
- Below-threshold release selects with no scene move. Threshold-crossing drag
  captures the pointer, projects local preview (RAF where useful), and suppresses
  accidental click/preview/editor actions. Do not shrink/rebuild viewport during
  the gesture.
- Refresh final preview from pointerup coordinates. Validate live owner/canvas/
  node, mutability, one pointer, unchanged source position and camera. One legal
  completion calls `moveNode` once. Cancel/second pointer/lost capture/blur/hidden/
  layout or identity change/outside-window completion discards preview.
- Guard completion by origin: desktop drag does not require editor Move intent;
  phone touch still uses explicit Move, with browse pan/pinch separate. Pointer
  type/layout chooses presentation/gesture path, never authority. No global
  removal of current touch cancellation checks.
- Preserve focused-node keyboard movement through an explicit keyboard-only
  adapter if disabling native dragging would otherwise remove it. Do not accept
  arbitrary Flow position changes to restore keyboard movement. IME/text/control
  events do not move/delete/run; Delete remains viewport-scoped, Ctrl/Cmd+S still
  applies pending fields before captured Save, and prompt Enter remains newline.
- Retain background pan, cursor-anchored wheel/pinch zoom and explicit zoom/fit/
  Locate controls. Selection/opening/background results do not seize camera.

## Screen-Space Placement And Responsive Lifetime

Create a small pure placement helper and focused overlay component. Input is
visible studio/visualViewport bounds, selected node's actual measured screen
rect, composer dimensions and gap; output is bounded CSS-pixel position/size.
Prefer below/alongside the creation card on desktop, falling back to a reachable
edge placement when clipped/offscreen. Phone uses bottom sheet with safe-area
and short-height native scroll. Never change scene camera to place controls.

Overlay is outside the Flow gesture tree and does not reserve/shrink viewport
columns. Use one stable DOM tree/target key across resize, orientation and
keyboard states; placement changes CSS only. Preserve focus/caret/composition,
registry raw fields and editor apply-before-Run/Save. Scrolling/editor ancestors
allow `pan-y pinch-zoom`; only scene viewport uses `touch-action:none`. Controls
opt out of drag/pan/wheel/shortcuts without cancelling native text/scroll defaults.
Keep >=16px unscaled inputs and >=44px effective phone action targets.

Retain renderer-only live measurement cache when snapshots update. Real card
size changes may notify ResizeObserver; unchanged snapshots must not discard
measured dimensions or fake new resize notifications. Use current Chinese
cream/orange tokens/typography and restrained transitions; no per-frame DOM
replacement or animated drag coordinate lag.

## Module Boundaries

- `canvas/commands.ts` and `controller.ts`: narrow composite edits, captured
  command guards, shared source validation and staged original publication.
- `canvas/renderer-types.ts`, `renderer-adapter.ts`, `renderer-constants.ts`:
  actions and one-to-one projection, quiet edges/ports, measurements/preview.
- `canvas/mobile-interaction.ts` or a small shared gesture module plus stage
  adapter: pure captured gesture math and origin-aware cleanup/keyboard path.
- `parts/canvas-stage.tsx`: wiring/insertion/camera/selection, not a second store.
  Extract growing gesture/placement logic into feature-local hooks/helpers.
- `parts/canvas-generation-composer.tsx`, contextual toolbar/reference picker and
  placement helper: focused UI pieces using existing editor/actions.
- `canvas-node-editor.tsx`/`canvas-node-inspector.tsx`/`canvas-prompt-field.tsx`:
  reuse native-safe text and parameter fields, advanced connections/settings.
- `canvas-nodes/*`, `canvas-toolbar.tsx`, `canvas-stage.module.css`: content-first
  chrome, primary creation entry, captured import and responsive placement.
- `generator-studio.tsx`: only minimal port wiring if needed; keep long-lived
  jobs/controller/editor/credentials/viewer/download owners unchanged.

## Compatibility, Risk And Rollback

No schema/API/SQL/Worker/environment/dependency migration is planned. Old saved
documents, node IDs, negative finite coordinates, edges/run bindings and drafts
round-trip unchanged. Manual cloud Save, frozen run identity, failure recovery,
capacity reservations, original roots and organization-only deletion remain.

Main risks are atomic original/scene publication, shared/missing prompt input,
dual pointer writers, clipped/focus-disrupting overlays and lost measurements.
Tests require rejection/cancellation and native browser negatives, not only
happy-path screenshot or settled text. Code/browser snapshots must match exactly.

If a required UX turns out to need document migration, hidden/merged nodes,
automatic cloud/billing behavior or new tool suites, return to planning rather
than expanding scope during implementation. Rollback is the task-owned frontend
patch only; retain user drafts and canonical job/media state. Do not use
destructive Git rollback, revert foreign edits, force-save or erase work.

Prefer original local implementation from reference behavior. If substantial
MIT code is copied, retain upstream copyright/license notices explicitly.
Production enablement/deployment and live paid/device/service verification are
not part of this design approval.
