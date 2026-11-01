# Mobile Canvas Verification - Evidence And Acceptance Gates

Recorded: 2026-10-31, Asia/Shanghai. Approval/implementation/review began on
2026-10-30; final browser evidence crosses midnight. Raw JSON timestamps are UTC.

## Administrative Archive Disposition

On 2026-10-31 the user explicitly requested archiving the delivered code and
scoped local-automation task. `closure.md` records this one archive authorization
and deferred gates. The archive command's `completed` status is administrative;
MA1-MA4 stay unchecked, physical/native/services/actual CI remain unperformed,
and full-root lint is still not accepted. No Git commit or deployment follows.
Earlier `in_progress` statements and artifact hashes remain historical results,
not a claim that the archive passed those missing gates.

## Latest Continuation: 2026-10-31

See `checks/mobile-resume-verification-2026-10-31.md` for the resumed source-bound
mobile checks, dated whole-tree snapshot and retained full-root lint failure.
The mobile 35-path source freeze is unchanged; fresh fixture-05/browser-08
evidence is separate from the original fixture-04/browser-07 results.

The user explicitly requested preserving the other agent's ongoing homepage
work and completing only mobile responsibility. The original 1514-identity
continuation snapshot is therefore not claimed unchanged as a whole; its failed
preservation audit is retained. Full-root lint is not green, scoped mobile lint
does not replace it, and physical/native MA1-MA4 acceptance remains pending.

The sections below retain the original frozen checkpoint and dated receipts.
They are not a new full-worktree quality or device-acceptance verdict.

## Original Frozen Checkpoint And Acceptance Boundary

- Approved implementation and local automated quality/browser verification are
  complete on the frozen source described below. Independent review identified
  and fixed five frontend defects; no identified in-scope code blocker remains.
- This is NOT full target-device acceptance. Task remains independent
  `P3 / in_progress`; MA1-MA4 remain unchecked. Physical iOS/Android touch,
  native Chinese IME/keyboard/safe-area/accessibility zoom/chooser/download,
  real services and actual CI remain explicitly unperformed.
- No duplicate task, archived-task activation, staging, commit, push, archive,
  journal closeout, deployment or production feature enablement occurred.
  Product code remains uncommitted. Real dotenv/DB/S3/paid-provider access and
  automatic Docker/image preparation were not used for this mobile task.

## Authorization And Preserved Prerequisites

- Current user approval is `checks/implementation-approval-2026-10-30.md`;
  D1/D2 approval and delegated D3-D6 scope remain in PRD/design. Activation of
  this existing task ran once, then native implement and independent check roles
  executed directly, without recursive dispatch or main product-code edits.
- `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/verification.md` and
  `handoff.md` remain dated accepted prerequisites. The parent's AC1-AC17 and
  37 full + 37 additive SQL executions remain archived and unchanged.
  Their earlier phone-readonly presentation is intentionally superseded; their
  account/document/input/run/save/media/retention contracts are not reopened.
- No new SQL/Worker topology/real-service execution was required for unchanged
  source in this frontend scope. Ordinary DB-suite exclusion is not a new SQL
  pass, and prior browser evidence was not reused after renderer changes.
- Unrelated homepage task artifacts are user-approved parallel work, not mobile
  ownership. Its task/source pointer and all baseline product files are preserved.

## Source And Tool Provenance

- HEAD: `1f7948e334c589dc6db38ac045b584f0f5381481`; semantic index matches HEAD
  and staging is empty. Git's stat-cache refresh is not staging or a source edit.
- `research/planning-source-baseline-2026-10-30.json` records 1337 original
  file/absence identities. Exact mobile delta is 35 product/test paths:
  23 modifications of existing files and 12 additions. Many predecessor canvas
  files were already untracked; `git diff HEAD` cannot attribute this delta.
- Before-edit evidence retains 167 exact-byte `.before` copies plus the original
  history-rail absence. `snapshot-extensions-audit.json` records the suffix-only
  change so backup sources are not TypeScript/lint inputs. The original
  source-identities record is unchanged.
- Final independent source freeze:
  `checks/source-freeze-after-zoom-2026-10-30.json`. Preservation receipts before
  and after browser/spec synchronization confirm all 35 hashes, unchanged
  non-owned baseline files, exact snapshot bytes and no unexpected additions.
- Main updates only four frontend specs, plus this task/context/evidence.
  Backend/routes/schema/Worker/shared contracts/package/lock/global CSS/chat/
  existing document/jobs/runtime-lease/viewer hooks remain unchanged by mobile.
- Audited pinned Node: v24.22.1. Installed/copy versions: Next 16.2.4,
  React/ReactDOM 19.2.4, React Flow 12.12.0, TypeScript 5.9.3, Vitest 4.1.5,
  ESLint 9.39.4. Browser: desktop Windows Chrome/156.0.8078.74, not an Android
  phone or iOS Safari, and not proof of current/previous target-device versions.
- `checks/tooling-identity-2026-10-30.json` pins Node/safe-run/environment/
  dotenv-denial/package-resolution helpers. Application commands use OS-env
  allowlisting, dummy port-1 service coordinates, blank secrets and denied real
  repository dotenv reads. Build alone receives a dummy `.invalid` APP_URL.

## Original Final Quality Gates

Each label has retained original JSON/stdout/stderr in `checks/receipts/` and
exact copied identities in evidence-capture manifests. No final run timed out.

| Gate / receipt | Result | Duration / scope |
| --- | --- | --- |
| Independent complete review | PASS after four fixes; `checks/mobile-independent-review.md` | Full approved source responsibilities, not only the final patch. |
| Narrow accessibility follow-up | PASS after one fix; `checks/mobile-zoom-followup-review.md` | Only scoped CSS and existing real-editor tests changed; other 33 paths unchanged. |
| `mobile-check-focused-01` | 22 files / 364 tests pass | 12.232s, pre-zoom reviewed checkpoint, retained rather than relabelled final. |
| `mobile-zoom-focused-01` | 7 files / 117 tests pass | 9.984s, affected final-source regressions. |
| `mobile-zoom-full-01` | 125 files / 1442 ordinary tests pass | 33.260s; both sentinelled DB suites remain excluded/unperformed. |
| `mobile-main-final-types-01` | Nonincremental tsc pass | 9.713s, after final harness/spec work. |
| `mobile-main-final-lint-01` | Zero errors / nine baseline warnings | 11.942s; no mobile/harness-owned warning. |
| `mobile-final-build-02` | Prisma generation + full Next production build pass | 22.738s on final product source, feature default remains off. |
| `mobile-final-worker-ts-01` | 6 files / 32 tests pass | 2.845s; unchanged TS generation/Worker contract surface, not Go/DB/runtime execution. |
| `mobile-fixture-build-04` | Copied-package direct Node/Next build pass | 7.792s, actual-source minimal fixture only. |
| `mobile-browser-07` | 27 actual-component browser groups pass | 150.415s, fresh fixture-04/native IndexedDB/loopback fake HTTP. |
| Source/package audits | prebuild/postbuild/prebrowser/postbrowser pass | 224 exact inputs and inventories, copied-package links and fixture/helper hashes. |
| Context/whitespace/preservation | PASS | Real JSONL paths, `git diff --check`, exact source/baseline/snapshot audits. |

Nine baseline warnings: one migration-safety unused binding, one repair binding,
one marketing mobile-nav image warning, six my-works-board test bindings.
They are not suppressed or attributed to mobile. Build stderr contains normal
Prisma config/schema/update notices, not a failed gate or dependency update.

## MA Evidence Matrix

`B<n>` references group n in
`checks/browser-evidence/mobile-browser-07/results.json`. All verdicts are
layer-specific; no automated row checks a physical-device MA box.

| Criterion | Fresh automated evidence | Pending / verdict |
| --- | --- | --- |
| MA1 / core connected creation | B11-B18: empty New, explicit unscaled prompt/parameter editing, local originals, whole-card Move, prompt/image connect/replace/disconnect/order, one frozen ready Run and result attachment. B4/B5/B21 cover READY reuse, old results and unavailable-source rejection. Real controller/editor suites cover provenance/canonical duplicates/readiness/capacity and no-submit failures. | AUTOMATED PASS; full phone/native chooser/touch/result acceptance pending. |
| MA2 / same IDs, drafts vs snapshots | B3/B4/B6/B7/B17/B19/B20/B26/B27: native IDB originals/drafts, captured delayed Save/newer dirty edit, separate profile with same owner/canvas snapshot and no reupload, warned fake-server conflict, organization-only deletion, tombstones/live-origin terminal restoration. Retained controller/storage/API suites cover owner/CAS/failure/retention. | AUTOMATED PASS with fake identity/HTTP; no new physical-account/real-service acceptance. MA2 stays unaccepted. |
| MA3 / navigation, fields, chat, results | B6/B8/B11-B15/B18/B19/B23-B27: no implicit Run/Save on layout/mode/owner changes, retained mounted invalid fields, stable focused DOM/CDP composition, node runtime confirmation, native original-download hold, independent chat Send and read-only/lazy recovery. Existing poller/runtime/origin suites remain green. | AUTOMATED PASS; real Chinese keyboard/candidate UI/foreground behavior/OS download and CAPTCHA vendor unverified. |
| MA4 / touch/layout/usability | B9-B16/B22: desktop header/port behavior, 360/390/430 portrait and 844x390/390x440 layouts, >=16px fields/44px actions, native label hit, actual scene pan/pinch/Move/cancel, browser accessibility page zoom, chooser/Locate and stress smoke. Main visually inspected retained screenshots. | AUTOMATED PASS on one desktop Chromium engine; iOS18+ Safari/Android12+ current/previous Chrome, safe areas/native keyboard and actual physical target usability pending. |

### Selected Browser Observations

- B12 actual dispatched two-finger touch changes browser page scale
  1 -> 2.9294252395629883 inside the editor; field identity, scene nodes/camera
  and Run/Save counts stay unchanged. Separate B13 scene pinch changes only the
  scene camera. Calibration plain controls are retained separately.
- B13 Move accepts `{x:50,y:55}` -> `{x:74,y:71}` once; unfinished preview is
  absent from the native draft. Cancel/second finger retain the accepted drop.
- B15 saved-provider associated label measures 324x44 CSS px and changes its
  actual native checkbox from a touch; it does not confirm settings or Run.
  Runtime fields remain the same focused DOM across portrait/short layouts.
- B17 captures all three originals, including unused ones; later prompt changes
  remain locally dirty. B20 restores only the saved prompt/three READY sources
  in a separate profile, not newer unsaved results, with no second upload.
- B18 one user Run captures one prompt and two ordered imported asset IDs,
  `count=1`; second tap admits no new run. Mode/selection changes preserve the
  captured result origin and create no account Save.
- B19 delays actual Blob download fetch, closes viewer/editor, removes its
  reference card, then releases fetch. Native browser download completes with
  exact original bytes; fixture canonical jobs remain. This is desktop browser
  evidence, not iOS/Android download-manager validation.
- B22 390px CDP scene: 24 nodes/32 valid edges, 25 chooser options and 2.199s
  observed select+Locate; 200 nodes/0 edges, 201 options and 2.246s. Picker is
  44px high; workspace is 390x339.578125 and document width is 390. B10 desktop
  select/settle observations are 1.475s/1.499s. These are one-engine smoke
  observations, not FPS, latency SLA, 400-edge or production-capacity benchmarks.
- Final report records zero facade errors and no unexpected external request.
  Desktop/separate-profile clients have zero console errors/exceptions/blocked
  requests. Lazy-network profile has only the intentionally caught chunk error
  and intentional blocked chunk; no automatic reload or generation replay.

### Visual Review

Main inspected final 360x844 portrait editor, 844x390 landscape editor,
390x440 runtime dialog and 200-node phone Locate screenshots. Cream/orange,
Chinese controls, readable unscaled fields and visible Close/chooser remain.
Short layouts intentionally scroll the same whole panel/dialog; lower fields
and footer are not all visible at once. Runtime confirmation was reached through
actual scrolling/hit-testing. Screenshots do not certify real notch/keyboard/IME.

## Independent Findings And Retained Red Evidence

- Outside pointer completion: symmetric window end/cancel cleanup prevents stale
  pointer state without accepting cancelled geometry.
- Focused parameter composition: external canonical updates cannot invoke stale
  native value restoration while composition is active.
- Automatic custom size: accepted auto aliases display canonical value; new empty
  Custom remains explicitly pending and blocks Save/Run.
- Saved-provider checkbox: its native associated label has a 44px target.
- Accessibility zoom: panel/scroller/editable/read-only prompt scoped gestures
  permit native page pinch; transformed canvas gesture rules remain unchanged.

Eight real-component regressions were added during independent checking;
`mobile-check-regression-01`, `mobile-check-regression-03` and
`mobile-zoom-regression-01` retain the corresponding red failures. Intermediate
implementation checks are retained in the role report, not presented as final.

`checks/browser-tooling-correction.md` records every rejected tooling/browser
attempt. First fixture build exit 0 is explicitly REJECTED because missing
packageManager let pnpm implicitly download/install only in owned temporary
caches; repository product/package/lock stayed unchanged. Fresh copied packages
and direct Node/Next supersede it. Browser attempts 01-06 retain failed receipts:
unclipped coordinates, wrong fixed-ancestor clipping, CDP DOM serialization,
uncalibrated synthesized pinch, selector escaping and covered background Save.
No requirement was waived or product validator relaxed to make them pass.

## Spec Sync And Handoff

- Frontend canvas/state/quality/index now describe mount-safe capability,
  mounted nonsecret fields, apply-before-capture, canonical size/composition,
  atomic replacement, renderer-only Move, accessible touch/viewport contracts
  and separate browser/device evidence. All seven executable-spec sections remain.
- Operations canvas contracts were reviewed and intentionally unchanged.
  `checks/mobile-debug-retrospective.md` records root causes and prevention;
  no nonexistent generated-template tree or duplicate task was created.
- `handoff.md` and `checks/manual-device-matrix.md` own next-step boundaries.
  No archive/commit/deploy/real-service consent is inferred from automated green.
