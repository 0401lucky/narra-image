# Canvas Database Gate Completion

Date: 2026-10-30. Role: dispatched `trellis-implement`, database-gate ownership.
Active task: `.trellis/tasks/10-28-studio-canvas-v1`.

## Outcome And Safety

The three required database wrappers now pass against real runner-created local
PostgreSQL, not mocks or missing-image preflights:

- `pnpm verify:canvas-contracts:db`: full-history and previous-history-plus-canvas
  migrations, 32 passing SQL tests each (64 executions), and exact cleanup.
- `pnpm verify:worker-contracts:db`: immutable legacy snapshot plus all subsequent
  migrations, 6 passing TypeScript DB tests, tagged Go worker/gateway DB suites,
  and exact cleanup.
- `pnpm verify:migrations`: all five migration/pgx scenario groups and cleanup.

Execution began only after MAIN IMAGE READY. Main explicitly provisioned the
test images; this agent did not pull images. The read-only final audit independently
observed Docker 29.9.2 on `npipe:////./pipe/dockerDesktopLinuxEngine` and the local
PostgreSQL 17 Alpine image ID:

`sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b`

Every database is random, localhost-only, and hosted in an owner-labelled tmpfs
container with `--pull=never`. Docker commands pin the verified local endpoint
and use empty owner-checked config. Canvas/worker Prisma use explicit isolated
config. Legacy migration verification additionally uses the audited outer
environment/deny-env preload. No repository `.env`, real/development database,
real provider/S3, deployment, staging, commit, push, volume cleanup, parent task
activation, or mobile task activation is performed.

## Files Changed

- `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts`: five
  fixture SQL statements now explicitly cast shared string parameters to text.
- This report, `checks/db-gates-completion.md`.

No production service, schema, migration, published checksum, shared inventory,
Docker helper, or wrapper was changed. Existing dirty canvas and predecessor
history work remains intact. All task/spec documents other than this report
remain owned by main. No subagents were spawned.

## Actual Failures And Corrections

1. `db-complete-canvas-01` applies all 18 migrations and verifies exact migration
   names/checksums. Its actual catalogue/drift tests pass (9/32), but 23 remaining
   tests stop at fixture construction with PostgreSQL `42P08`, inconsistent
   parameter types. Reusing one untyped owner parameter for VARCHAR `ownerId`
   and TEXT `userId`/`storageBucket` produces incompatible inferred types.
2. Explicit text casts in the four owner fixture statements allow the real
   behavior to execute. `db-complete-canvas-02` passes 31/32 tests. Its one
   remaining failure is the same parameter ambiguity in the fixture-only raw
   `CanvasRun.originalJobId`/`liveJobId` update.
3. Casting that shared job parameter fixes fixture construction without changing
   what the deferred-root test asserts. `db-complete-canvas-03` passes all 32
   tests under both full and additive migration scenarios.

Both red attempts remain recorded and their exact containers were removed.
No assertion, guard, quota, lease, timeout, retention rule or expected business
error was relaxed; no test was skipped. The actual `canvas_raise` SQLSTATE
`23514` and its exact allowlisted mapper remain unchanged.

## Command Receipts

All labels refer to separate `<label>.json`, `<label>.stdout.log` and
`<label>.stderr.log` under:

`C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea/react-flow-spike/logs/`

The wrapper is the verified portable Node 24.22.1 `safe-run.mjs`, test mode,
with pnpm 10.32.1 and Go 1.25.14. JSON receipts contain full argv, cwd, deadline,
actual exit status and duration. These new receipts do not rewrite prior
`checks/resume-2026-10-30` evidence.

| Label | Check | Actual Result | Outer Deadline |
| --- | --- | --- | --- |
| `db-complete-canvas-01` | Canvas DB, original fixtures | Exit 4; 9 passed / 23 failed; 9.397s | 390s |
| `db-complete-canvas-02` | Canvas DB, owner casts | Exit 4; 31 passed / 1 failed; 13.414s | 390s |
| `db-complete-canvas-03` | Canvas DB, final fixtures | Exit 0; 32 full + 32 additive; 19.332s | 390s |
| `db-complete-worker-01` | Worker DB | Exit 0; TS 6 + Go DB suites; 13.236s | 90s |
| `db-complete-migrations-01` | Migration scenarios | Exit 0; all 5 groups; 43.773s | 270s |
| `db-complete-unit-01` | Contract/schema/runner/Docker/HTTP unit tests | Exit 0; 5 files / 85 tests; 1.967s | 120s |
| `db-complete-lint-01` | ESLint on changed DB test | Exit 0, no warnings; 2.609s | 120s |
| `db-complete-types-01` | Full `tsc --noEmit --incremental false` | Exit 0; 9.693s | 120s |
| `db-complete-cleanup-audit-01` | Read-only pinned Docker and scratch audit | Exit 0; 0.928s | 35s |
| `db-complete-diff-check-01` | `git diff --check` | Exit 0; LF/CRLF advisory warnings only; 0.106s | 60s |

Internal deadlines remain unchanged: canvas 360s with 20s cleanup reserve;
worker wrapper 57s (actual nested run 12.790s); migrations 240s with 15s cleanup
reserve. No longer DB gate was nested beneath another short verification gate.

The Go invocation selects `TestWorkerContractsDB` and `TestGatewayDB` with build
tag `workercontractsdb`, `-count=1` and `-timeout=50s`. Its package reports success
in 1.093s. The non-verbose receipt does not enumerate individual subtest counts.

## Positive SQL And Migration Coverage

Canvas full-history scenario deploys and checks all 18 exact migration
names/checksums. Additive scenario deploys the complete 17-migration preceding
history, seeds a retained legacy job/image, then applies only canvas. It checks
all 18 receipts and verifies that the legacy job remains contract version 0,
handoff NULL, with its original image URL.

The 32 tests in each real database exercise:

- Actual PostgreSQL catalogue conformance; disabled/missing triggers,
  constraints/indexes/defaults, function replacement/default drift and a lone
  carriage-return change all fail readiness as expected.
- Database-clock upload/preparation leases and fixed elapsed seven-day grace
  across DST; orphan/detach/reattachment eligibility and saved roots.
- All disconnected originals in a captured snapshot; exact save receipt replay,
  revision versus metadata changes, CAS conflicts, concurrent saves, tombstone
  fencing, foreign ownership and fabricated accepted-run rejection.
- Concurrent live-shell/upload quotas plus retained uncertain physical-byte and
  object-count accounting; rejected excess does not silently release quota.
- Save-before-GC and GC-before-save outcomes, actual asset-lock blocking and
  post-wait preparation-expiry rejection with rolled-back job/debit/roots.
- Same-run replay, changed-intent conflict, separate-run node admission races,
  canonical PENDING/PROCESSING admission, takeover tokens and deferred exact
  committed-root verification.
- One transaction for job/root/debit, replay without another durable job/charge,
  and permanent submitted roots through canvas, job and user deletion, including
  completed and failed jobs; retained principal/key/original-job inventory.
- Stale uploads, immutable keys, versioned quarantine, nullable JSON enum
  rejection, delete retry/backoff/stale finalizers and singleton sweep fencing.
- Late version receipts in DELETING/DELETED states, accounting preservation,
  ambiguous late-PUT reconciliation, and exact registered-key deletion against
  an in-memory storage adapter. Legacy/generated fake keys remain untouched.

Worker DB setup verifies the immutable 13-migration legacy prefix and deploys
the complete five-migration tail: worker contract, media metadata, ban,
moderation and canvas. Its before/after checksum sets match without editing
published SQL or baseline receipts. TS covers legacy writer defaults, missing
handoff rejection, old-finalizer guard, zero-credit handoff, attempt ordinal
uniqueness and additive media metadata. Real Go DB suites cover topology locks,
claim/writeback/stale ordinal, retry/UNKNOWN/refund behavior, media/backfill,
prompt synchronization and gateway ownership/enqueue/query/wait behavior.

Migration wrapper creates four independent databases and completes five groups:

1. Empty database: all 18 migrations deploy and status/count checks pass.
2. Existing 17-migration schema without history: ordinary deploy exits 2;
   digest-bound inspect and explicitly sentinel-authorized baseline apply then
   deploy canvas; final Prisma schema diff exits 0. Expected pre-canvas diff
   exits 2, rather than being mistaken for final schema equality.
3. Missing initial prehistory receipt: ordinary deploy exits 2 and does not
   silently restore it. Explicit digest/identity/schema-bound prehistory apply
   restores only the approved missing receipt; deploy/status then pass.
4. Synthetic failed migration: ordinary deploy exits 2; checksum, finished and
   rolled-back fields remain unchanged before/after refusal.
5. Go rollback preflight successfully connects using the generated URL with
   encoded special-character credentials and Prisma schema normalization.

All baseline/prehistory/failed-history mutations above occur only in the
wrapper's disposable fixture databases, never an application database.

## Cleanup And Frozen Identity

The successful wrappers require cleanup success in their final exit code.
Canvas/migration logs additionally preserve these acknowledged full container
IDs, verified exact name/owner, `rm --force <ID>` without volumes, and a final
empty exact-name lookup:

| Receipt | Exact Container Name | Removed Full ID |
| --- | --- | --- |
| Canvas 01 | `narra-canvas-contracts-c67ab4673f00b7a6` | `d679f2d836cf25e431c085fccc53a5c5bb4062f12c492ea978e726e9c1d780df` |
| Canvas 02 | `narra-canvas-contracts-e5be47443463b0ee` | `804b48a2edb63fb4f132a256df27044df781119ce8cb4528fd58f47c8ada5bcf` |
| Canvas 03 | `narra-canvas-contracts-7de6e1f9c65db67a` | `b6b9951f6ce0c459e7fc35db9251934a8ceb8835f323f264e849ceaeeea3ab8a` |
| Migrations 01 | `narra-migrations-pg-96cce06922612762` | `52c20da53896db3cb51001d3f385776dd042ae9d33fae74ddd1802e909732a78` |

The successful canvas owner is `dc746ca6-411f-474b-86a6-5bd74b31da1d`;
migration owner is `2cd190b3-6583-4c5e-bd68-d903be6ecb33`. Worker database is
`worker_contracts_b44be62164559b30`. Its runner verifies exact container identity
and absence internally but does not print the container ID; no ID is invented
for this report.

The independent read-only audit finds zero remaining containers for
`com.narra.canvas-contracts.owner`, `com.narra.worker-contracts.owner` and
`com.narra.migrations.owner`. It also verifies that all ten scratch paths
present in these receipts are absent. The audit itself creates only a verified
empty Docker config and removes that exact owned scratch; it does not remove
any container, image, network or volume, nor inspect/alter peer E2E resources.
Receipt-unprinted scratch paths are covered by the wrappers' own checked
cleanup, not claimed as individually enumerated by the audit.

Frozen SHA-256 values after the last source edit and all checks:

- Changed DB test: `90bce42946f64e773bf3c93cc5b523b2e315f474ca7074c6131b21bcfc758c68`.
- Unchanged canvas migration: `1247ec0bb7985a465028e4e05abb0b0ffa6ce80e964d57b37351c2943c3513f4`.
- Unchanged shared schema inventory: `e69179542807fd6ecf8899df831ee5be5e90074b2b8a9489b5c455cc204da254`.

## Remaining Handoff

These previously missing database acceptance gates are now complete. This report
does not replace peer-owned enabled embedded/dedicated/managed-GC E2E execution
or main's fresh independent final Trellis review and archive decision. It also
does not claim authenticated full-app, real provider/S3, physical-phone or
OS-native IME testing. Database tests use synthetic accounts/jobs and raw SQL;
their fake-storage checks are distinct from actual Worker HTTP object-store
topology tests. No new deployment or feature-enable permission is implied.

Main may copy these new raw receipts into the final task evidence and update
the acceptance/spec/handoff documents. The implementation source is frozen for
independent review; no remaining DB code fix is known from actual execution.
