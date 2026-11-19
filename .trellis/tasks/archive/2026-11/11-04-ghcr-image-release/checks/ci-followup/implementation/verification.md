# Hosted CI Fixture Follow-up

## Source And Correction

- Baseline main: `651f12af560db529ceb3f23c58ad230c2efdd044`.
- The only application-tree change is
  `src/tests/unit/canvas-e2e-runtime-fixture.test.ts`: suite-local `beforeEach`
  stubs synthetic `AUTH_SECRET` and a deliberately unavailable loopback
  `DATABASE_URL`; `afterEach` restores the original values with
  `vi.unstubAllEnvs()`.
- Baseline fixture SHA256:
  `2d7b585870c2ab7a9f953138c8b6d1b182736690d5cd0f81a0354c0e5b4f1748`.
- Corrected/frozen fixture SHA256:
  `c76bb69cd11c903ff73c0e7c9bd32dae245d0c9bca369d2f4ae1c09ee3e22ac1`.
- The actual parser import, duplicate JSON media-type rejection and successful
  relayed JSON parsing assertions are unchanged. No production logic, workflow
  environment, shared test defaults, timeouts or dependencies change.

The opt-in branch of `parseGenerateRequest` dynamically imports `canvas/http`,
which imports `server/current-user`, which imports `db`. Module evaluation calls
`getEnv()` before `readCanvasJson` can reject the duplicated media type. The
fixture therefore needs valid configuration even though it performs no database
query. Its existing missing prerequisite reproduced the hosted failure exactly.

## Isolation And Reproduction

Main assigned the idle owner-marked snapshot
`checks/.runtime/release-integration-5781d68e/app`. The audited launcher refreshed
it from current source before both the baseline and corrected runs. It reused
the snapshot's separately copied dependencies/generated Prisma client; no
installation, new client generation, database, provider or registry operation
was performed for this follow-up.

`run-isolated-check.py` reuses `isolated.py`/`isolation_base.py` without changing
them. Its process-local environment adapter removes both `AUTH_SECRET` and
`DATABASE_URL` before the pinned Node24.22.1 process starts. The OS allowlist,
synthetic home/temp, original dotenv-deny preload, exact public `.env.example`
exception, dependency-link audit, owner lock and bounded process cleanup remain
active. `NODE_ENV=test`; build-only `APP_URL` is absent. Each receipt lists actual
child environment keys rather than claiming absence from a test stub alone.

Example reproduction (use a new receipt label):

```powershell
python .trellis/tasks/11-04-ghcr-image-release/checks/ci-followup/implementation/run-isolated-check.py --workspace <owned-app-snapshot> --stage fixture --label fresh-check --refresh
```

`--revert-fixture` is restricted to the focused fixture stage. It substitutes
the byte-exact `.before` file only in the owned snapshot, runs a fresh Node
process and restores the corrected snapshot bytes in `finally`. The worktree
source is never reverted.

## Actual Results

| Receipt | Result | Duration / Deadline |
| --- | --- | --- |
| `baseline-red.json` | Exit 1; 19 passed, the expected parser case fails with missing auth/database ZodError | 2.922s / 57s |
| `green.json` | Exit 0; all 20 fixture cases pass | 1.525s / 57s |
| `reverted-red.json` | Exit 1; the identical missing-variable failure returns; final snapshot bytes restored | 1.462s / 57s |
| `restored-related.json` | Exit 0; 101 tests pass across 5 related suites, including the restored fixture and env security | 3.595s / 57s |
| `lint.json` | Exit 0; `eslint .`, no errors, 9 pre-existing warnings outside this fixture | 14.735s / 180s |
| `types.json` | Exit 0; `tsc --noEmit` | 11.922s / 180s |

All processes finished within their deadlines. Source-before/source-after hashes
are unchanged. Only the deliberate reversion reports a snapshot modification,
and it names just the fixture. The restored related tests, lint and types all
bind the same corrected fixture hash and captured source identity. These checks
ran sequentially; the snapshot's active lock is released.

JSON records retain command, real exit, timing, environment key list, source
identity, source-manifest hash, launcher hash and raw receipt/log hashes. Exact
stdout/stderr remain in the owner-marked runtime receipts and ignored local
copies. They were not whitespace-normalized or relabeled as new execution.
The small local `.gitignore` excludes only these verbatim output copies, not
source, authored notes, the repro helper or JSON evidence.

`final-audit.json` verifies all six raw receipt/log hashes and that the snapshot's
dotenv guard matches the audited source. `git diff --check` and the read-only
cached check return 0; explicit no-index whitespace checks cover new evidence
without staging it. The first audit evaluator mistakenly required exit 0 from
an added-file no-index comparison. Its receipt is preserved; ordinary-file,
trailing-space and blank-EOF controls confirm normal difference exit 1 versus
whitespace-error exit 3. The corrected evaluation reports no whitespace errors.

## Handoff Boundaries

Source is frozen and heavy checks are idle. Independent full non-DB Vitest and
Node release regressions remain the checker's gate. This local correction is not
a hosted rerun, GHCR publication or deployment verdict. No staging, commit, push,
real credential read/change, production operation or other task edit occurred.
