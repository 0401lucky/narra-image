# Image-First Canvas Implementation Handoff

- Date: 2026-11-02
- Role: trellis-implement; direct implementation, no recursive dispatch.
- Approved task: `.trellis/tasks/11-02-canvas-interaction-refactor`.
- Baseline HEAD: `64dad3ca8ce30c16ef1d730c6d5382b192bab9ea`.
- Product source frozen against the copied manifest at
  `2026-11-02T06:01:46.835515+00:00`; see `source-freeze.json`.

## Delivered Product Changes

- `canvas/commands.ts` accepts atomic composite non-result node/input creation,
  using the existing combined output reservations, graph/refined scene/byte
  validation and one candidate publication. Existing scene/run fields are intact.
- `canvas/controller.ts` adds direct private-prompt+generator creation, expected
  prompt-source update/repair, staged all-or-none original import/optional target
  attachment, strict image-source connection, and optional expected old source
  fencing on replacement. No creation/import/edit operation calls Run/Save/upload.
- New `parts/canvas-generation-composer.tsx` provides native-safe prompt editing,
  shared-source context, ordered visual references, same-canvas thumbnail choice,
  replacement/remove/reorder and captured import. The repaired prompt binding is
  acknowledged before the next native event; an external source change while
  focused rejects old-source input instead of silently editing the new source.
- `canvas-node-editor.tsx` reuses this composer with the existing field registry,
  generation Run/recovery controls, parameter inspector and apply-before-Run/Save.
  Advanced connections/settings stay available. Invalid pending fields open the
  relevant Advanced section before focus/scroll rather than remaining hidden.
- New pure `canvas/composer-placement.ts` and
  `hooks/use-canvas-composer-placement.ts` position a screen-sized overlay outside
  Flow scaling and avoid shrinking the viewport. It follows accepted node/camera
  geometry and visible bounds; phone/short-height native-scrolling sheet is kept.
- New `parts/canvas-image-toolbar.tsx` places selected-image Continue/View/
  Download controls near the card, with independently retained original previews.
  Single image click selects; existing explicit preview/download APIs remain.
- `canvas-stage.tsx` wires primary direct creation and image continuation, captured
  all-or-none import, origin-aware desktop whole-card local Move preview with one
  final commit, mobile browse/explicit Move, cancellation/window cleanup, latest
  pointerup geometry and focused-card keyboard movement. Native Flow pointer
  movement is not a competing domain writer. A legal desktop drop selects its
  captured card; a below-threshold click focuses it without scrolling the page.
- Image cards/chrome/CSS are content-first; prompt/generation cards and all old
  nodes/positions remain one-to-one. Unrelated edges are quieter, ports and explicit
  order remain. Context controls remain screen-sized, inputs/touch actions retain
  native composition/scroll/pinch permissions and readable effective target sizes.
- Toolbar file inputs and reference replacement use an explicit captured chooser
  callback; cancellation/no capture never falls back to a latest selected target.

No product dependencies, shared validators/contracts, API routes, schema/SQL,
Worker, environment, production flags or deployment settings changed. No global
state/store, hidden/merged old nodes, billing/storage transplant or auto graph Run.
All 23 modified/new source/test paths and SHA-256 values are in `source-freeze.json`.

## Regression Coverage

New tests:

- `canvas-quick-creation.test.ts`: one-publication creation, private versus shared
  prompts, immutable result continuation/ordered later manual Run, source/limit/
  byte rejection, missing prompt repair and expected binding, atomic import,
  original map rejection, expected edge and readOnly/disposed-owner fences.
- `canvas-image-first-stage.test.tsx`: actual stage direct composer/manual Run,
  native rapid composition/missing-source repair/caret DOM, shared source editing,
  focused external-source replacement rejection, image selection versus explicit
  preview/continuation, local whole-image drag/final pointerup and cancellation/
  second pointer/outside/camera/readOnly recovery, chooser no-capture/cancel and
  targeted batch, thumbnail add/order/remove/duplicate replacement preservation.
- `canvas-composer-placement.test.ts`: bounded desktop/offscreen placement,
  360/390/430 short phone sheets, and sticky movement-threshold state.

Existing stage/node-editor/studio tests retain their safety/lifecycle assertions.
Only obsolete initial heading/first-creation button, explicit chooser activation
and now-nonunique thumbnail scope expectations were adapted. Explicit preview
button ARIA names remain compatible. No ownership/Run/Save/retention negative test
was removed or weakened to make checks pass.

## Verification Receipts

The isolated lane copies current source and installed dependencies, audits links,
uses SHA-verified Node v24.22.1 and cleans inherited credentials/dotenv/preloads/
proxy configuration before launch. Fixed direct package CLIs substitute for the
missing shell `pnpm`; no runtime/dependency installation was performed.

Final receipts copied under `evidence/`:

- `20261102T060154-lint-651468`: whole copied root lint PASS, 0 errors and 9
  existing warnings, 12.841s. Current owned task tools follow existing lint scope.
- `20261102T060222-types-18e353`: strict `tsc --noEmit` PASS, 3.124s.
- `20261102T060241-test-8728f2`: 14 targeted core suites, 273/273 tests PASS,
  `--testTimeout=30000 --maxWorkers=2`, 21.514s wrapper duration.
- Each final receipt reports real exit 0, no timeout, no copied input mutation,
  no snapshot modifications, isolated test environment and exact manifest path.
- Current root `git diff --check` PASS. New files are not staged; an actual
  cached/commit whitespace gate remains main's responsibility if later approved.

Retained red receipts:

- `20261102T054712-test-ded1be`: old initial heading, preview ARIA and uncaptured
  file input/now-multiple preview assumptions (8 old UX assertions); retained and
  fixed without deleting underlying safety regressions.
- `20261102T055441-lint-507283`: render-time prompt binding ref update; fixed by
  layout-effect/event ownership and focused-source fencing, not rule suppression.
- `20261102T055948-test-6ae14d`: 271/272 core tests passed, one old root studio
  first-create heading assertion; current root test now exercises direct creation.
- `20261102T055540-test-147d2e` is the earlier 122/122 targeted green checkpoint,
  not a substitute for the final 273-case current-source verdict.

Full non-DB suite, production build, independent review, fresh actual Next/native
IndexedDB/browser visual/pointer/IME fixture verification are NOT claimed by this
implementation handoff. Physical iOS/Android/OS keyboard/chooser/download, live
DB/S3/authentication/paid-provider and actual GitHub CI remain separate unperformed
evidence gates. No commits, staging, push, archive, deployment or data cleanup.

## Reviewer Focus And Lane Release

The product writer is stopped and the implementation lane is unlocked/released
for main/independent checker. Refresh only after verifying copied inputs against
the current root; keep old red/green receipts and bind any later fixes to new hashes.

Review especially native click/drag/focus arbitration, phone and short-height
overlay clipping/reachability, retained native composition during external prompt
source replacement, actual original download leases and clipboard/chooser capture.
DOM/CSS tests are not native hit-testing, OS chooser or physical-device proof.
Main owns task plan/status/spec updates and full acceptance reconciliation.
