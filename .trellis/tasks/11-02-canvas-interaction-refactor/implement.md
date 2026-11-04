# Canvas Interaction Refactor Implementation Plan

## Active Revision 2 Plan And Approval Gate

Revision 2 implements the unified creation-card/bottom-dock proposal at the top
of `prd.md` and `design.md`. The user approved this revision on 2026-11-04 in a
subsequent reply to its final summary. The checked items and prior delivery
approval in the historical record below apply only to revision 1.

- [x] Inspect current source and the user's local MIT reference without editing
  either product codebase; record exact source anchors and upstream commit.
- [x] Write revision 2 requirements, design, execution order and real context.
- [x] Present the revision 2 final summary and obtain a subsequent explicit
  approval; record it before restoring task status to in_progress via task.py.

### Completion Status

- [x] Implement folded/complete views and coherent captured-target selection.
- [x] Compose one attached editor with native prompt, references and settings.
- [x] Deliver responsive floating dock and genuine desktop select/pan.
- [x] Retain MIT source notices and preserve all canonical/runtime contracts.
- [x] Independent full-scope review fixes outer ghost-wrapper interaction,
  low-image toolbar/dock overlap and stale mounted-studio test assumptions.
- [x] Fresh lint/types, 144 files / 1824 non-DB tests, copied Prisma generation
  and actual application production build pass. Final native matrix passes
  15/15 against the reviewed source with desktop/mobile screenshots inspected.
- [x] Update executable canvas/quality specs and interaction retrospective.
- [x] Obtain separate commit approval; the user also explicitly requests an
  ordinary push to GitHub main and tracking the resulting Actions run.

Exact receipts and boundaries are in `verification.md` and
`checks/unified-cards-and-dock/`. Historical failed runs remain preserved;
physical/live and automatic archive stay unperformed. Actual Actions monitoring
is authorized for delivery, distinct from the earlier local-only evidence.

### Dispatch And Ownership

After approval, main dispatches one `trellis-implement`, then an independent
`trellis-check`, each prompt beginning:
`Active task: .trellis/tasks/11-02-canvas-interaction-refactor`.
Read JSONL context, current PRD, design and this plan in that order, following
native injection when available and explicit child-side loading otherwise.
Clearly state that revision 2, not revision 1's completed checklist, is active.

Implementer owns the scoped renderer/component/hook/CSS/tests named by the
revision 2 design, plus an upstream notice if substantial code is adapted.
Checker may self-fix scoped issues and record new evidence under
`checks/unified-cards-and-dock/`. Main owns task/spec changes and communication.
Agents are not alone: preserve others' edits, report conflicts and never revert
foreign work. Do not edit `E:/code/infinite-canvas`, stage/commit/push, deploy,
read actual secrets/dotenv, run paid/live services or alter unrelated tasks.

### Ordered Execution

1. Record clean/dirty baseline and current hashes. Read canvas/component/hook/
   state/type/quality specs and guides before writing code. Add projection
   tests for private/shared/standalone/missing-prompt scenes and both views.
2. Implement folded creation-view projection and unified target resolution;
   retain canonical IDs, independent source positions and all full-graph tools.
   Test view switching, selecting a folded source, measured remounts, fit,
   explicit removal semantics and no mutation from presentation changes.
3. Recompose generation card/editor into one attached creation surface. Reuse
   captured prompt/chooser logic and raw-field validation; remove redundant
   generation summary sections. Test shared-source/repair, pending invalid
   fields, IME, explicit Run and retained drafts.
4. Move creation/selection/camera controls into responsive screen-space docks
   with a quiet document header; preserve navigation, save and all supported
   actions. Add real desktop hand/select behavior without changing phone
   Browse/Move. Test cancellation, focus, readOnly and keyboard behavior.
5. Integrate projection/editor/dock geometry, native reference flows, image
   continuation and safe-area/mobile/short viewport presentation. Record which
   upstream sections were reused and retain MIT notice when required.
6. Stop implementer edits and hand off complete revision 2 scope to independent
   `trellis-check`. Main reconciles UAC1-UAC5, updates specs only for verified
   behavior and reports remaining evidence boundaries. No new commit/push is
   authorized by the earlier revision's delivery approval.

### Fresh Validation

Use the existing credential-isolated current-source test/build/browser harness
patterns with refreshed source manifests and new revision-specific receipts.
Do not reuse historical passing receipts as proof. Serialize heavy commands:

```text
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vitest run --testTimeout=30000 --maxWorkers=2
pnpm build
git diff --check
```

Cover real controller/component flows and native browser pointer/keyboard
interactions: first create is one card, shared/standalone old graph preservation,
graph toggling, one editor, low/high zoom, dock hand/select and creation/import,
zero accidental Run, explicit Generate, Save/reload, original/result retention,
deletion, pending fields and IME. Inspect desktop and 360/390/430px plus short/
landscape screenshots with reachable controls. Keep OS/physical devices,
live services, paid generation and actual CI explicitly unperformed unless
separately authorized. No baseline limits, schema or production flags change.

## Revision 1 Implementation Record (Historical Below)

## Status And Transition Gate

The user approved the latest complete final planning summary on 2026-11-02;
see `checks/implementation-approval-2026-11-02.md`. Task activation and the scoped
implementation/check work are authorized. Material scope changes still require
returning to planning and a fresh review. GitHub `main` delivery was separately
approved on 2026-11-03; deployment and automatic archive remain out of scope.

Implementation and integrated-source local gates now pass (143 files/1812 tests
and 10 rebuilt native fixture cases). The final independent full-scope review
completed and fixed one selected-image toolbar late-mount/removal seam. Main's
source-unchanged two-worker application build retry passes after the retained
default 15-worker native OOM. See `verification.md`, `checks/delivery/` and
`checks/delivery-independent/`; earlier service failures remain historical.

The 2026-11-03 continuation preserves the three newer remote commits and
fast-forwards the base to `e42ff7a` before restoring this refactor. A fresh
independent full-scope check and rebuilt native fixture now target that
integrated source; earlier receipts remain historical evidence. Delivery
records live under `checks/delivery/` and `checks/delivery-independent/`.

One task is appropriate: quick creation, composer, references, selection and
movement form one integrated loop with shared controller/editor contracts.
Splitting independently released children would add coordination without
independent product acceptance. Implement sequentially and review independently.

## Before Start

- [x] Research current workflow and pinned reference implementation/license.
- [x] Obtain image-first/secondary-connections direction approval.
- [x] Converge requirements and preserve all source anchors/constraints.
- [x] Write `design.md` and this execution plan.
- [x] Curate real spec/research entries in both context manifests.
- [x] Present complete final planning summary and obtain fresh approval.
- [x] Record that approval, check current Git status and task path, then run
  `python .trellis/scripts/task.py start .trellis/tasks/11-02-canvas-interaction-refactor`.

## Ownership And Dispatch

Main owns planning, approval, task state, integration decisions, spec updates,
verification summary and user communication. Main does not broadly implement
inline in this auto sub-agent workflow.

Dispatch one `trellis-implement`, then one independent `trellis-check`, each
prompt beginning `Active task: .trellis/tasks/11-02-canvas-interaction-refactor`.
Prefer native Codex context injection. If saved hook output is referenced, read
it; if injection is absent/unreadable, load the supplied task path and the role's
JSONL spec/research files explicitly. Never infer another session's task.
Implementer reads PRD/design/plan and relevant `trellis-before-dev` guidelines.

Implementer owns only relevant files under:

- `src/components/create/canvas/`: composite commands, guards, renderer/actions,
  captured gesture and placement helpers; preserve lifecycle/storage/run code.
- `src/components/create/parts/canvas-*` and `parts/canvas-nodes/`: primary
  creation, contextual composer/toolbar/picker, cards, import and responsive CSS.
- `src/components/create/hooks/`: small gesture/placement/editor hooks if needed.
- `src/components/create/generator-studio.tsx`: minimal port wiring only.
- `src/tests/unit/`: corresponding canvas/studio tests and helper fixtures.
- This task's `checks/implementation/`: implementation notes/targeted receipts.

Checker may self-fix scoped product/test issues and write this task's
`checks/` evidence. Main owns PRD/design/plan and `.trellis/spec/` updates;
checker reports needed changes rather than silently changing approved scope.

Tell both agents they are not alone in the codebase: preserve others' changes,
do not revert foreign edits, and report unexpected outside-scope changes/conflicts.
No worker commits, stages, pushes, archives, deploys, reads real dotenv/secrets,
runs paid/live services or edits other tasks.

## Ordered Implementation

### 1. Capture Baseline And Test Seams

- [x] Record current HEAD/status and task-owned versus unrelated changes before
  edits. Current planning baseline is clean `main` except this task directory;
  recheck rather than assuming it remains so.
- [x] Search all affected types/actions/fields/callers before modifying them.
  Read actual schemas, existing fixtures and affected guidelines.
- [x] Establish credential-isolated test/build execution and current-source
  manifests; do not run dated archived harnesses unchanged.
- [x] Add focused behavior regressions for composite creation/prompt/import and
  captured gesture/chooser boundaries; preserve old contract-negative tests.

### 2. Atomic Direct Creation And Prompt Editing

- [x] Add narrow private-prompt+generation+optional-sources composite operation
  with one complete candidate validation/publication and returned captured IDs.
- [x] Reuse capacity reservations, canonical source/readiness checks, UUIDs,
  defaults/parameter schema, insertion helper and refined scene/byte validation.
- [x] Add captured expected-prompt update/missing-prompt repair. Preserve old
  shared sources and textarea identity; synchronize newly accepted binding
  before the next native input event.
- [x] Prove failures leave old scene, selection, original map/outbox/reservations
  intact and no operation implicitly runs/saves/uploads.

### 3. Batch Import And Targeted References

- [x] Add staged all-or-none reference batch import, optional append to captured
  generator, current input ordinal preservation and compatibility single import.
- [x] Replace chooser latest-callback fallback with explicit captured sessions;
  handle cancellation, unmount, owner/controller/target deletion and late events.
- [x] Keep actual world drop anchors and freeze chooser/paste anchors before
  camera changes. Same-canvas existing-image reuse uses source IDs, not reimport.
- [x] Keep atomic source replacement and explicit input ordering; validate
  expected old source for delayed replacement selection.

### 4. Contextual Composer And Visual References

- [x] Add direct primary creation and image Continue creating actions that open
  the existing captured editor without submitting. Generate remains explicit.
- [x] Integrate connected prompt, shared-source indicator and thumbnail inputs
  in a focused generation composer. Reuse native prompt writer, existing raw
  fields/settings and apply-before-Run/Save, including collapsed invalid fields.
- [x] Put advanced connections/settings behind secondary controls without
  removing old prompt selection/ports/input order or stored nodes.
- [x] Add screen-space placement with bounded desktop fallback and stable
  phone/short-height sheet, outside Flow gesture/scale and without viewport shrink.
- [x] Keep one editor intent/target, focused DOM/caret/IME, pending drafts,
  native scroll/pinch and safe-area/touch sizes across layout/mode changes.

### 5. Image-First Cards And Captured Movement

- [x] Make image content dominant, workflow cards compact and unrelated edges
  quiet. Keep every old node/coordinate/measurement and manageable connection.
- [x] Make single image click selection, visible preview/download explicit,
  whole desktop card/image the drag surface except controls/ports.
- [x] Reuse pure Move math with origin-aware renderer-local preview and one
  committed release. Disable competing native pointer writes; retain focused
  keyboard movement separately.
- [x] Preserve mobile browse versus explicit Move, camera/source/pointer guards,
  final pointerup coordinates, window cleanup, cancellation and next-drag recovery.
- [x] Retain pan/zoom/Locate, Chinese cream/orange visual system, permissions,
  preview/view/download leases, immutable results and long-lived studio owners.

### 6. Integration And Independent Review

- [x] Run focused component/controller suites after each seam; update only
  obsolete UX assertions, never remove safety/billing/ownership regressions.
- [x] Report changed files/receipts and hand off to `trellis-check` after the
  implementer stops product edits. Do not run heavy checks concurrently.
- [x] Checker verifies complete PRD/design/spec scope, cross-layer data flow,
  source reuse, types/lint/tests and negative cases; self-fix within scope.
  Final integrated-source independent review passes after its small toolbar fix;
  full non-DB tests/types/lint/Prisma pass. Main's actual application resource-safe
  build and rebuilt native browser matrix complete the separate local gates.
- [x] If discovered work requires schema/API/Worker/billing migration, hidden
  old graph data or a new feature suite, stop and return to planning for approval.

## Required Test Matrix

- AC1/AC2: direct creation and image continuation; private versus shared prompts;
  canonical references; one explicit run; zero run on selection/opening/import;
  combined node/edge/512KiB limits, pending/unknown reservations, invalid sources,
  duplicate canonical inputs and >16 inputs reject without partial group/selection.
- AC3: image click/view separation; non-control whole-card movement; <3px press,
  latest pointerup coordinates, one accepted move, second pointer/cancel/outside/
  lost capture/stale position or camera, deletion/owner/readOnly switch and a
  subsequent clean drag. Keyboard movement/Delete/IME/control opt-outs.
- AC4/AC6: stable textarea during missing-prompt repair and rapid native input,
  expected-source replacement race, shared source remains shared, old graph IDs/
  coordinates/run bindings, real measurement stability, desktop overlay clipping,
  phone/short viewport native scroll and focused DOM, retained raw fields/empty
  Custom size and invalid collapsed settings blocking Run/Save.
- AC5: thumbnail add/replace/remove/order and rejected original list/edge identity;
  all-or-none multi-file import including invalid last file/capacity exhaustion;
  captured A chooser after selecting B, no-capture/cancel/unmount/deleted target,
  frozen world anchor and no accidental latest-target mutation.
- AC7: existing controller-run/document/draft/original/lease/jobs/studio regression
  suites; captured Save with newer edits, uncertain same-run recovery, terminal
  once-only output, owner isolation, organization-only deletion, feature-off chat,
  invalid field and IME/Enter submit prevention, original download lifetime.

Use real components/controller fixtures. Important existing suites include
`canvas-stage`, `canvas-node-editor`, `use-canvas-editor`, `canvas-controller-*`,
`canvas-draft-store`, `canvas-reference-runtime`, `canvas-renderer-adapter`,
`canvas-mobile-interaction`, `canvas-mobile-viewport`, `canvas-terminal-placement`,
`generator-studio-canvas`, `use-canvas-runtime-lease` and `use-studio-jobs`.
Add focused named tests as needed; these are source/test paths, not JSONL inputs.

## Validation Commands And Evidence

Run the equivalent commands from a credential-isolated current-source checkout
with installed pinned dependencies. Tests must not inherit build-only APP_URL or
development dotenv/preloads/proxy/credentials. Prisma output must stay in the
isolated dependency copy. Do not use implicit dependency install for fixtures.

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vitest run --testTimeout=30000 --maxWorkers=2
pnpm build
git diff --check
```

Full non-DB test completion is one receipt, not aggregated partial runs. Serialize
heavy tests/build/browser work, keep global deadlines/real exits and retain red
receipts before corrected reruns. Include current task tools in root lint where
the existing ESLint scope applies. Check new owned-file whitespace without
unauthorized staging; cached whitespace check belongs to a later approved commit.

Prepare a fresh task-owned actual Next SSR/lazy/React Flow browser fixture with
native IndexedDB, dummy loopback identity/HTTP and original image bytes. Adapt
archived fixture patterns only after replacing dated paths and binding copied
source/build/helpers/dependency links to current hashes pre/post build/browser.
Start background helpers hidden. No actual development dotenv, login/provider,
DB/S3/billing or production flags are required for this frontend scope.

Native pointer/keyboard actions must hit actually visible controls after scroll
and `elementFromPoint` calibration. Exercise first creation, reference attachment,
continuation, single click versus drag, cancellation, actual pan/zoom, composition,
editor focus/short clipping, Save/reload with originals and old graph, mode switch
without run, and explicit original download. Do not use DOM click/focus to bypass
covered controls or mislabel synthetic/CDP IME as physical native IME.

Inspect screenshots at desktop and 360/390/430px plus short/landscape layouts.
Use a representative 24-node/up-to-32-valid-edge graph and 200-node smoke;
record crashes/unreachable controls/lost input, not an invented FPS claim.
View resulting images locally and fix visual/input issues before completion.

Real DB/Worker/storage wrappers, physical iOS/Android/OS IME/chooser/download,
live authentication/paid-provider E2E and actual GitHub CI are separate unperformed
gates, not passes inferred from mocks. If shared contracts remain unchanged, do
not start unauthorized real infrastructure just to restate prior acceptance.

## Completion And Rollback

- [x] Reconcile AC1-AC8 against fresh evidence and independent review, including
  what was not executed. Final local automation and independent review pass;
  physical/live/actual CI remain unperformed (see `verification.md`). Correct
  specs through main's `trellis-update-spec` after
  actual implementation, never turn a proposed contract into a false spec fact.
- [x] Verify final source hashes/status/diff and no unrelated edits, schema,
  dependencies, production settings or accidental generated output changes.
- [x] Summarize delivered UX, validation and physical/live/CI residual gaps.
- [x] Obtain explicit grouped commit/push confirmation and complete the real
  source/spec staged audit; `source-commit.json` records the actual source commit.
  Task/evidence and journal commits then follow `checks/delivery/plan.md`; record
  the normal push's advertised SHA in the delivery journal after execution.
  Deployment/automatic archive and physical/live acceptance stay excluded.

Risky seams are composite scene/original publication, prompt binding/IME,
pointer-writer arbitration, measured nodes and overlay clipping/lifetime.
Rollback only task-owned changes after checking foreign edits; preserve drafts,
accepted jobs/media and all failure evidence. No destructive Git rollback,
recursive deletion/move of unchecked computed paths, force-save or data cleanup.
