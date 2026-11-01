# Research: Product Decision Inventory

- Query: Which product decisions must be resolved before designing a dual-mode
  image studio?
- Scope: mixed; product reasoning informed by the user's request and repository
  constraints, not an approved implementation design
- Date: 2026-10-28

## Confirmed Intent

The user approved task creation and research. They want to remove the image
history experience from the creation studio, retain the conversation experience,
and add a button-switchable infinite-canvas experience. They have not approved
implementation. After the research summary on 2026-10-28, they confirmed that
prompt/reference/result node connections belong in the first version. They then
selected independent conversation/canvas spaces to simplify new-canvas creation
and avoid mixed content, then adopted actual prompt/reference input bindings
through connections. They selected individually triggered generation for the
first version rather than one-click whole-workflow execution. After the
server-burden discussion, they accepted account-backed saving in response to the
local-autosave/manual-account-save proposal. They then approved presentation-only
studio history removal and canvas/node deletion that preserves generated images
in the separate works page, accepting that this does not free generated-image
storage. They also approved saving imported reference originals with an explicit
account snapshot before any generation, accepting additional reference storage
and reuse of unchanged uploaded files on later saves. They approved new/select/
rename/delete canvas management without duplication, and deletion that does not
automatically cancel/refund submitted generation. Normal generation results still
remain in works; existing cancellation/lifecycle refund rules stay separate.
They approved desktop core editing and read-only phone canvas selection/view/
pan/zoom, preserving phone conversation creation. They explicitly requested a
later task for full phone canvas editing; `studio-mobile-canvas-editor` now tracks
it independently without being started. They accepted seven-day cleanup grace
for newly owned unused imports, protecting saved-canvas/job-used inputs and never
cleaning generated/legacy media. Old unsynced drafts may need a replacement
upload. No deployed-server spare capacity was established by this discussion.

## Canvas Is Not Necessarily A Workflow Graph

| Direction | User activity | Main benefit | Added scope |
| --- | --- | --- | --- |
| Spatial creative board | Place, compare, select, and reuse images on a pan/zoom surface; generate from a shared composer or contextual action | Freer visual exploration without changing the generation model | Positions, selection, viewport, result placement, reference selection |
| Connected creative nodes | Relate prompts/reference images to generated results with visible nodes and links | Makes variation branches and generation provenance visible | Node/edge semantics, input validation, card editors, reference ownership |
| Automated workflow graph | Connect executable steps and run an entire graph | Repeatable multi-step processing | Scheduling, dependency execution, partial failure, cancellation, retries, and potentially new provider operations |

These are product alternatives, not three features implicitly included in the
phrase "infinite canvas." A node UI does not require automatic graph execution.

## Resolved Decisions

- First-version canvas model: connected creative nodes, not a placement-only
  board. This is the user's selection, overriding the earlier spatial-first
  recommendation. It does not by itself authorize graph-wide execution.
- Workspace relationship: independent conversation and canvas spaces, with
  separate creation content and a canvas-specific new/select experience. This
  overrides the earlier shared-content recommendation. A new canvas must not
  inherit conversation/global-history/other-canvas content automatically.
- Connection meaning: actual input bindings. Connected prompt/reference content
  is used by the target generation node, not merely shown as a source/lineage
  annotation.
- Execution scope: explicit manual run per generation node. First-version
  graph-wide execution and automatic upstream/downstream runs are excluded.
- Saving guarantee: local draft autosave plus explicit manual account snapshots.
  Other devices restore the last successfully saved account version, not newer
  local edits. This follows the proposal immediately preceding the user's
  account-saving acceptance; background cloud autosave is not selected. Local
  drafts remain vulnerable to browser clearing/eviction, and account-save success
  requires server acknowledgement.
- History/deletion boundary: remove studio desktop/mobile history presentation,
  not generated media. Deleting a canvas/node removes organization/associations,
  while canonical generation jobs/images remain and works still lists the
  generated images. The user accepted that removing a canvas does not
  automatically release its generated-image storage. Imported-reference cleanup
  was subsequently selected separately, as recorded below.
- Reference-save scope: an explicit account save includes unsubmitted imported
  originals, allowing another device to continue the full saved canvas without
  re-uploading them. Unchanged already-persisted references are reused on later
  saves. The user accepted the extra retained-file storage; later cleanup after
  reference/canvas removal follows the separately selected seven-day policy.
- Canvas lifecycle: new/select/rename/delete in the first version, with canvas
  duplication deferred. Deleting a canvas/node does not automatically cancel an
  already-submitted job or itself cause a refund. Successful results remain in
  works; separate supported cancellation and ordinary lifecycle refunds continue
  under the existing contracts. Deletion must not resurrect a removed canvas/node
  when a late response arrives.
- First-version editor/mobile scope: desktop pan/zoom/drag, node editing and
  connections, reference upload/reuse, manual generation, and image view/download.
  Phone canvas selection/view/pan/zoom is read-only initially, while phone
  conversation creation remains usable.
- Mobile follow-up: full phone canvas editing/connections/reference inputs/
  manual generation is explicitly tracked, not omitted. The independent task
  `.trellis/tasks/10-28-studio-mobile-canvas-editor/prd.md` depends on the verified
  first-version canvas foundation and is deferred/inactive. It does not block
  the current first release.

- Reference cleanup: retain saved-canvas/submitted-job input references. Newly
  owned unused canvas imports receive seven days of grace before cleanup;
  generated works and unregistered legacy media are excluded. The user accepted
  that old unsynced local drafts may need re-upload if their unused cloud file
  has been cleaned.

## Product Decision Status

All currently identified user-owned first-version decisions are resolved.
Source-backed API/schema/upload/idempotency, local-draft/conflict, and managed
bounded cleanup contracts are now documented in the frontend/backend research
and converged parent/canvas-child designs. Technical review/context validation
and a subsequent explicit approval of the latest final summary remain required.

## Next Planning Steps

1. Verify converged artifacts, technical contracts, curated contexts and the
   explicit history-before-canvas child dependency.
2. Present the latest final planning review and wait for fresh implementation
   approval; keep the independent mobile editor deferred.

Only one highest-value question should be asked in each user-facing turn. Code-
answerable questions must be resolved through research instead.

## Integration Principles To Pressure-Test

These are engineering proposals, not approved product requirements:

- Keep authenticated image generation, billing, worker execution, and polling as
  the single business pipeline; do not adopt an example application's BYOK or
  browser-direct provider pipeline.
- Reuse generation infrastructure but isolate workspace content, selected IDs,
  and drafts. Sharing services does not mean projecting the same jobs into both
  spaces. Canvas jobs need explicit canvas ownership rather than an implicit
  conversation/global-history fallback.
- Keep generation and polling ownership above the mode-switch boundary so a view
  unmount does not interrupt or duplicate jobs.
- Bind responses and layout updates to the intended conversation or canvas,
  including results arriving after a mode/project switch.
- Resolve a generation's connected inputs into a validated request snapshot;
  later draft/graph edits must not rewrite the persisted inputs of an existing
  job. Actual input bindings do not imply automatic regeneration on every edit.
- Remove history-specific UI without removing handlers or initial data that are
  also used by the conversation experience.
- Do not automatically feed orphan/cross-conversation images into either main
  view; the existing active-conversation scoping contract remains relevant.
- Retain the current cream/orange visual tokens, card language, and Chinese UI
  rather than importing a reference application's unrelated design system.
- Keep toolbars/composer outside the transformed canvas surface. Explicitly
  test input focus, scrolling, drag targets, touch behavior, and keyboard access.

## Evidence And Related Specs

- User decisions, 2026-10-28: this session; task/research consent and the resolved
  model, workspace, input, execution, saving, reference-save scope, and
  media-preservation/lifecycle/editor/mobile selections and explicit follow-up.
  No final implementation approval had been given at that original planning
  checkpoint. The history and canvas children later received separate approvals
  and are verified/archived; their handoffs preserve the execution chronology.
- Parent closeout, 2026-10-30: after recovery of session
  `01a18ab5-eb61-7153-9194-2a7950cd2ae4`, main presented the final integration
  summary. The user explicitly approved it in the next message. Only the
  existing parent was activated for narrow SQL seam regressions, full-scope
  acceptance and eventual `--no-commit` archival; mobile remains deferred.
- `.trellis/spec/frontend/state-management.md`: container-owned shared state,
  hydration guards, and active-conversation scoping.
- `.trellis/spec/frontend/component-guidelines.md`: feature container/parts/hooks
  split, Chinese UI labels, accessibility, and lazy loading.
- `src/app/globals.css`: existing cream/orange surface and accent variables.
- `current-studio.md`, `canvas-library-comparison.md`, and
  `ai-canvas-references.md`: separately persisted topic-specific evidence.
- `recommendation.md`: consolidated findings and the proposed small-first
  direction; recommendations remain subject to the user's product decisions.
- `canvas-persistence-costs.md`: source-backed server/browser work split,
  incremental media costs, saving contracts and illustrative rate calculations;
  no deployed capacity was measured.
- `canvas-reference-retention.md`: new scoped source evidence for reference
  ownership, job-input retention, missing object-cleanup infrastructure, and the
  proposed grace-period/local-draft trade-off.

## Caveats / Not Found

- This document does not settle product preferences on the user's behalf.
- Detailed source-file anchors and external licensing evidence belong to the
  respective research reports, not to speculative product requirements.
- `trellis mem` was unavailable in the original planning shell, so that research
  did not claim recovered dialogue. For the 2026-10-30 continuation, the named
  local Codex JSONL session was read directly and reconciled with task artifacts;
  no command installation or remote history retrieval was needed.
