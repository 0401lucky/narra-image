# Independent Revision 2 Review

## Scope And Context

Reviewed the complete approved revision 2 product/test/notice diff against its
PRD, design, implementation plan, frontend index/component/hook/state/type/
quality/canvas specs and operations canvas contracts. Native check context was
loaded from the saved hook output, with the omitted active planning sections
read explicitly. Historical revision 1 no-fold rules were not mistaken for
revision 2's approved presentation requirements.

`initial-source.json` records the 23 handed-off source/test/notice byte identities.
The reviewer owns only scoped corrections below and this review folder. Main
owns spec/task/browser changes. No git staging/commit/push, reference-project
edits, dependency installation, real dotenv, live/paid service, deployment or
archive action occurred.

## Findings Fixed

### P2: Invisible Replaced Node Still Accepted Pointer And Keyboard Input

File: `src/components/create/canvas/renderer-adapter.ts`.

Only the inner node article was transparent/inert while its attached editor
was open. React Flow's outer wrapper still explicitly had pointer events,
selection and a tab stop. At larger scene zoom, that invisible original wrapper
can extend outside the screen-sized editor, intercepting clicks/drags and
keyboard deletion where no card is visible.

The projection now disables wrapper selection, dragging, connection and focus,
sets outer `inert`/`aria-hidden` and `pointerEvents: none`, while keeping the same
domain ID, world position and measured geometry. Closing restores interaction;
phone Browse cards remain selectable. A regression covers both transitions,
phone behavior, identity and source immutability. React Flow's real wrapper
implementation was checked, not assumed to inherit the inner article's inertness.

### P2: Selected Image Actions Could Fall Under The Bottom Docks

File: `src/components/create/parts/canvas-image-toolbar.tsx`.

The old placement clamps to the viewport bottom only. The new camera/creation
docks have higher stacking order, so a partly offscreen selected image could
place Continue/View/Download underneath those docks.

The toolbar now measures its own rendered height, bounds itself against the
visual viewport and reserves both actual dock rectangles. Its resize observer
tracks the toolbar/docks as well as the live image card, and visualViewport
resize/scroll listeners are paired with cleanup. The regression first reproduces
the obstruction, then changes camera-dock and toolbar height without faking a
viewport resize; placement updates without modifying the scene or running jobs.
The prior late-card mount/removal regression remains, with an explicit toolbar
geometry fixture instead of the generic non-node 1000x600 mock rectangle.

### P2: Mounted Studio Integration Tests Still Assumed Permanent Prompt Cards

File: `src/tests/unit/generator-studio-canvas.test.tsx`.

The first full non-DB run exposes six failing mounted-root tests omitted by the
implementer's focused list. Direct creation still searched for the removed
separate prompt editor, and old-graph tests did not enter Advanced graph.

Direct-flow tests now use the unified creation prompt. Compatibility tests
explicitly open Advanced graph before finding the original note. The phone raw
seed test also opens the native advanced disclosure instead of programmatically
editing a hidden field. Owner A-B-A, controller persistence, balance refresh,
lost-ACK read-only recovery, lazy failure and zero-extra-generation assertions
are retained.

## Full-Scope Audit

- Default folding is a renderer projection only; canonical prompt/generation
  IDs, coordinates, edges and source sharing are preserved. Standalone/shared
  note lookup and unambiguous selection mapping remain available in full graph.
- The sole editor/raw registry, expected prompt binding, first-input repair,
  captured chooser, explicit apply-before-Run/Save and controller permissions
  remain authoritative. No alternative execution/validation store is introduced.
- Desktop hand mode bypasses captured node motion and disables Flow selection;
  phone Browse/Move remains distinct. View/tool changes cancel unfinished moves.
- Model/size/prompt/reference controls are composed once in the attached editor;
  secondary parameters/connections remain native disclosures. Pending invalid
  fields still block Run/Save and expand/focus their actual target.
- No changes occur in shared contracts, API routes, SQL, Worker, storage,
  environment manifests, billing or dependency manifests. No generated product
  template applies. The full upstream MIT notice and pinned adaptation sources
  are retained in `THIRD_PARTY_NOTICES.md`.

## Verification

- Baseline full run: FAIL, 144 files / 1822 tests, six stale studio UI assertions;
  receipt `20261104T071046-test-ba590e` retained.
- Newly added interaction regressions: FAIL before fixes;
  receipt `20261104T071537-test-1aec98` retained.
- Post-fix focused run: PASS, 4 suites / 71 tests;
  receipt `20261104T071801-test-8b682d`.
- Final isolated root lint: PASS, zero errors and nine existing warnings;
  receipt `20261104T071912-lint-0ed200`.
- Final strict TypeScript: PASS; receipt `20261104T071956-types-52fdee`.
- Final full non-DB Vitest: PASS, 144 files / 1824 tests in one 116.53-second
  run; receipt `20261104T072030-test-d8958d`. DB suites remain intentionally
  excluded, not accepted by these results.
- All gate source before/after comparisons show no snapshot mutation. The
  retained first full failure and red interaction regressions are not overwritten.
  `gates.json` indexes six copied real receipts/stdout/stderr with byte hashes.
- `git diff --check`: PASS. No staging was authorized or performed, so a real
  staged whitespace check belongs to a later approved commit operation.
- Product/test edits are frozen. `final-source.json` records 25 changed source/
  test/notice hashes, the reviewer's five changed paths, and three main-owned
  spec hashes independently reviewed for consistency. There are no remaining
  identified in-scope findings. Main separately owns the actual application
  build and fresh browser checks against this corrected source.

## Spec Notes For Main

Main updated the canvas spec with the renderer-local creation/graph and select/
pan types, pure source/visible-target derivation, retained hidden measurements,
attached editor and wrapper-level inert contract. Main also corrected the older
adjacent-placement sentence so generation attachment does not conflict with it.

The spec now requires measured dock space for both composer and selected-image
actions, outer-wrapper hit/focus coverage, the two new regressions and explicit
mounted-studio full-graph routes. The frontend index and quality matrix match.
Those changes were reviewed without editing main's files. No operations contract
update is needed.

## Evidence Boundaries

Main's earlier native 14/14 checkpoint belongs to pre-review source and must not
be relabeled after these corrections. Main plans a fresh full matrix including
low-image dock obstruction and outer wrapper hit tests. jsdom geometry tests
are not native/browser evidence. Physical iOS/Android, OS keyboard/IME/chooser/
download, live authentication/provider/database and actual CI remain unperformed.
