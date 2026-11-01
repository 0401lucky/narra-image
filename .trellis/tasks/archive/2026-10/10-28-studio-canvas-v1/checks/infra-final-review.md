# Final Infrastructure Review

Date: 2026-10-30. Role: independently dispatched `trellis-check`.
Active task: `.trellis/tasks/10-28-studio-canvas-v1`.

## Outcome

No confirmed residual code defect remains in the reviewed scope. The previously
missing real local database, migration, enabled runtime and managed-GC gates
now pass. Final frozen-source lint, types, ordinary tests, Node/Go contracts and
builds also pass. The child is ready for main's requested **no-commit archive**
with the explicit evidence boundaries below; this is not deployment approval.

This follow-up reviews the infrastructure changes and actual receipts against
the child PRD/design/implementation plan, shared canvas/generation contracts and
updated release/storage/frontend specs. It also reconciles the earlier fresh
frontend/backend reviews and 14-group real Next/browser evidence. Historical
`checks/resume-backend-review.md` is preserved, not rewritten as live DB proof.

The reviewer makes no production or test-source edit in this final follow-up;
only this report is written. Corrections below were coordinated with the
implementers under their existing ownership, then verified on frozen source.
Dirty canvas and archived history-cleanup changes remain uncommitted and intact.

## Findings (fixed)

### Fixture SQL Parameter Ambiguity

- File: `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts`.
- Issue: Real PostgreSQL rejected five fixture statements with `42P08` when
  one parameter was inferred for both VARCHAR and TEXT columns; behavioral
  assertions therefore had not executed despite successful catalogue checks.
- Fix: The DB implementer adds explicit text casts only to those fixture
  parameters. No production SQL, schema, migration fingerprint, guard or
  assertion changes. All 32 cases pass against both full and additive histories.

### Runtime Evidence Did Not Yet Bridge The Real API And Scheduler

- File: `scripts/fixtures/canvas-runtime.mjs`.
- Issue: Upload replay alone cannot establish generation replay, and separate
  fake-storage assertions cannot establish the actual managed Worker loop.
- Fix: Both enabled topologies now use signed production sessions for actual
  `/create` SSR, create/upload/upload-replay/save/CAS/owner APIs, original-run
  lookup and explicit runtime IDs. A deliberately seeded COMMITTED run traverses
  the real `/api/generate` route before and after organization deletion, retaining
  its job, frozen input and credits. The same actual API-created imports then
  exercise real scheduler delete failure, accounting/backoff and successful retry.
  This is explicitly not fresh provider generation or a paid enqueue test.
- Fix: The foreign-asset assertion checks the real 409
  `CANVAS_INPUT_UNAVAILABLE` contract and absence of data, not an invented 404.

### Invalid Fixture Bytes And Request Encoding

- Files: `scripts/fixtures/canvas-object-store.mjs`,
  `scripts/fixtures/canvas-runtime.mjs`,
  `src/tests/unit/canvas-object-store-fixture.test.ts`,
  `src/tests/unit/canvas-e2e-runtime-fixture.test.ts`.
- Issue: The initial PNG had an invalid CRC. Native ESM loading of the existing
  pure TypeScript contracts hit JSON import-attribute requirements. Mixed-case
  duplicate Content-Type entries then caused the real strict run parser to
  reject the second runtime attempt before GC assertions could execute.
- Fix: Use a production-verified valid PNG, the installed scoped `tsx/cjs/api`
  loader for original validators/canonicalization, and case-insensitive
  `Headers.set`. The intent hash uses the real normalized
  `{canvasRun, credentialFingerprint:null}` envelope. Regressions retain the
  malformed request rejection and prove corrected relay bytes parse to the same
  normalized run. Production validators and generation code are unchanged.

### Internal Docker Network Could Not Supply The Requested Host Port

- Files: `docker-compose.e2e.yml`, `scripts/verify-e2e.mjs`,
  `scripts/lib/e2e-safety.mjs`, `scripts/fixtures/canvas-object-store.mjs`,
  `src/tests/unit/canvas-e2e-http-fixture.test.ts`.
- Issue: Actual Docker 29 internal-network inspection retained the requested
  HostConfig port binding but did not allocate a real host port. Accepting that
  state or widening the network would invalidate isolation or runtime proof.
- Fix: Remove E2E published ports. Owner-checked Compose exec invokes a bounded
  app-HTTP relay with fixed container `127.0.0.1:3000`, exact method/path/header
  allowlists, no redirects, cookie/body only on stdin, 128 KiB decoded bodies,
  256 KiB envelopes, 1 MiB responses and independent 10-second input/HTTP limits.
  Containers reject published ports and host networking. The network stays
  internal; no new listener, external network or production API is introduced.

### CI Prerequisites And Docker Build Context

- Files: `.github/workflows/verify.yml`, `.dockerignore`, `Dockerfile`,
  `scripts/lib/e2e-safety.mjs`, `src/tests/unit/canvas-e2e-runner.test.ts`.
- Issue: CI supplied only PostgreSQL while the strengthened runner correctly
  requires four local base images; local private agent/config/cache files also
  needed explicit build-context exclusion.
- Fix: CI explicitly provisions PostgreSQL17, Node24.22.1, Go1.25 and Alpine3.22
  outside the runner. Runtime/build commands retain no-auto-pull behavior and
  inspected immutable inputs. Docker context excludes private metadata, nested
  dotenv/package auth files and caches; builder-only telemetry is disabled.
  Classic builds remove their intermediate containers with `--force-rm`, without
  pruning unrelated resources. CI YAML parses; an actual GitHub Actions run is
  not claimed.

## Findings (not fixed)

None. Remaining manual/provider/deployment boundaries are recorded limitations,
not hidden failing automated gates or product behavior waived by this review.

## Verification

All reviewer commands use the approved isolated Node24.22.1/pnpm10.32.1/Go1.25.14
wrapper, independent deadlines, dummy localhost-port-1 application DB, isolated
caches and repository dotenv-read protection. Ordinary Vitest explicitly
excludes both sentinelled DB suites; their actual positive results are separate.

| Check | Actual Result | Receipt |
| --- | --- | --- |
| Full ordinary Vitest | Pass, 120 files / 1386 tests, 44.517s | `infra-final-full-01` |
| Full TypeCheck, no incremental cache | Pass, 44.019s | `infra-final-types-01` |
| Full ESLint | Pass, 0 errors / 9 existing unrelated warnings, 45.947s | `infra-final-lint-01` |
| Focused relay/runtime/runner/storage/shared-schema/HTTP safety | Pass, 8 files / 181 tests, 6.926s | `infra-final-targeted-01` |
| `verify:worker-contracts:ts` | Pass, 6 files / 32 tests, 2.399s | `infra-final-worker-ts-01` |
| `verify:worker-contracts:go` | Pass, vet plus ordinary worker tests, 13.333s | `infra-final-worker-go-01` |
| `go -C worker test -count=1 -timeout=50s ./...` | Pass, 5.774s | `infra-final-go-tests-01` |
| `go -C worker build ./...` | Pass, 5.606s | `infra-final-go-build-01` |
| Release/migration Node script tests | Pass, 10 tests, 0.739s | `infra-final-release-scripts-01` |
| Real canvas DB | Pass, 32 full + 32 additive, 19.332s | `db-complete-canvas-03` |
| Real worker DB | Pass, TS6 and tagged Go worker/gateway suites, 13.236s | `db-complete-worker-01` |
| Real migration scenarios | Pass, all five groups, 43.773s | `db-complete-migrations-01` |
| Real runtime E2E | Pass, all nine scenarios, 646.196s | `e2e-complete-runtime-03` |
| Final local production build, main-owned | Pass, Prisma generation + Next compile/types/routes, 26.609s | `infra-final-production-build-01` |
| Final Compose dry configurations, main-owned | Pass, five configurations, 4.716s | `infra-final-compose-config-01` |
| Final exact-owner resource audit | Pass, zero owned containers/networks/build images, 3.591s | `e2e-complete-final-resource-audit-01` |
| Final tracked whitespace | Pass; LF/CRLF advisories only | Reviewer `git diff --check` |

The nine real runtime scenarios are embedded, dedicated, conflict, schema,
dbdown, propagate, canvas-embedded, canvas-dedicated and canvas-mismatch.
Both enabled scenarios verify real failed remote delete/backoff and successful
retry while retaining recent imports, saved roots, completed-job roots,
deleted-organization jobs/images and generated/legacy objects. Dedicated
execution includes two Workers. Schema/capability mismatch, topology loss and
bounded drain use the real processes, not stubbed readiness responses.

Main explicitly provisioned four test images; verification runners did not pull
them. Tests use owner-labelled localhost/tmpfs databases and private fake S3,
never development/production data or real provider/storage credentials. Exact
resource cleanup is part of success and is independently audited. The final
E2E owner is `ba10161f-caf2-4d21-a922-f6a84ce1ebc9`; its runtime scratch is gone,
and the four supplied base image IDs remain unchanged.

Raw `<label>.json`, stdout and stderr receipts are in the approved temporary
runner's `react-flow-spike/logs/`; main preserves them under
`checks/infra-completion-2026-10-30/`. Detailed positive and red/green histories
are in `checks/db-gates-completion.md` and `checks/e2e-gates-completion.md`.
Earlier failed fixture/port/encoding attempts remain evidence, not skipped cases.

## Frozen Source Verification

After every reviewer gate, at `2026-10-30T02:29:22Z`, independent SHA-256
comparison matches all **17/17** paths in
`e2e-complete-source-hashes-01.json` and all **10/10** named production source
hashes in `checks/resume-2026-10-30/browser-summary.json`. Implementer source
freeze records no code changes after runtime03 launch. Main separately checks
the broader browser source-tree equality. This reviewer does not represent the
17-file manifest as a cryptographic attestation of every image-layer file.

The three independently rechecked database identities also remain exact:

- DB test: `90bce42946f64e773bf3c93cc5b523b2e315f474ca7074c6131b21bcfc758c68`.
- Canvas migration: `1247ec0bb7985a465028e4e05abb0b0ffa6ce80e964d57b37351c2943c3513f4`.
- Shared schema inventory: `e69179542807fd6ecf8899df831ee5be5e90074b2b8a9489b5c455cc204da254`.

Final runtime images, removed by exact-owned cleanup:

- App: `sha256:619dcb27201bb7ec775f9ba3e84cd65edb89406267022f432995caaa9b6f3c58`.
- Worker: `sha256:3d1ff2bc95cd8eeb8112f4d6269e2723fbc61f832c134c1435d60ba5221adcc3`.

## CA1-CA13 Evidence Map

This is layered evidence, not a claim that every browser interaction used a
real authenticated backend and paid provider in one end-to-end session.

| Criterion | Verified Evidence And Boundary |
| --- | --- |
| CA1 | Root/controller tests and real Next/browser empty-New, separate drafts, selection/account isolation and no switch POST; actual API owner checks and signed-session SSR now pass. |
| CA2 | Shared graph and real Flow typed-handle/order/invalid-link tests; browser connects inputs without automatic generation. Physical input hardware is not claimed. |
| CA3 | Production parser/route/frozen-input tests and browser manual ordered Run/rerun/stable results; actual SQL commit/root/debit behavior. No fresh paid-provider E2E. |
| CA4 | Origin/poller/ACK-loss tests and browser read-only reload recovery; real same-run SQL races and actual COMMITTED route replay retain one job/run and unchanged credits. |
| CA5 | Strict durable projection, native IndexedDB Blob/transaction/CAS/tombstone tests and real reload/viewport recovery. Simulated storage failure does not guarantee durability after browser eviction. |
| CA6 | Captured-Save/dirty-edit/conflict tests, separate-browser snapshot restore, actual authenticated Save/readback/CAS/foreign-owner rejection and SQL concurrent-save fences. |
| CA7 | Browser disconnected-original Save and separate-profile reuse plus exact-byte download; actual upload/upload-replay/snapshot roots preserve immutable IDs and four PUTs. Storage is fake, not a real bucket. |
| CA8 | Metadata/deletion/stale-ACK/controller and stale-native-tombstone browser tests; actual SQL/API tombstones, roots and replay after organization deletion without resurrection or extra charge. |
| CA9 | Legacy cancellation/refund/handoff tests, tagged Go DB contracts, real retained canonical jobs/images/roots and unchanged cancel/refund fields after deletion. Records are synthetic, never user works. |
| CA10 | Actual authenticated `/create` SSR plus the unchanged 14-group Next/Chrome/native-IDB suite covers desktop/phone layouts, lazy failure, CDP composition/focus/drag/pinch and phone chat. Physical phone and OS candidate IME remain manual gaps. |
| CA11 | 64 real SQL executions prove catalogue, seven-day grace, roots/reattachment, locking, races, late PUT/version fences and accounting; both actual managed-GC topologies prove delete failure/backoff/exact-key retry and generated/legacy exclusion. |
| CA12 | Scoped conversation/source/pagination/timeout regressions, scene-bound-only native recovery and real explicit runtime-ID API lookup; no global/all-run reconstruction. This is not an exhaustive live historical-chat dataset test. |
| CA13 | Final lint/types/full ordinary tests/build, Node/Go contracts, actual DB/additive migrations/runtime/GC gates, source checks and this fresh independent final review pass. Required local automated gates are no longer blocked on infrastructure. |

## Boundaries And Handoff

- No fresh billable provider generation, real provider/S3 capability or deletion
  permission, production migration/deployment, load/capacity guarantee or GitHub
  Actions execution is claimed. Atomic fresh debit/run/root fencing is tested
  by actual SQL, orchestration by route regressions, and committed replay by
  real authenticated HTTP; these are distinct evidence layers.
- The 14-group browser suite uses production Next/components/native IndexedDB
  with fake identity/HTTP. Real signed-session SSR/API/Worker execution now
  supplements it, but does not turn it into browser-login-to-provider E2E.
- Physical-phone touch/keyboard and native OS IME candidate interaction remain
  recorded manual residuals, as the PRD permits. CDP touch/composition is not
  silently represented as physical-device verification.
- Existing nine lint warnings, Node `MODULE_TYPELESS_PACKAGE_JSON` and Docker
  classic-builder deprecation warnings are harmless tooling warnings here, not
  failed gates or skipped features. No package-type or builder-policy change is
  made simply to suppress them.
- Main's updated specs accurately cover SQL casts, exact public error mapping,
  canonical replay/header construction, explicit CI images, no-port relay and
  isolated/owned cleanup. No additional spec correction is required by this
  final review.
- Main may archive only this completed child with `--no-commit`. The parent
  integration task and full mobile editor remain deferred. No staging, commit,
  push, enablement or deployment is authorized by this report.
