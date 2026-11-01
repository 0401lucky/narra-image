# Parent Integration DB Implementation

Date: 2026-10-30. Active task: `10-28-studio-dual-mode-canvas`.

Status: implementation and fresh lint/types PASS; required full/additive SQL
execution is UNMET. All three authorized attempts stopped at local Docker daemon
preflight, including the one fresh attempt after the user's continuation.
No SQL assertion ran, and the archived child's 64-case result does not verify
these additions. This report does not authorize parent archival.

## Changed Files

- `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts`: 340 added
  lines, zero removed (462 -> 802 lines), five additional parameter-expanded
  cases. All original 462 lines/32 cases remain unchanged: removing only the
  additions in memory reconstructs the exact parent baseline SHA-256.
- `.trellis/tasks/10-28-studio-dual-mode-canvas/checks/integration-db-implementation.md`:
  this implementation/evidence report.

Test-file baseline SHA-256:
`90bce42946f64e773bf3c93cc5b523b2e315f474ca7074c6131b21bcfc758c68`.
Test-file final SHA-256:
`c11543353646b5d61c4ec1170d02eecc9de4669774b9702f4b58e4b95da0c31c`.

No product, runtime, provider, dependency, schema, migration, harness, archived
child, or main-owned evidence file was changed. No staging/commit/deployment or
mobile work occurred. The index remains empty.

## Added Coverage

These are implemented assertions, not passing DB results:

| New Case | Source | Assertions |
| --- | --- | --- |
| `restores every old-conversation page despite 65 newer canvas runs and 65 orphan jobs` | `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts:547` | 75 old jobs restored as 50 + 25 by the production loader and GET handler; equal-time ID ordering, immutable creation cursor despite updatedAt changes, repeatable second page, exact completeness, canonical image DTOs and private-field exclusion. Actual committed canvas ledgers displace all old jobs from global latest 50; sibling and foreign/mismatched-owner rows cannot enter the conversation. Synthetic credits start at 1,000 and must equal 675 after 65 real fixture commits. |
| `rejects foreign/missing parents and owner/parent/canvas cursor reuse without global fallback` | `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts:625` | Production queries/handlers return 404 for unavailable parents, 400 for cross-owner/parent/scope cursors, empty content for an owned empty conversation, and 401 for fixture-anonymous access. Cursors originate from the real production readers. |
| `keeps conversation jobs/images in production owner works after DELETE with no cancel/refund/credit changes` | `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts:667` | Actual conversation DELETE detaches only conversationId across pending/processing/success/failed jobs. Complete before/after job/image rows and both owners' credits are checked. Actual listUserWorksPage and works GET return retained own images; foreign organization/work DELETE is rejected, and another account's cursor/userId query cannot expose own works. Subsequent conversation reads/deletes do not recreate organization. |
| `retains works and run roots after production canvas deletion during PENDING, without resurrection` | `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts:727` | Production deleteCanvas transaction tombstones organization/removes saved roots but preserves complete jobs/images, credits, committed run ledgers and job-input roots. Foreign owner reads/deletes fail. A later synthetic transactional completion appears through real works readers without recreating the canvas; create replay fails and delete replay remains idempotent. |
| `retains works and run roots after production canvas deletion during PROCESSING, without resurrection` | `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts:727` | The same retention/retrieval/tombstone assertions while the submitted job is processing. |

Declared matrix: 37 cases per history (32 preserved + 5 new), 74 across full and
additive. Actual execution across these attempts: **0 full / 0 additive cases**
because every wrapper attempt failed before database creation and Vitest invocation.

## Production And Fixture Boundary

- Only `getCurrentUserRecord` / `requireCurrentUserRecord` are fixture-mocked at
  `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts:15`.
  Signed-in records are read from the real Prisma client for synthetic owners.
  This is not real session-cookie authentication or browser login evidence.
- Production imports are deferred until after the validated runner URL and live
  `_canvas_contracts_owner` token check. The application Prisma client's own
  sentinel query must match pg at
  `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts:200`.
  Prisma is disconnected in teardown; the original pg cleanup remains intact.
- The test uses the actual conversation loader/GET/DELETE, works loader/GET and
  foreign works DELETE handler. Canvas deletion uses the actual deleteCanvas
  service/transaction/SQL, not its HTTP feature gate. DB results, deletion logic
  and works queries are never mocked or fabricated.
- Job/run/media setup and the post-delete completion are synthetic fixture
  writes in the sentinelled disposable DB. Existing guarded reserve/commit/save
  helpers are reused. Completion is one real Prisma nested-write transaction,
  not a Worker/provider run. No asset object is fetched or deleted; storage
  URLs/keys are synthetic. This does not replace existing worker/runtime or
  real-object-storage evidence.
- No feature env override, dotenv read, real DB/S3/provider credential, billable
  generation, Docker image pull, daemon repair, or cleanup bypass was used.

## Fresh Commands And Receipts

All commands ran through the inspected existing `safe-run.mjs` in `test` mode,
using Node 24.22.1, the prepared pnpm toolchain, filtered environment and dotenv
deny preload. No command inherited a real database/service configuration.

Receipt directory:
`C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea/react-flow-spike/logs`.
Each label has retained `.json`, `.stdout.log`, and `.stderr.log` files there.
Main owns copying these original receipts into its acceptance evidence directory.

| Label | Payload | Deadline | Result / Actual Duration |
| --- | --- | --- | --- |
| `parent-db-types-01` | `pnpm exec tsc --noEmit --incremental false` | 180,000 ms | PASS, exit 0, 10,285 ms. |
| `parent-db-lint-01` | `pnpm lint` | 180,000 ms | PASS, exit 0, 13,136 ms; 0 errors and the 9 existing warnings outside the owned file. |
| `parent-db-contracts-01` | `pnpm verify:canvas-contracts:db` | 420,000 ms | UNMET/preflight, exit 2, 24,561 ms. Local daemon info child timed out, exit 124, 21,762 ms. |
| `parent-db-contracts-02` | `pnpm verify:canvas-contracts:db` | 420,000 ms | UNMET/preflight, exit 2, 1,504 ms. Local daemon info child exited 1 in 368 ms: Docker named pipe absent. |
| `parent-db-contracts-03` | `pnpm verify:canvas-contracts:db` | 420,000 ms | UNMET/preflight, exit 2, 1,386 ms. Local daemon info child exited 1 in 275 ms: Docker named pipe still absent. |

All three DB receipts report `signal=null` and outer `timedOut=false`; the first
timeout belongs to the bounded Docker preflight child, not the 420-second outer
deadline. The unchanged DB wrapper retains its 360-second deadline and
20-second cleanup reserve. The initial run had one bounded retry. After main
asked the user to restore Docker Desktop/Linux engine and the user requested
continuation, main explicitly authorized one new attempt (`-03`). That attempt
also failed preflight; no further retry or Docker repair was performed.

Additional read-only checks: `git diff --check` passes (Git reports existing
LF/CRLF notices); direct trailing-whitespace inspection passes for the owned
untracked test file. The in-memory baseline reconstruction described above
matches the parent source-baseline hash exactly. No test source changed after
the successful lint/type runs. The frozen final SHA-256 was verified again
before `parent-db-contracts-03`; only this report changes during the continuation.

## Infrastructure And Cleanup Evidence

All three attempts successfully resolved `desktop-linux` and pinned the local
endpoint `npipe:////./pipe/dockerDesktopLinuxEngine`. The first daemon probe
timed out; the second and third reported:

```text
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

All stop before local-image inspection, Docker scratch/config preparation,
container creation, Prisma workspaces, migrations, sentinel creation or SQL
tests. The existing wrapper's finally path therefore has no created resource
to remove (`creationAttempted=false`, no Prisma workspaces), and preserves the
preflight exit 2 rather than cleanup exit 8. This is a **pre-creation no-op
cleanup**, not evidence of successful positive container/scratch cleanup. No
broad enumeration/deletion, resource kill, daemon startup/repair or retry beyond
the separately authorized third attempt was performed.

## Findings And Follow-Up

- No confirmed product defect was found in the scoped source inspection. The
  new assertions are still unexecuted and can reveal fixture/product failures
  once actual PostgreSQL becomes available; lint/types alone cannot prove them.
- Required gate remains UNMET: run the unchanged isolated DB wrapper through
  both full and additive histories after main/user resolves the local Docker
  prerequisite. Preserve all three preflight failures alongside future results.
- Independent full parent review and final evidence reconciliation remain
  main-owned. No parent archive or all-AC acceptance claim is supported while
  this changed SQL surface is unverified. No spec contract change is proposed.
