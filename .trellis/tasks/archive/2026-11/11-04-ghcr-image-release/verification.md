# GHCR Release Verification

## Status

Delivery is verified at main `a8c2bc9b3d65fc6970fc895f109aec9728b10290`.
Run `41846433683`, attempt 2, passes CI, migrations, E2E and image publication.
Both images and latest aliases are public; independent anonymous metadata checks
and actual digest-pinned pulls passed. No production deployment or package
visibility change was performed. Final evidence is in `checks/hosted-publication.json`.

## Earlier Local And First Hosted Evidence

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

- AC1: The exact tested main SHA has both published linux/amd64 images with
  source/revision/license metadata, verified independently through anonymous OCI
  metadata and local digest-pinned Docker inspection.
- AC2: Local negative policy, serialization/guard, immutable-rerun and CLI output
  tests pass. Actual registry creation, digest identity and latest promotion are
  recorded for the successful hosted publication.
- AC3: Generation ordering/failure propagation and corrected shared TCP readiness
  are covered by focused tests and real isolated clean-start checks.
- AC4: Authenticated/anonymous isolation, private-public bootstrap and safe rerun
  behavior pass regressions. Both real packages are anonymously readable and
  pullable; this release needed no manual visibility change.
- AC5: Actual Compose merge, runtime parity and required selectors pass; update,
  backup, forward migration, readiness and rollback steps are documented.
- AC6: Independent review and local gates pass as listed. The first real hosted
  failure remains recorded; the corrected workflow and public registry/pull
  checks now pass. The task remains in_progress only because archive/extra
  bookkeeping commits are outside the approved delivery.

## Published Image Pair

Source tag: `sha-a8c2bc9b3d65fc6970fc895f109aec9728b10290`.

| Image | Verified digest |
| --- | --- |
| `ghcr.io/0401lucky/narra-image-app` | `sha256:53417173c98e66c2f8d0033a6501f305e8807b39c063f3efcd3f122eabf17be1` |
| `ghcr.io/0401lucky/narra-image-worker` | `sha256:e44d71c461529a61cad8b6ff55b27bc2fcc9b9797788b45696f586cc9c46b590` |

Both latest aliases matched these digests during the independent anonymous
check. Use the matching source-tag or digest pair for deployment; aliases are
not a cross-package transaction.

Hosted run: https://github.com/0401lucky/narra-image/actions/runs/41846433683

The first E2E attempt on this SHA hit Docker info's unchanged 10-second probe
deadline before scenarios. One failed-job-only retry passed with the same source
and guards; CI and migrations were not rerun or bypassed. The failed attempt and
retry request remain in the recorded evidence.

Independent public verification used no GitHub credentials and a fresh empty
Docker config, pinned to the verified local Linux daemon. Both digest pulls and
platform/source/license inspections passed in 84.248 seconds. Owned temporary
configuration was cleaned; downloaded public image cache is retained. No runtime
container, production database or provider operation occurred.

## Review And Deferred Risk

The reviewer found no in-scope production defect and added the missing mocked
CLI/bootstrap/output/rerun regression. Main's operations specs were reviewed and
two wording notes corrected. See `checks/review/review.md`.

The standalone worker-contracts DB runner retains a separate, pre-existing
socket-readiness risk outside the three publication gates. It was explicitly
deferred, not described as fixed by the shared helper. See
`checks/retrospective.md` for the root causes and prevention mechanisms.

## Delivery Gate

The original batch and separately approved fixture correction are delivered.
All three verification jobs, publisher and independent public checks have real
results. Future private-package cases still require owner setup and a safe rerun;
authenticated push alone never proves public access.

Local stdout/stderr and runtime snapshots are intentionally ignored by the
existing task policy. Versioned receipts/review reports retain their IDs, hashes,
exits, deadlines and local paths. No real dotenv, Docker credentials or runtime
database state is included in the candidate commits.

The original recovery/source checks are recorded in `checks/local-handoff.json`.
All 15 first-commit blobs were compared to reviewed working bytes (allowing only
Git line-ending normalization); all 31 machine receipt blobs in the second
commit retained exact bytes. The correction's 41 approved paths passed staged
whitespace/content checks, including 25 exact raw evidence blobs, before commit.
Post-publication task records are left local rather than creating an unapproved
extra commit/push and another release run. No force push, production operation,
archive or journal commit is included.
