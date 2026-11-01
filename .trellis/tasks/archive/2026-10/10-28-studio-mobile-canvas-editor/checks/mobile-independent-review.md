# Independent Mobile Review

Date: 2026-10-30. Role: separately dispatched native `trellis-check`.
Active task: `.trellis/tasks/10-28-studio-mobile-canvas-editor`.

## Verdict And Scope

- Full approved product/test scope was reviewed against current M1-M4, D1-D6,
  design and implementation contracts, not only the checker's final patch.
- The complete saved hook output, omitted research, all check.jsonl references,
  PRD/design/implement, role/skill instructions and package discovery were loaded.
  Current approved mobile policy supersedes the historical phone-readonly spec.
- No remaining identified in-scope product defect after the fixes below. The
  unit/controller quality gate passes. This is NOT full MA acceptance: main's
  production build, Worker TS and fresh source-bound browser gates are separate;
  physical/native-phone acceptance remains unverified.
- No sub-agents, task activation/status/archive changes, staging, commits,
  dependencies, backend/routes/schema/Worker/DB tests, global CSS, homepage or
  existing lifecycle-hook edits were made by this role.

## Findings (fixed)

### 1. Stale browse pointers prevented subsequent explicit movement

- File: `src/components/create/parts/canvas-stage.tsx:97`.
- Issue: every viewport pointerdown entered the live-pointer set, but only a
  viewport pointerup/cancel removed it. A mouse browse gesture ending outside
  the viewport left a stale pointer, so the next deliberate Move was treated as
  a multi-pointer gesture and never committed.
- Fix: symmetric window pointerup/pointercancel cleanup. An outside completion
  only cancels an unfinished preview; it never accepts geometry. Normal valid
  drops still commit once through the existing captured-target guard. Listeners
  are removed on unmount.
- Regression: real CanvasStage/controller cases for outside pointerup and
  pointercancel in `src/tests/unit/canvas-node-editor.test.tsx:312`. Both were
  red with zero moves before the fix, and pass after it. Existing valid-drop,
  second-finger, outside-finger, cancellation and stale-origin cases remain green.

### 2. Parameter canonical updates could interrupt active composition

- File: `src/components/create/parts/canvas-node-inspector.tsx:44`.
- Issue: CommitField accepted an external canonical model immediately, including
  during focused native composition. The real controller-to-field regression
  recorded a native value setter call replacing the IME's selected text.
- Fix: retain the synchronous local/native input path and defer external value
  replacement while focused and composing; composition end or blur re-enables
  deliberate canonical synchronization without replacing the field DOM.
- Regression: native-setter and selection assertions with actual parameter
  updates in `src/tests/unit/canvas-node-editor.test.tsx:207`. Existing raw-draft,
  composition Enter/229, field application and Save/Run gating tests also pass.

### 3. Applied automatic size was rendered as an unmarked empty custom field

- File: `src/components/create/parts/canvas-node-inspector.tsx:170`.
- Issue: the shared normalizer accepts `auto` and its legacy reference-image
  alias. Applying either removed the pending draft but rendered canonical auto
  as an empty custom-size field, implying incomplete input while Save/Run could
  capture auto without a pending warning.
- Fix: render the actual accepted canonical size. A newly selected Custom
  option still creates an explicit empty pending draft and blocks Save/Run;
  selecting a preset still deliberately clears that draft. No schema or shared
  normalization policy changed.
- Regression: two actual editor cases in
  `src/tests/unit/canvas-node-editor.test.tsx:190` prove canonical display,
  no implicit request and correct explicit account Save. The existing empty
  Custom/invalid-size rejection case remains green.

### 4. Saved-provider checkbox lacked the promised touch target

- File: `src/components/create/parts/canvas-runtime-dialog.tsx:65`.
- Issue: the associated checkbox label had only a text-line-height target.
  The general input/button minimum rules explicitly excluded this checkbox.
- Fix: make the entire associated label a minimum 44px-high clickable row,
  retaining its native checkbox, disabled-fieldset and captured dialog behavior.
- Regression: `src/tests/unit/canvas-node-editor.test.tsx:416` checks the target
  class, actual label activation, lack of implicit confirmation and disabled
  behavior while busy. This is a DOM/style-contract regression, not physical
  hit-target measurement; main's browser fixture must cover the saved-provider
  branch separately from a dummy user with no saved provider.

Six cases were added to the existing actual-editor suite (19 -> 25). The checker
modified three product files plus that one existing test file; no new test
helper, validation bypass or warning suppression was introduced.

## Findings (not fixed)

No identified in-scope product defect remains. Unperformed browser/build/device
gates and main-owned spec synchronization are not marked passed by this report.

## Full-Scope Review

| Area | Reviewed paths and result |
| --- | --- |
| Capability/lifetime | use-studio-mode, root wiring, editor hook and existing document/runtime/job hooks: mounted capability is independent of width/pointer/keyboard; owner/disabled/deleting/readiness guards remain. Root integration and retained lease tests pass. |
| Field ownership/capture | editor-state, shared prompt, inspector and root: nonsecret fields are keyed above lazy stage; same-canvas pending values apply before Save, target pending values before Run; invalid values retain/focus their target; newer pending input survives an earlier Save ACK. |
| Atomic connections | commands/controller and shared graph: replacement validates a copied candidate, retains edge/ordinal on failure, protects provenance and canonical result identities, allows local originals before upload, and neither releases reservations nor submits. |
| Touch/desktop renderer | stage, node shell/nodes, adapter and mobile-interaction: browse/pan versus explicit Move are separate; interim geometry is renderer-only; valid captured drop commits once; stale/cancelled/multi-pointer preview does not. Measured dimensions, desktop headers/ports/keyboard are retained. |
| Management/originals | toolbar/sidebar/dialogs/reference content and existing controller: chooser/confirmations retain targets; cancellation does nothing; Save resolves all originals, account reload is warned, deletion remains organization-only. |
| Runs/results/leases | actual root/controller/run and retained tests: one explicit Run, frozen ordered inputs/count, original uncertain retry/read-only recovery, live-origin-only terminal materialization, deleted-result suppression and independent viewer/download holds remain. |
| Layout/IME/chat | viewport hook, scoped CSS, stable editor DOM, runtime/image dialogs and retained ChatPane/root tests: finite visible intersections affect CSS only; short-height mode scrolls the same editor as a whole; local/native input remains synchronous; chat remount observers and intentional Enter behavior remain unchanged. |
| Scope/reuse | No new scene/wire/schema, global job store, account library, graph scheduler, mode-copy, media deletion, cancellation/refund or production flag path. Existing Chinese cream/orange presentation, constants and normalizers are reused. |

CSS/source and jsdom geometry checks do not establish native touch arbitration,
real candidate UI, safe-area fit, 24/200-node browser usability or OS file/download
behavior. Those remain separately attributed to main's browser/manual matrix.

## Verification

All application checks used the identity-verified pinned Node and audited
`safe-run.mjs` with test-mode OS allowlisting, dummy service coordinates, blank
service secrets and repository-dotenv denial. No bare application command,
service/DB/Docker operation, dependency preparation or browser was run here.

| Receipt | Result | Duration |
| --- | --- | --- |
| `mobile-check-focused-01` | PASS, exit 0, 22 files / 364 tests | 12232ms |
| `mobile-check-full-02` | PASS, exit 0, 125 files / 1440 tests | 28452ms |
| `mobile-check-types-02` | PASS, exit 0, nonincremental tsc --noEmit | 10249ms |
| `mobile-check-lint-02` | PASS, exit 0, zero errors / nine baseline warnings | 12071ms |
| `git diff --check` | PASS, exit 0; existing CRLF notices only | Not timed |

All four final wrapper runs have empty stderr and `timedOut=false`.
The two sentinelled DB suites remain excluded from ordinary Vitest. Their
exclusion is not SQL, retention, Worker-runtime or deployment acceptance.

The nine baseline lint warnings are the unused migration-safety binding,
unused repair binding, marketing mobile-nav image and six my-works-board test
bindings. No checker/mobile-owned source warning remains.

Installed versions inspected from package metadata: TypeScript 5.9.3,
ESLint 9.39.4, Vitest 4.1.5, Next 16.2.4, React Flow 12.12.0. The pinned
Node v24.22.1 identity and all five tooling identities match
`checks/tooling-identity-2026-10-30.json`.

### Retained Intermediate Receipts

| Receipt | Actual outcome |
| --- | --- |
| `mobile-check-full-01` | Exit 0, 125 files / 1434 tests on implementer freeze, 36240ms. |
| `mobile-check-regression-01` | Exit 1, 19 pass / 3 fail, 7580ms: two outside pointer completions and checkbox target. |
| `mobile-check-regression-02` | Exit 0, 22 tests, 7498ms after those fixes. |
| `mobile-check-types-01` | Exit 0, 12909ms; intermediate source. |
| `mobile-check-lint-01` | Exit 0, nine baseline warnings, 14873ms; intermediate source. |
| `mobile-check-regression-03` | Exit 1, 22 pass / 3 fail, 7187ms: two normalized-auto displays and external parameter composition. |

Original JSON/stdout/stderr files were not rewritten. Each label is stored in:

`C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea/react-flow-spike/logs/`

Main owns copying these receipts into task evidence, final application build,
Worker TS and source-bound Next/React Flow/native-IndexedDB browser execution.
Any later product edit invalidates the relevant source receipts.

## Final Source Freeze

Final source freeze was announced to main after all final checks. All 35
product/test identities matched the implementer report before checking. The
final identity set is `checks/source-freeze-before-review-2026-10-30.json` with
only the following four SHA256 replacements; the other 31 are unchanged.

```text
src/components/create/parts/canvas-node-inspector.tsx 8724ee0db77a35d70617c0a7326c7336fa1ed18447a1d6e2ff8935c4dee11e35
src/components/create/parts/canvas-runtime-dialog.tsx 9697a8181344b5f1880a8c537e87a9e86acc0cb6dd052824b63e56c3034bc73c
src/components/create/parts/canvas-stage.tsx 4f8697f5abe5467d72b5b12cd98571ce17c94cc32dc52c8835598ecadcd9ba09
src/tests/unit/canvas-node-editor.test.tsx 4fc432a37f831ce06af728714b5b68c56fbc16d4e9314e8d37c15e347d3f2152
```

Preservation audit compared all 1337 original baseline identities: 23 owned
baseline files differ as expected, no non-owned baseline file differs, and
no unexpected product change is present relative to the implementer freeze.
HEAD remains `1f7948e334c589dc6db38ac045b584f0f5381481`; staging remains empty.
The original history-rail absence and preexisting untracked canvas work were
preserved, not reset or attributed wholesale from git diff HEAD.

## Spec Sync For Main

- Update frontend canvas-studio and index to replace historical width/phone
  read-only policy with mount/feature/owner capability plus separate touch
  presentation; keep real read-only/deletion guards and SSR chat defaults.
- Document the mounted nonsecret field registry, explicit empty Custom intent,
  accepted canonical size display, focused-composition external-value guards,
  apply-before-capture and runtime-only unfinished-draft limitation.
- Document atomic edge replacement, renderer-only whole-card Move preview,
  outside pointer-end cleanup and no commit on cancelled/stale/multi-pointer
  gestures; preserve measurement/desktop contracts.
- Add quality references for the six regressions and distinguish DOM/CSS target
  checks from actual browser/device measurements, including checkbox labels.
- Operations canvas/save/run/asset/retention/wire contracts did not change;
  no new backend or infrastructure acceptance is warranted.

Physical iOS Safari and Android Chrome touch/native Chinese IME/keyboard,
chooser/download and actual hardware versions remain UNVERIFIED. Real
DB/S3/provider/paid services, browser login-to-provider E2E, actual GitHub Actions
and deployment remain UNPERFORMED/outside this review's authorization. No MA
boxes, archive, rollout readiness or production acceptance are asserted.
