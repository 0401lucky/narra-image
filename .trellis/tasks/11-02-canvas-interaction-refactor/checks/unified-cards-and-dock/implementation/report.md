# Revision 2 Implementation Handoff

## Status

Implementation complete and product/test edits stopped on 2026-11-04. Baseline
was `2bb57b5`; the only pre-existing edits were main-owned task plans. No backend,
contracts, dependencies, provider execution, controller persistence, deployment,
staging, commit or push changes were made. Main's concurrent task/harness changes
were preserved. `handoff-source.json` records the 23 owned source/test/notice
paths and their SHA256 identities.

## Delivered Behavior

- Creation view folds prompt-source cards/internal prompt edges without changing
  canonical scene v1. Advanced graph restores all old nodes, standalone/shared
  prompts and connections; lookup/selection/Locate use canonical identities.
- Generation card previews prompt/reference/settings instead of connection
  boilerplate. Selecting/creating opens one screen-sized editor at that card's
  anchor; the original preview is inert and visually replaced while editing.
  Model and size are compact; provider/quality/connections are native disclosures.
- The existing native-safe prompt writer, captured binding repair, input chooser,
  raw parameter registry and apply-before-Run/Save are reused. Shared edits stay
  shared and are labelled. Explicit removal remains non-cascading.
- A floating bottom dock replaces permanent creation/selection rows, with real
  select/hand modes, creation/import, graph toggle and selected-node actions.
  A separate camera dock and compact lookup retain zoom/fit and old-node access;
  document actions stay in the quiet header.
- Phone Browse/Move and native-scroll editor remain distinct. Placement reserves
  the measured dock/camera region. Reference actions fit one desktop row; phone
  reference rows keep 44px action targets and native scrolling.
- Native browser feedback found same-selected generation clicks did not reopen a
  manually closed editor. Both ordinary click and below-threshold captured
  pointer release now explicitly reopen it, without Run/Save or source mutation.

## Changed Files

Renderer/placement: `canvas/renderer-adapter.ts`, `renderer-types.ts`,
`composer-placement.ts`, `hooks/use-canvas-composer-placement.ts`.

UI: `parts/canvas-dock.tsx` (new), `canvas-generation-settings.tsx` (new),
`canvas-toolbar.tsx`, `canvas-stage.tsx`, `canvas-stage.module.css`,
`canvas-generation-composer.tsx`, `canvas-node-editor.tsx`,
`canvas-node-inspector.tsx`, `canvas-nodes/generation-node.tsx`,
`node-shell.tsx`, `reference-node.tsx`, `result-node.tsx`.

Tests: `canvas-unified-view.test.tsx` (new), `canvas-renderer-adapter.test.ts`,
`canvas-composer-placement.test.ts`, `canvas-image-first-stage.test.tsx`,
`canvas-node-editor.test.tsx`, `canvas-stage.test.tsx`.
Compatibility tests explicitly open the full graph/native advanced disclosures;
source/owner/Save/Run/IME/lease assertions are retained, not removed.

License: `THIRD_PARTY_NOTICES.md` adds the full upstream MIT notice, source
commit and adapted toolbar/prompt-layout files. No upstream provider/store/AntD
or unrelated tool suite was imported.

## Executed Checks

All commands run through main's revision-2 credential-isolated wrapper and copied
runtime `checks/.runtime/rev2-check-31e25c3e/app`, pinned Node 24.22.1. No actual
dotenv or network services were used. Receipts/stdout/stderr are copied here.

| Gate | Receipt | Result |
| --- | --- | --- |
| Targeted Vitest (6 suites) | `20261104T070331-test-450d96` | PASS, 109/109 |
| Root ESLint | `20261104T070415-lint-a044b7` | PASS, 0 errors / 9 pre-existing warnings |
| Strict TypeScript | `20261104T070504-types-3e4b3d` | PASS |
| Owned/source whitespace | `git diff --check` | PASS |

The earlier 68/70 and 107/109 runs remain as red receipts. Failures were obsolete
full-graph assumptions/query ambiguity; tests now identify the actual owning
node/editor and enter graph view explicitly. Native-discovered reopen behavior
received its own regression rather than an assertion workaround.

Main separately ran native/browser fixture checks. Its second run
`browser/evidence/native-1793775643330/` reports 14/14 PASS on matching product
source, including the repaired same-card reopen, zero accidental requests,
Custom-size Run/Save blocking, native pan, desktop/mobile input, old graphs and
exact original bytes. Implementer inspected the before/after desktop continuation
screenshots to confirm the thumbnail actions no longer wrap to two rows.

## Review And Follow-Up Boundaries

Independent check, full non-DB suite and actual application production build are
main/checker responsibilities and were not claimed as implementer passes. Main
owns spec/task updates. Review should emphasize folded-node measurement/selection,
editor lifetime across view modes, pan versus movement, readOnly and delayed
reference capture. Physical iOS/Android, OS IME/chooser/download, live services,
paid generation and actual CI remain unperformed. No automatic archive or
delivery permission is inferred.
