# Unified Creation Cards And Bottom Dock Research

## Source And Scope

Inspected 2026-11-04 for the user's two screenshots and request to combine prompt
and generation cards. Narra baseline HEAD is
`2bb57b5` with a clean worktree before planning edits. Local reference is
`E:/code/infinite-canvas`, commit
`0d2676b268d3872a9d380489291d0f0a13f476e1`.
Reference root `LICENSE:1` is MIT, copyright 2026 basketikun; its license notice
must accompany copied/substantial portions. Neither reference nor product code
was edited during this research. This is source inspection, not browser evidence.

## Reference Patterns Worth Adapting

- `web/src/components/canvas/canvas-toolbar.tsx:94`: screen-space bottom dock,
  horizontal grouped actions, pointer-events isolated from the stage, hover
  labels and explicit active pan/select tool. Native supported actions include
  media creation/upload, focus and selected deletion; additional tools depend
  on upstream services/state and are not automatically in Narra scope.
- `web/src/components/canvas/canvas-zoom-controls.tsx:26`: compact separate
  lower-corner zoom/fit control. Upstream fixed widths/offsets are desktop-biased;
  adapt responsive geometry, not its literal 300px dock inset or zoom limits.
- `web/src/components/canvas/canvas-node-prompt-panel.tsx:91`: prompt and
  reference content above a compact model/settings/generate row. This hierarchy
  is the useful reuse target, not its provider store or metadata schema.
- `web/src/components/canvas/canvas-config-node-panel.tsx:90`: compact input
  chips, inline model/parameter controls and one prominent Generate action.
  The reference still supports standalone text/config nodes; it does not prove
  that a pure visual merge requires changing Narra's persisted node model.
- `web/src/components/canvas/canvas-node.tsx:452`: selected editor is attached
  below the node and inverse-scaled so controls remain readable. Its fixed
  600px panel is not a mobile implementation to copy unchanged.
- `web/src/pages/canvas/project.tsx:237`: tool state is local pan/select state;
  toolbar creation routes into actual node creation at `:3407`. Avoid importing
  the page orchestrator or unrelated group/history/plugin/provider machinery.

## Current Narra Seams

- `src/components/create/canvas/renderer-adapter.ts:15` maps every domain node
  one-to-one; generation data only includes prompt presence, not its text.
  A renderer-only folded projection can derive source text/shared count without
  changing scene v1 or the existing execution projection.
- `src/components/create/parts/canvas-nodes/generation-node.tsx:26` repeats
  model, size and connection-summary content. Primary prompt lives elsewhere.
- `src/components/create/parts/canvas-generation-composer.tsx:24` already owns
  captured-source editing, repair acknowledgement, shared-source warning and
  thumbnail/reference chooser logic. Reuse rather than duplicate this behavior.
- `src/components/create/parts/canvas-node-inspector.tsx:44` owns native-safe
  raw parameter fields. `canvas-node-editor.tsx:55` currently renders composer,
  generation summary and inspector together, causing redundant vertical UI.
- `src/components/create/parts/canvas-toolbar.tsx:63` and
  `src/components/create/parts/canvas-stage.tsx:230` put creation/camera and
  selection in permanent upper rows. Move these actions into dock/compact lookup,
  preserving captured chooser sessions and document save/navigation.
- `src/components/create/parts/canvas-stage.tsx:248` owns captured whole-card
  desktop moves; `:365` configures Flow pan. A hand tool must arbitrate these
  writers rather than merely swap a cursor or icon.
- `src/components/create/canvas/controller.ts:963` and `:973` expose existing
  per-node move/remove semantics. Do not treat folded display as permission to
  cascade deletion, move source coordinates or cancel jobs.
- `src/tests/unit/canvas-renderer-adapter.test.ts:54` deliberately asserts all
  four node kinds. Preserve that assertion for full graph view and add separate
  folded-view tests rather than weakening canonical compatibility coverage.

## Approval Boundary

Revision 1 deliberately forbids hidden/merged projection. The new user request
changes that product boundary and requires a fresh final-plan approval. Proposed
revision 2 folds prompt cards only in default presentation, exposes them through
Advanced graph, preserves native inputs and backend contracts, and adapts the
bottom dock to Narra's supported features. No implementation is authorized by
this source report or the user's request to continue research alone.
