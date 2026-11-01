# Mobile Resume Independent Review

Date: 2026-10-31, Asia/Shanghai. Role: existing independent `trellis-check`.
Active task: `.trellis/tasks/10-28-studio-mobile-canvas-editor`.

## Verdict And Authority

- No new mobile product defect was identified in the full 35-path review.
  Current scoped mobile regressions and scoped lint pass without product edits.
  Full-root lint FAILS on unrelated homepage generated/vendor evidence; this
  report does not declare the current whole tree quality-green.
- The user explicitly permits ongoing homepage work to remain and asks this
  role to finish only mobile review. No homepage source/evidence was changed,
  removed, suppressed, or accepted on behalf of its owner.
- This is not full MA/device acceptance. The task remains `P3 / in_progress`,
  with MA1-MA4 unchecked. Physical/native phone, real service, actual CI and
  rollout gates remain unperformed, not waived by scoped automated passes.
- Write ownership is only this report and unique `mobile-resume-check-*`
  receipts. No product/spec/configuration edit, task activation, recursive
  dispatch, dependency installation, staging, commit, archive, journal closeout,
  deployment, real dotenv or DB/S3/provider operation occurred in this role.

## Findings (fixed)

No new product finding required a fix. All five previously fixed mobile findings
remain present in the frozen source and retain their regressions: outside
pointer completion cleanup, focused parameter composition, accepted automatic
size display, saved-provider label touch size, and unscaled editor page pinch.

One review-metadata comparison was corrected without rewriting its original
receipt. The first index comparison used Git's default quoted paths, causing
seven non-ASCII image filenames to differ textually from the baseline. The
separate `mobile-resume-check-index-pre-correction-01.json` explains that false
comparison. Final semantic checks use `git ls-files --stage -z` and
`git ls-tree -rz --full-tree HEAD`: all 810 entries match the resume baseline
and HEAD, and staging is empty. Git configuration was not changed.

## Findings (not fixed)

### Full-root lint traverses foreign generated/vendor task evidence

- File scope: `.trellis/tasks/10-30-homepage-warm-editorial-redesign/checks/`.
- `mobile-resume-check-lint-01` returns exit 1, not a timeout, with 43,348
  problems: 2,504 errors and 40,844 warnings across 1,709 diagnostic paths.
- 1,704 paths under `checks/.runtime/` account for 2,482 errors and 39,929
  warnings. `checks/browser/reference-assets/tailwind-cdn.js` accounts for the
  remaining 22 errors and 906 warnings in foreign evidence.
- Thus every error and 40,835 warnings belong to homepage generated/vendor
  evidence. The remaining nine warnings are in real source/test paths:
  `scripts/lib/migration-safety.mjs` (1), `scripts/migrations/repair.mjs` (1),
  `src/components/marketing/mobile-nav.tsx` (1), and
  `src/tests/unit/my-works-board.test.tsx` (6).
- The complete path/count analysis and original stdout hash are retained in
  `receipts/mobile-resume-check-lint-ownership-01.json`. The root lint receipt
  and all original outputs remain intact. Neither an ignore-rule change nor
  deletion/move of another agent's evidence is authorized here.
- Main explicitly requested a separate 34-file mobile TS/TSX lint run with
  unchanged rules. It passes with zero errors/warnings; it is NOT a replacement
  full-root pass. CSS is covered by retained authored-style/component tests,
  not falsely described as ESLint-checked.

### Whole-tree evidence cannot follow ongoing homepage edits automatically

- `mobile-resume-check-full-01` genuinely passes 136 files / 1,610 tests at its
  recorded execution. Four homepage test files subsequently changed, and
  `frontend/index.md` plus new `frontend/homepage-interactions.md` changed the
  documentation inventory. User authorization makes preservation appropriate,
  not the old whole-suite result current for those later bytes.
- The retained `resume-preservation-after-checks-01.json` is not rewritten to
  hide that chronology. This role instead reran the exact 22-file mobile and
  retained-boundary batch against independently hashed current inputs.
- At the scoped post-check, `frontend/quality-guidelines.md` also differs from
  the 1,514-identity resume baseline: SHA-256
  `a26d7b589239a4c6dc3cb2e80c258c8fe10aaf2360f4fd4c542921fd0e6d75b9` becomes
  `22c617efebd6b110d3e7242e92349d007bc1f177fa737e992c72a14a06db28a1`.
  Its added section 8 concerns isolated Node API wrappers, `fs.exists` custom
  promisification, copied Prisma output, font evidence and delayed screenshots.
  This role did not write it. Main explicitly states it had not yet edited that
  file; authorship is therefore not attributed to main. Main confirmed that this
  is preserved as the other task's concurrent spec work and will not append to
  the shared guide. It affects none of the scoped 35/22/256 inputs.

## Full-Scope Source Review

The saved hook output was read, followed by the exact task PRD/design/implement,
check manifest and omitted research/review/verification/handoff/device artifacts.
Frontend directory/component/hook/state/type/quality/canvas, operations canvas
and release, generation-worker, cross-layer/reuse and public-work contracts were
reviewed. The current task decisions override historical research alternatives.

The authoritative exhaustive path list remains the 35 identities in
`source-freeze-after-zoom-2026-10-30.json`: 27 product files and eight tests.
Existing-file deltas were also compared with the exact pre-implementation
`.before` copies rather than attributing all uncommitted code from HEAD.

| Responsibility | Source and behavior checked |
| --- | --- |
| Capability and lifetime | `use-studio-mode`, `use-canvas-editor`, `editor-state`, root wiring and existing document/runtime hooks: width/pointer/keyboard select presentation only. Feature/owner/mount/readOnly/ready/deleting checks remain. Controller/jobs/credentials outlive lazy renderer and layout changes. |
| Prompt and parameters | Shared prompt, inspector, editor and registry: native value updates remain synchronous; focused composition guards external updates; only five nonsecret fields/custom-size intent survive panel/node/mode changes. Invalid pending fields block Save/Run and focus their captured target; valid fields apply before capture. Empty Custom differs from accepted auto. |
| Atomic connections | `commands`, controller, renderer types and shared validators/graph: copied replacement validates before publication, preserving edge ID/kind/target/ordinal and old graph on rejection. Canonical duplicates, unavailable originals/results and provenance are rejected. Reservations are neither released nor bypassed; no request follows a connection edit. |
| Renderer and movement | Stage, adapter/constants, all four node kinds, shell, mobile interaction and measurements: phone previews do not mutate through Flow dragging. Explicit whole-card Move commits one captured valid drop; cancel/second pointer/outside completion/layout/target/camera changes discard preview only. Desktop headers/typed ports/keyboard and measured dimensions remain. |
| Management and originals | Toolbar, sidebar dependency, dialogs, reference content and picker: New is empty; chooser/confirmation callbacks retain canvas/node origin; cancel is a no-op. Explicit rename is metadata-only; reload warns; node/canvas deletion preserves jobs/works and cannot refund/cancel. Current-canvas READY originals and completed results are reused, with no account library. |
| Captured Save and Run | Actual controller save/run commands plus retained root tests: Save includes disconnected originals and acknowledges only captured edit revision; later edits stay dirty. Explicit Run/retry are the only submit authorities, with frozen ordered direct inputs/count, durable nonsecret outbox and original uncertain intent. Recovery remains read-only; no graph scheduler or automatic Run exists. |
| Retention, results and downloads | Existing controller, canonical jobs and viewer hooks: owner/live captured origin gates result attachment; handled/deleted results do not resurrect. Viewer and in-flight download independently retain original leases after card/editor closure. Canvas viewer has no chat Use For Edit action. |
| Visible bounds and native gestures | Viewport hook, CSS, editor/runtime/management/image dialogs: finite scoped visible intersection changes CSS, not camera/capability. Short layout scrolls the same DOM. Unscaled controls use 44px/16px rules; nodeEditor/scroller/prompts allow page pinch while canvas viewport remains `touch-action:none`. Native physical arbitration is still unverified. |
| Chat and lazy recovery | Existing ChatPane/composer, root, poller and lazy boundary: mount observers/composition refs reattach; ordinary Enter/Shift+Enter behavior stays independent; unsent chat/fields survive canvas switching; cached chunk failure offers honest manual recovery, not automatic replay. |
| Current shared dependencies | `/create` still uses default SiteHeader/HeaderShell/MobileNav, not opt-in home variant. New homepage imports do not authorize canvas state changes. Public detail DTO projection is separate from owner `serializeWork`/generation DTOs; validators' added featured-response schemas do not replace canvas schema. No new mobile public-data, auth, retention or wire authority was introduced. |

The eight changed/new mobile tests retain real controller/component coverage,
not merely button mocks: connection atomicity and readiness; field registry;
movement and finite viewport; editor composition/pinch/chooser/confirmation;
document guards; real Flow desktop stage; and root mobile/chat/lease integration.
The 22-file rerun additionally covers the original run, graph, draft-store,
reference-runtime, adapter/placement, document/jobs/poller, runtime lease,
origin, feedback, ChatPane and lazy failure boundaries. No tests were weakened,
removed or rewritten during this resumed review.

## Verification

All application commands use identity-verified pinned Node v24.22.1 and the
audited `safe-run.mjs`. All five tooling identities match
`tooling-identity-2026-10-30.json`; safe-run/environment/dotenv-denial/package
helper and repository command-runner source were inspected. Test-mode commands
use OS-env allowlisting, dummy localhost-port-1 DB, blank actual service secrets,
repository dotenv denial and independent deadlines. No package manager or
installation was needed for these runs.

Command equivalence was checked against package scripts: `test` is `vitest run`
and `lint` is `eslint .`; nonincremental tsc is the planned explicit command.
The executable following safe-run is the pinned Node, with these installed
entries: `node_modules/vitest/vitest.mjs`, `node_modules/typescript/bin/tsc`,
and `node_modules/eslint/bin/eslint.js`. All runs use cwd `E:/code/narra-image`.

| Receipt | Exact command tail / scope | Result | Deadline / duration |
| --- | --- | --- | --- |
| `mobile-resume-check-full-01` | `vitest.mjs run --testTimeout=30000` | PASS, 136 files / 1,610 tests; earlier whole-tree snapshot only | 300,000 / 45,755ms |
| `mobile-resume-check-types-01` | `tsc --noEmit --incremental false` | PASS at its recorded whole-tree snapshot | 120,000 / 28,705ms |
| `mobile-resume-check-lint-01` | `eslint.js .` | FAIL, exit 1; 2,504 errors / 40,844 warnings, ownership detailed above | 180,000 / 124,926ms |
| `mobile-resume-check-focused-lint-01` | `eslint.js` plus all 34 frozen mobile TS/TSX paths | PASS, zero errors/warnings; scoped only | 180,000 / 5,618ms |
| `mobile-resume-check-focused-tests-01` | `vitest.mjs run --testTimeout=30000` plus exact 22 paths extracted after that flag in `mobile-check-focused-01.json` | PASS, 22 files / 366 tests; current scoped source | 180,000 / 13,792ms |

Every run has `timedOut=false` and empty stderr. Passing runs exit 0. The
full-root errors are in stdout, so empty stderr does not imply lint success.
Both `worker-contracts-db.test.ts` and `canvas-contracts-db.test.ts` remain
excluded by ordinary Vitest configuration, not passed or rerun here.

All five original JSON/stdout/stderr triplets are copied byte-exactly under
`checks/receipts/`; existing copies were hash-checked rather than overwritten.
`mobile-resume-check-receipt-manifest-01.json` records exact argv, deadline,
code, timing, copied byte counts and SHA-256 identities, including the red lint.

## Source Applicability

- Initial check preflight at 02:20:21 UTC matches all 1,514 protected resume
  identities and all 35 post-zoom mobile hashes. Its original receipt is
  `receipts/mobile-resume-check-source-pre-01.json` with the separate quoted-path
  correction noted earlier.
- Focused preflight at 03:03:48 UTC independently records all 35 mobile hashes,
  the exact 22 test-file hashes and all 256 fixture05-resume production inputs.
  Mobile and fixture hashes equal their frozen manifests before the rerun.
- Focused postflight at 03:10:47 UTC matches every one of those 35/22/256
  identities. `mobile-resume-check-focused-source-pre-01.json` SHA-256 is
  `fc786a2c12d51940c79021acd129735155a1a3bcc65fb50f27b30736d09ae5d9`.
  The post receipt records each expected/actual hash and semantic index checks.
- HEAD remains `1f7948e334c589dc6db38ac045b584f0f5381481`; staging is empty.
  Authorized homepage changes are not reverted or claimed as mobile changes.
  No quiet final whole-tree freeze is asserted while that work continues.
- Historical 125 files / 1,442 tests and fixture04/browser07 remain dated facts.
  The newer 136/1,610 run also cannot certify later homepage test bytes. The
  fresh 22/366 run establishes current scoped regression evidence instead.
- Main separately owns production-build/fixture05/browser08 and task/spec
  annotations. Their receipts must retain their own source applicability and
  fake-identity/HTTP boundaries; this role did not execute a browser or build.

## MA Boundary And Minimal Main Continuation

| Criterion | Current independent result | Still not accepted |
| --- | --- | --- |
| MA1 / M1-M2 | Core edit/move/atomic connections/reference/frozen single-Run code and scoped regressions pass. | Real phone touch/OS picker/result loop. |
| MA2 / M3 | Captured Save/local draft/owner/CAS/retention and download authorities remain; scoped regressions pass. | Physical-account/real-service acceptance; ordinary exclusions are not SQL evidence. |
| MA3 / M2-M4 | Stable fields, no implicit Save/Run, captured leases/results, chat and lazy boundaries pass scoped tests. | Native Chinese candidate UI/caret/keyboard/foreground/OS download and real CAPTCHA behavior. |
| MA4 / M1-M4 | Scoped CSS/events/finite bounds/Move regressions pass; main's browser evidence is separate. | Actual iOS18+ Safari and Android12+ Chrome current/previous stable, >=360px, native zoom/safe areas/keyboard and physical usability. |

Main should append (not rewrite history) the current source/time/test matrix,
the red full-root lint plus narrow-pass distinction, authorized concurrency and
the separate fresh build/browser receipts to verification/handoff/implement.
The root-lint evidence gotcha belongs in this task's continuation record; main
confirmed no shared-spec/configuration edit is needed or planned. Existing
mobile canvas/quality section 7 already covers source and evidence honesty.
Final documentation/evidence review can reuse this same agent. No mobile
spec-contract or product correction is otherwise required by this review.
Do not check MA boxes, archive, commit, enable production or claim rollout
readiness.
