# Canvas v1 Verification

## Status And Safety

Latest update, 2026-10-30: the user authorized completing the remaining isolated
tests and then archiving this child without committing code. All previously
missing DB/migration/E2E gates and the final independent review now pass. The
child was archived with `--no-commit` on 2026-10-30 and is `completed`; earlier
incomplete checkpoints below are historical, not the latest status. See
`Infrastructure Completion` for actual results and its evidence JSON for the
archive receipt.

Only canvas-v1 is authorized. No commit, push, deployment, parent/mobile
activation, real/development database or real provider/object-store mutation
is performed. Main explicitly provisioned four official local test images after
the user's follow-up; verification wrappers still never auto-pull. All positive
DB/E2E runs use labelled throwaway local databases/networks and fake storage.
The archived history patch intentionally remains uncommitted and preserved.

Runtime: officially SHA256-verified Node 24.22.1 / Go 1.25.14 and pnpm 10.32.1.
Temporary check root:
`C:\Users\Administrator\AppData\Local\Temp\narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea`.
`react-flow-spike/safe-run.mjs` uses the repository command runner with independent
stage deadlines and captured output. Its isolated environment blocks repository
`.env` reads, uses a dummy localhost port-1 DB for non-DB checks, blanks provider
and storage credentials, and supplies APP_URL only for build stages.

## Completed Checkpoints

| Checkpoint | Actual Result | Evidence / Boundary |
| --- | --- | --- |
| Context manifest validation | 19 implement / 16 check entries valid | Parent/child/artifact/research/predecessor context restored. |
| Fixed React Flow license/peers | Exact 12.12.0 core; no existing version change | `checks/react-flow-spike.json`, `THIRD_PARTY_NOTICES.md`. |
| Narrow real Next fixture build | webpack and Turbopack pass | Not authenticated `/create`; synthetic card/data fixture. |
| Narrow fixture browser | 9 checks pass on both builds | Real hydration/lazy/gestures, synthetic CDP IME and phone view-only checks; no API/DB. |
| Current precursor studio tests | 4 files / 32 pass | `coordinator-baseline-targeted`; after dependency only. |
| Isolated env tests | 2 files / 20 pass | `coordinator-safe-environment-regression-final`; initial runner-contamination failure retained. |
| Precursor Go build | Pass | `coordinator-baseline-go-build`; before canvas runtime changes. |
| Foundation targeted | 5 files / 44 pass | `foundation-resume-targeted-02`, 2.440s / 90s deadline. |
| Foundation full ordinary suite | 83 files / 450 pass | `foundation-resume-full-01`, 18.331s / 300s deadline. Default exclusions tested separately. |
| Foundation types | Pass | `foundation-resume-types-02`, 7.490s / 120s deadline. |
| Foundation lint | Pass, 10 pre-existing warnings | `foundation-resume-lint-02`, 8.449s / 180s deadline. |
| Foundation isolated Prisma generate/validate | Pass, no DB connection | `foundation-resume-prisma-01`, 2.639s / 120s deadline. |
| Direct canvas DB suite without sentinel | Expected failure before connection | `foundation-resume-db-sentinel-01`; negative guard test only. |
| Canvas DB wrapper | UNMET: exit 2, no local PG image | `foundation-resume-db-preflight-01`, 1.609s; no container/pull/DB. |
| Worker DB wrapper | UNMET: exit 2, no local PG image | `foundation-resume-worker-db-preflight-01`, 2.239s; immutable baseline drift fixed, no published SQL change. |
| Foundation independent Trellis review | Scoped code findings fixed; targeted 5 files / 54 pass | Final lint 10.760s, types 4.865s, targeted 2.975s; DB acceptance remains unmet. |
| Foundation production build checkpoint | Pass | `coordinator-foundation-build`, 16.440s / 600s; no canvas runtime/UI integration yet. |
| Read-only step-5 APIs | 2 files / 69 pass twice; lint/types pass | `canvas-read-api-tests-2`, `canvas-read-api-types-2`; direct mocked DB, no live dependency. |
| Independent step-5 APIs | 6 files / 160 pass; lint/types pass | Includes adapter/cursor/image-format fixes; fake services are not DB proof. |
| Generation implementation ordinary suite | 91 files / 691 pass | `canvas-generate-ordinary-1`, 19.980s; precedes independent step-6 additions and runtime edits. |
| Independent step-6 generation | 6 files / 173 pass; lint/types pass | Stale-reservation recovery added; `canvas-generation-check-targeted-final`. |
| Worker TS contract wrapper | 6 files / 32 pass | `canvas-generation-check-worker-ts-final`, 3.672s. |
| Runtime implementation ordinary suite | 94 files / 835 pass | `canvas-runtime-node-all-03`, 23.235s / 300s; before final runtime review/E2E additions. |
| Runtime Go implementation | 137 top-level / 581 nested pass; vet/build pass | Fake-backed real Worker.Run and pure fixture checks, not PostgreSQL/topology execution. |
| Node raw storage capability guard | 5 files / 177 pass; lint/types pass | Real SDK with fake HTTP; empty/html false-ready reproduction retained. |
| Safe E2E harness/fixture | 2 files / 32 pass; types/lint pass | Actual SDK versus in-memory localhost fixture and safety command tests. |
| Guarded E2E runtime preflight | UNMET: exit 2, local base images absent | `e2e-safe-preflight-01`, 4.061s; only read-only Docker probes, no resources or pull. |
| Independent E2E safety | 2 files / 56 pass; types/lint pass | Command-path and real-socket fixture regressions; runtime preflight still exits 2 safely. |
| Independent steps 9-10 | 15 files / 211 pass; types/lint pass | `foundations-check-final-*`; source guard, Delete ACK and stale merge fixes. |
| Native local-store harness | 41 pass; types/focused lint pass | Strict envelope/Blob/CAS/tombstone cases. |
| Real native IndexedDB browser | 7 checks pass | `checks/native-idb-browser.json`, 1.972s; production store module, actual page reload and two connections; no Next/API/DB. |

These checkpoints do not replace rerunning the full final suite after backend,
runtime and frontend integration. Earlier predecessor 411-test results are not
current canvas acceptance. DB test source/static assertions are not successful
execution of PostgreSQL migrations, catalogue probes, locks or GC races.

## Pre-Infrastructure Acceptance Checkpoint

Updated on 2026-10-30 after recovering late implementation/check receipts.
Bounded unit/browser evidence is not a claim that the full criterion, live data
path or release gate has passed. Final resumed checks are recorded separately.

| ID | Current Evidence | Remaining |
| --- | --- | --- |
| CA1 | Integrated root/controller tests and final Next fixture: empty New, separate chat/canvas draft/selection, account isolation and no switch POST. | Authenticated full application remains untested. |
| CA2 | Pure graph and actual React Flow tests; final browser typed handles, ordered references, invalid-link guards and manual execution. | Physical input-device testing is not claimed. |
| CA3 | Existing generate branch/encoder and frozen-input regressions; final browser ordered Run, count1 references, nonoverlapping reruns and multi-run terminal restore. | Real SQL/provider execution. |
| CA4 | API/adapter/SQLSTATE/idempotency/origin/poller regressions; browser delayed/lost ACK then refresh without a new POST. | Real disposable transaction/charge/GC concurrency. |
| CA5 | Strict envelope/Blob/CAS/tombstone tests, 7 native-store checks and final Next/native-IDB refresh/geometry/deletion checks. | Storage eviction/device failures remain bounded simulation, not durability guarantees. |
| CA6 | API CAS/receipt tests plus browser captured Save while editing, separate-profile last-snapshot restore and conflict preservation. | Real owner/auth/SQL concurrency across devices. |
| CA7 | Upload/read/expiry unit tests; browser saves disconnected originals, second profile runs without re-upload, downloaded bytes exactly match original. | Actual persisted object-store recovery. |
| CA8 | New/rename/delete and stale-ACK tests; final browser deleted organization suppression and authoritative cloud-deletion/stale-native-tombstone recovery retain fake jobs. | Real SQL execution. |
| CA9 | Legacy generation/retention/cancel/refund regressions and fake browser job inventory survives organization deletion. | Actual database/Worker/works end-to-end proof. |
| CA10 | Final production Next fixture passes 14 groups: SSR/lazy/IME/focus, desktop loop, zoom0.25/1/2 and negative drag, phone touch/read-only plus chat. | Real authenticated layout, OS IME/physical phone are not covered. Chunk network failure requires explicit manual refresh. |
| CA11 | Shared retention/roots/location/catalogue fixtures, Go managed scheduler/fake storage checks and SQL race cases written. | Positive disposable PostgreSQL migrations/catalogue/GC races and enabled runtime topologies. |
| CA12 | Scoped loader was verified before global bootstrap replacement; final tests cover deadlines/cursor retry and scene-only complete terminal recovery without rematerialization. | Live database-scoped queries. |
| CA13 | Final 118 files/1339 non-DB tests, types/lint, production build, Node/Go checks, five Compose config checks and fresh whole-scope reviews pass. | Positive DB/migration/GC/enabled-topology gates remain unmet; no release/completion claim. |

## Resumed Checkpoints: 2026-10-30

- Current manifests: 21 implement / 18 check entries, all files resolve.
- `resume-front-initial-full-01`: 117 files / 1307 tests pass, 28.859-second
  wrapper. `resume-front-initial-types-01` passes; lint has 0 errors/9 existing
  warnings. These are an early checkpoint, not post-fix final verification.
- `resume-fixture-source-01` verifies copied production source hashes;
  `resume-fixture-build-01` passes on actual Next16.2.4/Turbopack in 10.998s.
- `resume-browser-01` passes 12 groups in 62.725s on Chrome156.0.8078.48.
  Desktop and separate-profile pages report 0 uncaught/console errors; the
  deliberately blocked lazy chunk reports exactly one caught ChunkLoadError.
  Main visually inspected desktop, phone and recovery-guidance screenshots.
- Evidence is in temporary `studio-browser-resume01/results.json`. The pages
  use actual production GeneratorStudio/controller/React Flow/native IndexedDB
  with serialized fixture identity and loopback fake HTTP. They do not validate
  real authentication, database, Worker, provider, billing or S3 behavior.
- Reviewed SQLSTATE regression: `resume-back-sqlstate-red` reproduces 7 mapper/
  route/fence failures, then `resume-back-sqlstate-green` passes 2 files/88 tests.
  Real Prisma adapter with a fake driver consumes the actual migration's state;
  migration SQL and fingerprints are unchanged. This is still not a DB run.
- Actual DB/migration wrapper runs are held pending the resumed local-Docker
  safety review. Missing infrastructure is neither bypassed nor treated as green.

## Pre-Infrastructure Resumed Verification

Authoritative copied receipts and raw logs:
`checks/resume-2026-10-30/evidence.json` and its `logs/` directory. Browser and
Compose details: `browser-summary.json`, `compose-summary.json` in that same
directory. Earlier entries above remain historical checkpoints.

| Final Check | Actual Result | Receipt / Boundary |
| --- | --- | --- |
| Full non-DB suite | 118 files / 1339 pass, 33.482s | `resume-front-final-full-02`; both sentinelled DB suites excluded. |
| Full types | Pass, 30.561s | `resume-front-final-types-02`, no incremental cache. |
| Full lint | 0 errors / 9 existing warnings, 32.294s | `resume-front-final-lint-02`. |
| Frontend recovery/origin regressions | 12 files / 262 pass, 13.096s | `resume-front-regressions-green-02`; 15 tests added. |
| Backend core contracts | 18 files / 486 pass, 9.525s | `resume-back-core`; mocked transactions/fake storage. |
| SQLSTATE/local Docker final safety | 5 files / 143 pass, 2.608s | `resume-back-safety-final`; real adapters with fake driver/command transport. |
| Worker TS contract wrapper | 6 files / 32 pass, 3.068s | `resume-back-worker-ts`. |
| Go contracts/vet/full ordinary tests/build | Pass | `resume-back-worker-go`, `resume-back-go-all`, `resume-back-go-build`; no DB build tag. |
| Release script tests | 10 pass, 0.952s | `resume-back-release-tests`. |
| Full production build | Pass, 19.167s | `resume-production-build-02`; Prisma generate, Next/types, 61 static outputs/full routes. |
| Final production fixture build | Pass, 13.328s | `resume-fixture-build-02`; copied-source audit covers 215 files plus key/CSS hashes. |
| Final real Chrome/Next/native IDB | 14 groups pass, 80.669s | `resume-browser-02`; final desktop/phone/recovery screenshots inspected, fake identity/HTTP only. |
| Real Compose dry configurations | 5 pass, 1.441s | `resume-compose-config-01`; release off/on and E2E off/on/mismatch, no containers/builds. |
| Canvas DB wrapper | UNMET, exit2 in 8.532s | `resume-canvas-db-01`; bounded local daemon probe timeout, no DB/container. |
| Worker DB wrapper | UNMET, exit2 in 17.859s | `resume-worker-db-01`; bounded local daemon probe timeout, no DB/container. |
| Migration wrapper | UNMET, exit2 in 6.624s | `resume-migrations-01`; missing local PostgreSQL17-alpine, no migration. |
| E2E wrapper | UNMET, exit2 in 2.066s | `resume-e2e-01`; four missing local base images, no runtime topology/build/resource/pull. |
| Fresh whole-scope independent review | Source findings fixed; no further confirmed scoped defect | `checks/resume-frontend-review.md`, `checks/resume-backend-review.md`; main integrates browser/build/source safety. |

Normal browser profiles have zero uncaught/console errors and no unexpected
external requests. Only the deliberately blocked chunk produces one caught
ChunkLoadError. Tests confirm no automatic reload, preserved unsent chat before
explicit refresh, local record recovery and no generation replay. Native stale
draft/cloud deletion and count2/count1 saved terminal batches pass in the final
browser run. Downloaded bytes match the exact original, not a thumbnail.

No positive PostgreSQL/catalogue/locking/GC-race, actual enabled Worker/app
topology or authenticated real provider/S3 verification has run. These remain
required acceptance gates. Do not archive the task, check off all CA criteria,
enable the feature or claim deployment readiness from the passing local tests.
Task remains `in_progress`; no staging, commit, push or deployment is performed.

## Infrastructure Completion

The user subsequently authorized missing test-image preparation and completion
of the positive gates before archive. Authoritative new evidence is separate:
`checks/infra-completion-2026-10-30/evidence.json`, copied receipts/raw logs,
`checks/db-gates-completion.md`, `checks/e2e-gates-completion.md` and
`checks/infra-final-review.md`. Earlier red/preflight records are retained.

| Final Gate | Actual Outcome | Authoritative Receipt |
| --- | --- | --- |
| Explicit test-image provisioning | Four official Linux/amd64 images inspected by ID/digest, 54.680s | `provision-test-images-01`; user-authorized separately, no runner auto-pull. |
| Canvas real PostgreSQL | Full18 and prior17/additive1 exact migrations; 32 + 32 SQL tests pass, 19.332s | `db-complete-canvas-03`. |
| Worker real PostgreSQL | Legacy13/additive5 exact receipts; TS6 and tagged Go worker/gateway DB tests pass, 13.236s | `db-complete-worker-01`. |
| Migration safety | Five empty/baseline/prehistory/failed-history/pgx groups pass, 43.773s | `db-complete-migrations-01`. |
| DB cleanup audit | Zero containers for all three DB owner labels; ten logged scratch paths absent | `db-complete-cleanup-audit-01`. |
| Real container E2E | All 9 legacy/enabled scenarios pass, 646.196s | `e2e-complete-runtime-03`. |
| E2E cleanup audit | Zero owner containers/networks/build images; runtime and audit scratch removed | `e2e-complete-final-resource-audit-01`. |
| Post-freeze non-DB suite | 120 files / 1386 tests pass, 44.517s | `infra-final-full-01`. |
| Post-freeze full types/lint | Types pass; lint 0 errors / 9 existing warnings | `infra-final-types-01`, `infra-final-lint-01`. |
| Final local production build | Prisma generate + Next compile/types/full route outputs pass, 26.609s | `infra-final-production-build-01`. |
| Final real Compose dry configs | Five configurations pass, 4.716s | `infra-final-compose-config-01`. |
| CI YAML | Three jobs, four explicit E2E image preparations and wrapper entry parsed/verified | `e2e-complete-workflow-yaml-01`. |
| Browser | Previous final 14 Next/native-IDB groups remain valid: production component/lib/contract source unchanged | `checks/resume-2026-10-30/browser-summary.json`. |

Actual E2E scenarios and measured duration:

| Scenario | Milliseconds | Evidence |
| --- | --- | --- |
| embedded | 14236 | Real startup/schema/topology/Node and clean bounded SIGTERM. |
| dedicated | 16546 | Two real dedicated Workers healthy; feature-off makes no import-storage calls. |
| conflict | 16324 | Conflicting topology exits nonzero while original remains ready. |
| schema | 21739 | Missing schema withdraws readiness; ordinary migrations restore it. |
| dbdown | 33538 | Database loss withdraws readiness/stops lock owner; isolated recovery works. |
| propagate | 7464 | Missing fixture database propagates migration/supervisor failure. |
| canvas-embedded | 132497 | Actual authenticated SSR/API/replay and managed GC retention/failure/retry, then drain. |
| canvas-dedicated | 134110 | Same enabled coverage with two Workers and canvas schema/capability recovery. |
| canvas-mismatch | 21632 | Enabled Node rejects generic-ready disabled Worker; enabling capability recovers, then drains. |

Both enabled scenarios use real signed-session authentication, actual `/create`
SSR, owner-isolated API create/import/upload replay/snapshot/read/CAS, and real
SDK requests to the internal fake S3. SQL seeds one completed job/run using the
production normalized wire and canonical hash. Real `/api/generate` COMMITTED
replay before/after canvas deletion returns its original job/run without another
job, debit or upload; run lookup and explicit scene-ID resolution also pass.
This is not a new paid-provider generation or login-flow test.

The same four API-created imports feed the actual managed Worker GC. Only an
old unrooted key is claimed; forced remote failure retains its bytes/accounting
and backoff, then the next real scheduler pass deletes exactly that key. Recent,
saved-snapshot and completed-job imports survive alongside generated/legacy
fake objects and canonical job/image/credits. Claims/finalizers are never called
directly by the E2E test; only fixture timestamps are seeded in the verified
sentinel database. Seven-day grace, 60-second GC interval and scenario deadlines
are unchanged. All SQL/CAS/race counterparts also pass in the canvas DB suite.

The E2E network stays internal with no published ports. Fixed localhost HTTP is
performed through owner-checked container exec and bounded stdin; cookies never
enter argv. First real E2E runs exposed unsupported internal host publishing and
duplicate case-variant Content-Type construction in the fixture. The fixture is
corrected without weakening network isolation or production parsing. Valid PNG
CRC and production canonicalization are tested. CI now explicitly provisions
all four bases outside the no-pull wrapper, build context excludes local secrets/
assistant metadata, and the Docker builder disables telemetry.

### Final CA Evidence Map

| Criteria | Satisfied By | Explicit Boundary |
| --- | --- | --- |
| CA1-CA2 | Real component/browser mode/graph tests and final full suite; owner/API SQL coverage | Physical hardware input not claimed. |
| CA3-CA4 | Production parser/route/origin tests, actual SQL atomic job/debit/root/race tests, tagged Go DB and real committed-route replay | Fresh paid-provider end-to-end not executed. |
| CA5-CA7 | Native IndexedDB reload/CAS/blob tests, 14-group browser save/edit/second-profile recovery, real authenticated upload/save/reuse/owner/CAS APIs | Browser eviction is not a durability guarantee; real S3 credentials never used. |
| CA8-CA9 | Deletion/suppression regressions, native stale-tombstone browser case, actual SQL job/account/root retention and enabled managedGC works preservation | Canonical works are synthetic test records, not user data. |
| CA10 | Real signed-session SSR plus real Next/component/native browser14groups and unchanged frontend hashes | Physical phone/OS-native IME and browser login-to-provider loop remain unperformed manual checks. |
| CA11 | 64 actual SQL tests including lock races/roots/grace/latePUT, plus real managedGC failure/backoff/retry in both runtime topologies | Fake storage verifies behavior, not any real provider's permissions. |
| CA12 | Scoped loader/source/timeout/pagination regression, scene-only native recovery, actual explicit runtime-ID API lookup | No global/history fallback introduced. |
| CA13 | All required local build/unit/Node/Go/DB/migration/runtime gates and fresh independent final review | No production rollout or implicit commit authorization. |

Known tooling notices are non-failing: existing 9 lint warnings, Node's typeless
TS-module warning in the host-only fixture, and Docker classic-builder
deprecation. No package module-type or production behavior is changed to hide
those notices. The final independent reviewer reports no confirmed residual
defect and verifies E2E17/17, browser10/10 and DB3/3 frozen hashes. All required
automated gates pass; CA1-CA13 are checked with these explicit manual/release
boundaries. Main completed the user-requested child-only `--no-commit` archive,
not a code commit or rollout.

## Failures Retained

- Narrow fixture cross-drive resolution, mapper typing and browser selector/
  deadzone/offscreen assertions were fixed in the disposable harness only.
- Initial environment regression failed because its helper supplied an invalid
  empty WORKER_RUNTIME_MODE; helper-only correction to dedicated fixes it.
- Initial foundation lint/types/targeted failures were corrected. Published
  migration receipt comparison now accepts only raw/LF/CRLF equivalents without
  changing migration SQL or receipts. Failed and final logs remain available.
- Independent foundation review fixed lossy constraint-expression normalization,
  missing argument-default checks, reserved clock locals and late version receipt
  fencing. New regression failures were retained before the successful fixes.
- The accidental root redirection file triggered a full agent stop. The user
  authorized exact provenance verification/removal; the main session removed
  only that file and retained its evidence. No code patch was reset or discarded.
