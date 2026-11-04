# GHCR Release Verification

## Status

Original release implementation and independent review are complete. Its source is based
on main `66a4d0273f9fd3229336945ed06d87d1995943dd`; the reviewed 12 product/docs/test
files are bound by `checks/review/review-final-source.json`, not by an invented
commit identity. Main's integration snapshot uses those same bytes.

Local production build and both Linux amd64 Dockerfile builds passed.
The approved two-commit batch was pushed normally to main at
`651f12af560db529ceb3f23c58ad230c2efdd044` after recovering the original session's
connection failure. First hosted run `41838299471` passed migrations/E2E, but
failed one CI fixture test, so the publisher was skipped. No registry
publication, package visibility change or anonymous image pull occurred.
See `checks/delivery-approval.md` and `checks/first-hosted-run.json`.
No production deployment is part of this task, and the earlier canvas task is
not modified or archived here.

## Local Evidence

| Check | Result | Receipt / Record |
| --- | --- | --- |
| Independent Node release/startup/migration tests | PASS, 32 tests | `checks/review/review-final-source.json` |
| Full non-DB Vitest | PASS, 144 files / 1,824 tests | `checks/review/evidence/20261104T093709-test-dae8ee.json` |
| ESLint | PASS, 0 errors / 9 existing warnings | `checks/review/evidence/20261104T094106-lint-ab81ce.json` |
| TypeScript | PASS | `checks/review/evidence/20261104T094150-types-d4b5ff.json` |
| Actual CI build stage (`prisma generate && next build`) | PASS, 24.806s | `checks/production-build-validation.json` |
| Clean-client negative then generate/tsc positive | PASS | `checks/clean-client-validation.json` |
| Clean-copy Prisma without DB/auth/APP_URL | PASS | `checks/clean-ci-no-db-generation.json` |
| Three fresh TCP-ready DB / immediate CREATE/query / cleanup cycles | PASS | `checks/tcp-db-ready.json` |
| Actual merged image-only Compose and both missing-selector negatives | PASS | `checks/compose-validation.json` |
| Parsed workflow guards, permissions, fixed checkout and ordering | PASS | `checks/workflow-validation.json` |
| Official action commit pins | Verified with public GitHub API | `checks/action-pins.json` |
| Isolation regression | PASS, 8 tests | `checks/isolation-selftest.log` |
| Receipt Git-byte and whitespace negative controls | PASS, 6 cases | `checks/receipt-attributes-validation.json` |
| App/Worker Dockerfiles and owner-verified image cleanup | PASS, linux/amd64, 293.418s | `checks/image-build-retry-validation.json` |
| Final current-source Node/lint recheck including candidate task helpers | PASS, 32 tests / 0 lint errors | `checks/final-source-rechecks.json` |
| Final parsed workflow and three fresh TCP DB cycles | PASS, reviewed source unchanged | `checks/final-workflow-tcp-validation.json` |

Host Node checks use pinned Node24.22.1, copied installed dependencies, a fresh
owner-marked snapshot and a credential-filtered environment before startup.
The exact CI build stage uses the copied installed pnpm10.32.1 and its actual
synthetic build environment. Next's two-worker limit is local-check-only;
production settings and timeouts are unchanged. Source hashes remain unchanged.

The first Docker attempt stopped before creating any build/container/network:
the existing 10-second local-daemon info probe timed out. A separate read-only
recheck returned Linux Docker29.9.2 in 0.308s. The unchanged retry passed with the
same helper/source/timeouts, without restarting Docker, pulling base images or
bypassing checks. The first failure remains in `checks/image-build-validation.json`.
Both final images were inspected as linux/amd64 and removed only after their
exact IDs/tags/owner labels matched. No application runtime containers or
production services were started. Public locked dependencies were installed
inside Docker's normal build stages; no host dependency install occurred.

The non-DB run excludes both sentinel DB suites and preserves existing React act
warnings. Actionlint is not installed and was not run. Host Go/full verify:ci,
the full migration matrix and deployment E2E are not claimed from these checks;
the authorized hosted workflow must still execute all three real gates.

## First Hosted Run And Correction

- Product commit `d530132` and task/evidence commit `651f12a` were pushed in the
  approved order. Remote main was verified against the exact local HEAD.
- Actual GitHub migrations and E2E passed. CI passed Node tests, generated
  Prisma, TypeScript and lint, then passed 1,823/1,824 Vitest tests.
- The remaining fixture dynamically imports auth/db environment validation
  before parsing JSON. It omitted synthetic AUTH_SECRET/DATABASE_URL; the
  credential-safe local runner had masked this dependency by providing them.
- The narrow fixture correction retains the real parser and media-type
  assertions, owns synthetic values locally and restores environment afterward.
  Its red/green/reversion evidence is under `checks/ci-followup/implementation/`.
- Independent checks in `checks/ci-followup/review/` pass: fixed and reverted
  source controls, originally absent/present environment restoration and a
  missing-cleanup negative control; 144 files/1,824 non-DB tests, 32 Node tests,
  lint (zero errors/nine existing warnings) and TypeScript. All test processes
  start without ambient AUTH_SECRET, DATABASE_URL or APP_URL. The original
  release's 15 product/spec hashes are unchanged; only the fixture source differs
  from prior build inputs, so those prior builds are not relabeled fresh builds.
- At this pre-push snapshot the correction is not committed or pushed. The user
  has now explicitly approved its delivery; a new hosted run remains pending.
  No public image availability is claimed.
- Run: https://github.com/0401lucky/narra-image/actions/runs/41838299471

## Acceptance Reconciliation

- AC1: Local Dockerfile/policy coverage is separate from the still-pending exact
  main SHA's hosted build and real GHCR image metadata.
- AC2: Local negative policy, serialization/guard, immutable-rerun and CLI output
  tests pass. Actual registry behavior still needs first-publication evidence.
- AC3: Generation ordering/failure propagation and corrected shared TCP readiness
  are covered by focused tests and real isolated clean-start checks.
- AC4: Authenticated/anonymous isolation, private-public bootstrap and safe rerun
  behavior pass mocks. Real package permissions/public availability are pending.
- AC5: Actual Compose merge, runtime parity and required selectors pass; update,
  backup, forward migration, readiness and rollback steps are documented.
- AC6: Independent review and local gates pass as listed. The first real hosted
  run is recorded as failed/skipped; a successful corrected workflow and public
  registry results remain pending. The task stays in_progress.

## Review And Deferred Risk

The reviewer found no in-scope production defect and added the missing mocked
CLI/bootstrap/output/rerun regression. Main's operations specs were reviewed and
two wording notes corrected. See `checks/review/review.md`.

The standalone worker-contracts DB runner retains a separate, pre-existing
socket-readiness risk outside the three publication gates. It was explicitly
deferred, not described as fixed by the shared helper. See
`checks/retrospective.md` for the root causes and prevention mechanisms.

## Delivery Gate

The original approved batch is delivered. The separate fixture correction batch
in `commit-plan.md` is now approved; commit/push normally and track all three
verification jobs plus publisher to their real outcomes. If
GHCR creates private packages, report the exact Public settings and retain SHA
tags; after owner setup rerun the failed publication job and confirm anonymous
digest/platform identity. Never infer a public release from authenticated push
or an atomic deployment pair from two independent latest aliases.

Local stdout/stderr and runtime snapshots are intentionally ignored by the
existing task policy. Versioned receipts/review reports retain their IDs, hashes,
exits, deadlines and local paths. No real dotenv, Docker credentials or runtime
database state is included in the candidate commits.

The original recovery/source checks are recorded in `checks/local-handoff.json`.
All 15 first-commit blobs were compared to reviewed working bytes (allowing only
Git line-ending normalization); all 31 machine receipt blobs in the second
commit retained exact bytes. The correction index remains empty. Its staged
whitespace/blob verification must run after follow-up approval. No force push,
production operation, archive or journal commit is included.
