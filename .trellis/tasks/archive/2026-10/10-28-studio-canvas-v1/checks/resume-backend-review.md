# Resumed Backend And Runtime Review

Date: 2026-10-30. Role: fresh `trellis-check`, backend/runtime ownership.
Active task: `.trellis/tasks/10-28-studio-canvas-v1`.

This is a source and isolated non-DB verification report, not completed canvas
acceptance or deployment authorization. The existing dirty canvas/history patch
is preserved. No staging, commit, push, image pull, production build, actual
DB/migration/E2E wrapper, real provider or real object-store operation was run by
this reviewer. The main session owns browser/build and guarded infrastructure
preflights. No subagents were spawned.

## Findings (fixed)

### 1. SQL guard errors bypassed the public business-error and rollback boundary

- File: `src/lib/canvas/transactions.ts:28`.
- Issue: `canvas_raise` in the new migration emits SQLSTATE `23514`, while the
  mapper recognized only `P0001`. Earlier mocked errors also used `P0001`.
  Actual quota/revision/owner/fence failures therefore bypassed the expected
  stable response. The generation route treated a known final fence rollback
  as uncertain acceptance (202), and a nonexistent/foreign canvas also returned
  202 instead of the expected 404.
- Fix: accept `23514` and retain `P0001` compatibility only when the complete
  error message exactly equals an allowlisted `CANVAS_*` code. Unknown check
  violations, private SQL details, connection errors and ambiguous commits
  remain outside that mapping. Retry classification is unchanged.
- Regression: `src/tests/unit/helpers/canvas-sql-error.ts` extracts the actual
  SQLSTATE from the migration named by the schema fixture; tests no longer
  invent that state independently. `canvas-http.test.ts` exercises the real
  Prisma/pg adapter's raw and CRUD error wrappers with a fake driver that never
  connects. `canvas-generate-route.test.ts` covers the raw/adapter final fence,
  owner/not-found and queued-delete replay paths without duplicate durable jobs,
  debits or legacy compensation. Unrelated 23514 details remain safe 500s.
- Evidence: `resume-back-sqlstate-red` reproduces seven failures; the narrow fix
  passes `resume-back-sqlstate-green` (2 files / 88 tests). The migration and its
  shared body/migration fingerprints are unchanged.

### 2. DB runners could follow a remote or changed Docker context

- Files: `scripts/lib/disposable-postgres.mjs`,
  `src/tests/integration/worker-contracts/postgres-runner.ts`.
- Issue: both PostgreSQL paths checked Docker CLI/daemon/image availability but
  inherited the active context and process environment. They did not establish
  a local endpoint or pin subsequent creation/cleanup. The shared helper is used
  by the new canvas DB wrapper and the legacy migration verifier. E2E already
  had the stronger local-endpoint policy, but that policy was not shared.
- Fix: extract the existing E2E OS-environment, local unix/npipe endpoint and
  owner-checked scratch implementation into `scripts/lib/local-docker-safety.mjs`.
  `LocalDockerSession` permits only context inspection until a local endpoint
  is verified, pins subsequent commands through `--host`, and requires an empty
  runner-owned Docker config before container operations. Local image failure
  precedes scratch/container creation. Ambient Docker/context/proxy/auth/provider
  configuration is not copied into container commands. Config ownership and
  realpaths are checked before use and before exact scratch cleanup.
- Fix: route every shared-PG Docker invocation and the standalone worker
  runner's central command boundary through that session. E2E retains its public
  exports and uses the same extracted validators/workspace helpers. Container
  cleanup checks full ID, exact name and owner label, preserves the originally
  acknowledged ID, removes only that ID, and no longer passes `--volumes`.
  Failed container cleanup retains the pinned config for safe retry.
- Regression: `src/tests/unit/local-docker-safety.test.ts` uses only fake command
  transport. It covers remote/invalid endpoints, mutation before pin/config,
  changed context/environment after probing, hostile ambient fields, modified
  config, unowned scratch/containers, exact no-volume cleanup and the standalone
  worker runner's real command-preparation boundary. Existing E2E and canvas
  runner regressions also pass.
- Evidence: `resume-back-docker-red` reproduces three failures in the old shared
  PG path (remote preflight acceptance, unpinned probes and context-sensitive
  creation/cleanup); `resume-back-docker-green` passes 3 files / 55 tests.

## Findings (not fixed)

No additional confirmed code defect remains in this review's assigned scope.
Infrastructure acceptance remains unmet by this report; see the verification
boundary below rather than treating mocks or source inventories as live proof.

## Reviewed Scope

- Owner/CAS/tombstone/roots: all canvas document/import/run tables, lifecycle and
  deferred-root guards, sorted asset locking, save receipt replay, metadata CAS,
  quota serialization, nullable live user/job FKs, immutable original key/job
  inventory and additive migration/schema inventory. No published SQL changed.
- Input/API boundary: shared Zod scene/input/DTO schemas, counted bounded JSON
  and multipart parsing, upload declaration versus actual bytes/type/hash,
  upload-once registry-before-PUT protocol, lease quarantine, canonical result
  ownership, explicit-ID-only runtime resolution and stable safe errors.
- Generation compatibility: strict opt-in header before new body buffering;
  committed replay before current CAPTCHA/credit/provider/media checks; original
  immutable input and credentials fingerprint; same-transaction debit/job/run/
  input roots; expired preparation/final input-lock fences; ambiguous commit
  recovery; no deletion-induced cancellation/refund and unchanged legacy route.
- Retention/runtime: Node/Go shared location and lifecycle fixtures, raw bounded
  versioning envelope validation, late version receipts, exact registered-key
  deletion, DB-authoritative grace/leases/backoff, permanent submitted roots,
  one managed GC scheduler in `Worker.Run`, readiness/drain/topology fences and
  joined shutdown. Go ordinary tests, vet and build are green; no live SQL claim
  or real storage permission/capability was tested.
- Loading/release: owner/conversation keyset loading, no global canvas/chat
  fallback, schema/capability fail-closed probes, environment manifest consumers,
  enabled/disabled worker capability checks, new and legacy guarded runner
  dispatch, local Docker preflight/cleanup and retained-data migration boundaries.

## Verification

All execution uses the approved isolated Node 24.22.1 / pnpm 10.32.1 / Go 1.25.14
`safe-run.mjs`, test mode, dummy localhost port-1 application DB, isolated caches
and repository `.env` read guard. Every stage has its independent deadline.
The command argv, timeout, duration, exit code and stdout/stderr paths are stored
in `<label>.json`, `<label>.stdout.log` and `<label>.stderr.log` under:

`C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea/react-flow-spike/logs/`

| Label | Command / Scope | Result |
| --- | --- | --- |
| `resume-back-sqlstate-red` | HTTP + generate route regression before fix | Expected red: 7 failed / 81 passed; 2.415s |
| `resume-back-sqlstate-green` | Same targeted files after mapper fix | Pass: 2 files / 88 tests; 2.167s |
| `resume-back-docker-red` | Shared local-Docker + existing E2E runner tests | Expected red: 3 failed / 44 passed; 1.163s |
| `resume-back-docker-green` | Shared local-Docker + E2E + canvas runner tests | Pass: 3 files / 55 tests; 2.487s |
| `resume-back-core` | Canvas API/parser/storage/schema/env/readiness/contracts, scoped conversation and legacy parser/security tests; exact 18-file argv in JSON | Pass: 18 files / 486 tests; 9.525s |
| `resume-back-safety-final` | `vitest run local-docker-safety canvas-e2e-runner canvas-disposable-runner canvas-http canvas-generate-route` with exact paths | Pass: 5 files / 143 tests; 2.608s |
| `resume-back-worker-ts` | `pnpm verify:worker-contracts:ts` | Pass: 6 files / 32 tests; 3.068s |
| `resume-back-worker-go` | `pnpm verify:worker-contracts:go` (vet + ordinary worker tests) | Pass; 7.970s |
| `resume-back-go-all` | `go -C worker test -count=1 -timeout=50s ./...` | Pass; 7.341s |
| `resume-back-go-build` | `go -C worker build ./...` | Pass; 1.261s |
| `resume-back-release-tests` | `node --test scripts/tests/migration-safety.test.mjs scripts/tests/release-startup.test.mjs` | Pass: 10 tests; 0.952s |
| `resume-back-lint` | ESLint across owned backend modules and changed scripts/tests | Pass, no warnings; 5.142s |
| `resume-back-lint-final` | ESLint of final changed source/tests | Pass, no warnings; 3.090s |
| `resume-back-types-final` | `pnpm exec tsc --noEmit --incremental false` | Pass; 9.961s |
| Reviewer `git diff --check` | Current tracked worktree whitespace | Pass; normal LF/CRLF advisory warnings only |

An earlier `resume-back-types` run exits 2: new test/runner annotations needed
to account for Next's augmented `ProcessEnv`, and a separately owned frontend
regression had a narrowed-status comparison. Reviewer fixed only its own
annotations; main/peer handled the frontend file. Final types pass. Failed logs
are retained. Full-repository lint/non-DB suite and final production build are
coordinated by the main/frontend reviewer, not substituted by these scoped runs.

## Infrastructure And Spec Handoff

- Main reviewed and released the frozen local-Docker changes for its own guarded
  preflights. This reviewer does not claim that PostgreSQL migrations, actual
  catalogue SQL, save/enqueue/GC concurrency, remote deletes, or enabled
  embedded/dedicated topology cases passed. Previously missing local images and
  any new preflight result must be recorded by main separately. No image pull or
  real/development DB fallback is permitted to turn that gate green.
- `worker-contracts/postgres-runner.ts` and the new canvas DB wrapper use
  an explicit isolated Prisma config, injected runner URL, and the shared
  `disposableTestEnvironment` preload that denies local `.env` files. Correct the
  old worker-spec wording that required loading project `prisma.config.ts` and
  considered URL injection alone sufficient isolation.
- The legacy migration verifier still uses `buildDatabaseEnvironment` from the
  shared PostgreSQL helper, which spreads the caller environment and does not
  independently supply the canvas/worker deny-env preload. Its Docker boundary
  now uses the shared pin/config guard, but it must still be run through the
  approved outer isolation here. Do not describe every legacy verifier as
  independently `.env`-safe; that broader environment rewrite is not part of
  these fixes.
- Main owns spec edits. Requested sync: actual `23514` plus exact-code mapping
  (`P0001` compatibility), shared local-Docker pin/config/cleanup contract, and
  the precise worker/canvas versus legacy migration environment distinction.
- Canvas-v1 remains the only active task. No parent/mobile activation, whole-task
  completion, physical media purge, migration execution or rollout is implied.
