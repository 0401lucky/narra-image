# Independent Long-URL And Final Task Review

- Reviewer: `long_url_check` (`trellis-check`), 2026-11-01.
- Status: Source review complete with no further gallery defect found;
  fresh browser and coordinator gate verification remain in progress.
- Scope: Approved gallery-only 8192-byte encoded request-target policy and
  complete-copy/manual-paste fallback, plus independent closure of the prior
  full-task review. The coordinator additionally assigned the narrow ESLint
  task-evidence scope correction; no gallery or Git edits by this reviewer.
- Ownership: Browser helpers, finite synthetic DB fixture cases, their new
  evidence, this report and the exclusive `hero-hit-independent-8725c17e`
  runtime, `eslint.config.mjs` and `src/tests/unit/eslint-scope.test.ts`.
  Gallery product work belongs to `long_url_impl`; full unmodified-source
  gates, specs and Git delivery belong to the coordinator.

## Context And Baseline

Read the complete saved role context, task PRD/design/implementation plan,
check manifest and referenced frontend/privacy/lifecycle/isolation research.
Read `independent-review.md`, `asset-delivery-independent-review.md` and
`final-continuation-review.md`. Their missing-image/hero/reveal findings are
historical and must be tied to exact newer source/evidence before closure.

The supplied starting lineage is `long-url-20261101-source-baseline.json`,
807 product/test/static inputs, the 1633-test receipt and the unfiltered
`full-1793496819932` 88-check browser result. The earlier 43 raw privacy
checks, five actual-image widths, six motion groups, H10 native hero actions,
K1 ordinary hover calibration and M7 interrupted reveal remain required.
No failing history is deleted or converted into a pass.

## Findings (Fixed)

- File: `eslint.config.mjs`, `src/tests/unit/eslint-scope.test.ts`.
  Issue: Root `eslint .` treated retained Trellis generated/vendor fixtures
  as application source; a source-only isolated lint pass did not establish
  commit-inclusive root lint. Fix: add only `.trellis/tasks/**` to the existing
  global ignores. Nine real `ESLint.isPathIgnored()` cases exclude current,
  archived and runtime task examples while keeping app/components/tests,
  production scripts/fixtures and non-task Trellis tooling in scope.
  Independent probe RED `20261101T023433-script-5fa1eb` finds exactly the
  three missed ignores; GREEN `20261101T023503-script-17604b` passes all nine.
  Pinned-Node focused suite `20261101T023603-test-2c33ef`: 9/9 pass, exit 0.
- Files: `browser/long-url-checks.mjs`, `browser/long-url-contract.mjs`,
  `browser/fixtures/db.ts.fixture`, `browser/prepare-fixture.mjs`.
  Issue: Existing raw URL probes did not exercise approved gallery fallback.
  Fix: add a finite opt-in `long-url` mode through the actual public DTO,
  Home and gallery, preserving all ordinary rows/permissions/routes. New
  checks cover total encoded budgets, full original copy/selection, keyboard
  and touch controls, denial/absence, promptless login/studio and no writes.
  Turbopack rejects lone-surrogate strings in imported JSON; the first fixture
  build RED `20261101T024055-build-73445f` is retained. Store finite numeric
  UTF-16 units in test config and reconstruct exact strings at the synthetic
  DB boundary, without normalizing product text or changing the bundler.
  The corrected fixture build `20261101T024302-build-900722` passes (20.236s).
- File: `browser/long-url-checks.mjs` (new helper only).
  First focused browser run `home-1793501011855` / receipt
  `20261101T024331-script-ee48ab` passes 15/16 checks, with L2 native Tab
  traversal red and the Chinese entry classification still unresolved.
  The new traversal sent rapid keys without awaiting observable focus-open
  drawer state. Add a bounded wait for expanded, non-inert, visible and
  transition-complete drawer plus full native traversal trace. No product
  focus/click, CDP input rewrite or threshold relaxation is used. Fresh
  focused run `home-1793501646724` / `20261101T025406-script-455996` passes
  all 16 checks (62.079s / 600s), including the calibrated keyboard member
  case on unchanged product; no unresolved entry remains in that run.

## Independent Source Review

`browser/evidence/long-url-independent-source-review.json` independently
compares all 807 baseline inputs with all 809 current inputs. Exactly four
existing files change (card, gallery constants, the existing gallery test and
ESLint config); two regression files are added. All other 803 prior inputs,
including privacy, create/auth/drafts/canvas, assets, fonts, CSS, motion,
header, dependencies and runtime configuration, remain byte-identical.
The separate `browser/evidence/long-url-full-review-lineage.json` verifies
the complete earlier independent 802-input lineage: nine changed files,
seven additions, zero missing inputs; the extra historical deltas are only
the documented actual assets/constants, local hero CSS and reveal/tests.

- New gallery path: permission must be strictly true and raw text nonblank;
  trim is only a usability predicate. The full original string is encoded
  once, prefix included, with `<= 8192` allowed. Encoding exceptions/overage
  use full-copy/manual-paste, never a rewritten or truncated query. Guests
  also cannot receive an oversized prefill href. The complete readonly text,
  copy and ordinary `/create` or `/login` link identify the explanation via
  `aria-describedby`; >8000 manual input truthfully advises shortening.
- Regression scope: independently read all 62 new fallback cases and the
  preserved old gallery case change. Boundaries 8191/8192/8193, reserved/
  whitespace/uncombined Unicode, Chinese/emoji, malformed surrogates,
  guest/member, false/missing/blank, refused/absent/timed-out Clipboard,
  keyboard and no request/navigation/storage side effects are asserted.
  Existing valid 8000/8001 ASCII behavior remains covered.
- Full-scope lineage: re-read actual Home bootstrap, public featured/detail
  projections, work access gate, paging/like/clipboard hooks and scalar
  reveal cleanup, in addition to the earlier independent reports. The
  eleven-field public detail allowlist follows the access gate, excludes
  internal review data, and nulls both hidden prompts without mutating owner
  data. Featured initial/API paths share explicit permission. Paging keeps
  its synchronous cursor-before-unlock, 16/72 caps, deduplication, bounded
  fetch/body and epoch guards; likes retain actual ACK/401 behavior.
- Auth/mode boundaries remain unchanged: no added auth continuation,
  cross-route store, query consumer, forced mode, draft synchronization,
  node import, conversation or generation write. Saved canvas/manual-chat
  compatibility is tested without reviewing unrelated canvas implementation.
- Spec assessment: the coordinator's additive `homepage-interactions.md`
  encoded-budget/manual-path contract and `quality-guidelines.md` task-lint
  scope match the source. No platform template/update/detection touchpoint
  is introduced. Prior hero stacking/phone composition and guarded scalar
  reveal remain intact; the unfiltered browser matrix must reverify them.
  The later OOM guidance preserves red receipts, serializes heavy stages and
  limits only test worker concurrency; it does not skip tests or raise product
  memory limits. `ARTIFACTS.md` accurately distinguishes retained local raw
  captures/absolute-junction snapshots from reproducible checked-in evidence.

## Findings (Not Fixed)

- No further production defect found in the completed source review.
- The direct oversized Chinese/emoji URLs still return HTTP 431; the approved
  gallery fallback independently passes the focused matrix. They are
  transport observations, not successful direct navigation. The complete
  unfiltered browser gate is running; final sign-off awaits its result.

## Verification

- Lane preflight: resolved direct task-owned app, no active lock and no
  matching live owned Node/Chrome/Python processes; receipt
  `browser/evidence/long-url-lane-preflight-20261101.json`.
- Tests: independently read coordinator receipt
  `20261101T024629-test-bounded-8995a2` and complete logs: 140 files / 1704
  tests pass on pinned Node24.22.1, exit 0, 122.088s / 900s, unchanged 809
  source/snapshot/live identities. Scheduling uses two workers and unchanged
  30s per-test timeout; no case is removed. The preceding parallel-worker OOM
  remains red. A subsequent Python console GBK encoding failure occurred only
  while printing already-saved output; its nonzero orchestration exit is
  separately retained in `long-url-final-bounded/console-reporting.json`.
- Lint: pass (`20261101T025018-lint-d9d51a`, 0 errors / 9 prior warnings),
  including 31 candidate metadata/tooling inputs in the sanitized checkout.
- TypeCheck: pass (`20261101T025051-types-a1cfbb`, exit 0).
- Offline Prisma: pass (`20261101T025115-prisma-no-network-233457`), copied
  installed client generation only; not a database migration.
- Unmodified production build: pass (`20261101T025135-build-0b2d77`,
  22.891s / 600s, exit 0); no browser DB replacement enters that build.
- `browser/evidence/long-url-independent-automated-verification.json`
  independently verifies all five receipts, full stdout/stderr byte identity,
  the common 809-file manifest, every source-before/source-after identity and
  current live source. These are coordinator-executed gates, not duplicated
  reviewer commands. All five have zero source/snapshot/live drift.
- Browser: helpers/product frozen, rebuilt fixture
  `20261101T025336-build-9d1c4f` passes, then focused 16/16 passes. The full
  103-case matrix is running without a filter and with a separate 900s bound.
  Old receipts are not used as new-revision verification.
- Exact independent probe/build/browser receipts and logs are copied into
  `validation-evidence/long-url-independent/`; its promotion manifest records
  all byte hashes, including retained red runs. Browser-build snapshot
  differences from the older G0 capture are intentional and enumerated;
  actual fixture production/replacement manifests and browser identities,
  not a claim of an unmodified fixture, establish the tested source.
- Runtime: early probe receipts use 24.11.1 and are not relabeled. The
  coordinator located an already-installed 24.22.1 binary; I independently
  verified SHA-256 `d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5`.
  Upcoming final fixture/gates explicitly select it via the sanitized runner.
- Limits: actual Next/React/Chromium with finite synthetic DB/auth fixtures
  is not live-service E2E,
  physical mobile/native IME, actual CI or deployment acceptance.

No live dotenv, DB, provider/storage service, personal browser profile,
runtime/dependency download, image request, deployment or Git mutation is
authorized or used by this review.
