# Canvas v1 Verified Handoff

## Completion State

- 2026-10-30: the user requested completing the missing tests before archiving
  `studio-canvas-v1`. All required automated/local DB/runtime gates now pass.
  Main archived this child after final independent review and source-hash
  verification, using `--no-commit`; its status is `completed`. Archival does
  not imply merge or rollout.
- No code is staged, committed, pushed or deployed. HEAD remains `1f7948e`;
  both the archived history-cleanup patch and canvas changes remain on disk.
  Parent/mobile are not activated. `CANVAS_ENABLED=false` remains the default.
- Production enabling/migrations, provider/S3 operations and mobile editing
  require separate authorization.

## Authoritative Evidence

- `verification.md`: final CA1-CA13 evidence and explicit manual boundaries.
- `checks/infra-final-review.md`: independent post-freeze full-scope check.
- `checks/db-gates-completion.md`: real SQL/migration/worker gates and cleanup.
- `checks/e2e-gates-completion.md`: nine actual runtime cases, image identities,
  authenticated/API/GC scope, corrections and exact-resource cleanup.
- `checks/infra-completion-2026-10-30/evidence.json`: copied final and failed
  command receipts/logs plus source hashes. Earlier resume evidence remains
  separately under `checks/resume-2026-10-30/`.
- `prd.md`, `design.md`, `implement.md` remain the requirement/design/execution
  authority. Historical planning and unmet preflights are dated, not erased.

## Final Results

- Full non-DB suite: 120 files / 1386 tests. Full types pass, lint has 0 errors
  and 9 existing warnings. Final local production build and five Compose dry
  configurations pass; Worker TS, Go vet/tests/build and release tests pass.
- Canvas real PostgreSQL: 32 full-history + 32 prior-history/additive SQL cases,
  including actual catalogue drift, locks/CAS/quota/run admission, root/grace,
  lease expiry/rollback and late PUT/versioning. Migration receipts match.
- Worker real PostgreSQL: immutable legacy13/additive5 receipts, TS6 and tagged
  Go suites. Migration verifier passes all five safety/recovery/pgx groups.
- Actual container E2E: all nine scenarios pass in 646.196s. Enabled embedded
  and dedicated2 cover signed-session SSR, actual imports/upload replay,
  snapshot/CAS/ownership, committed-run replay before/after deletion,
  scene-ID resolution, managedGC failure/backoff/retry, roots/works retention,
  readiness/schema/capability changes and bounded drain.
- Browser: fourteen real Next/production-component/React Flow/native IndexedDB
  groups pass with fixture HTTP: desktop/phone, IME, links, Save while editing,
  second-profile originals, ACK/deletion, lazy errors and terminal batches.
  The frontend source stayed unchanged afterward.
- Cleanup audits show no remaining DB-labelled or final-E2E-owned containers,
  networks/build images or scratch. Four explicitly prepared base images remain
  available. No broad prune, user media deletion or volume removal.

## Preserved Contracts

- One owner-scoped mounted studio/controller/cache/poller; chat and canvas stay
  independent. Commands capture canvas/node/run before async work; switching
  does not import, submit, cancel or overwrite drafts.
- Native local blobs/envelopes and manual captured account snapshots. Save ACK
  covers its captured revision; missing inputs/conflicts preserve drafts. Only
  exact owned tombstones revoke restored organization; unknown404/5xx/offline
  results are not deletion proof, and local writer CAS is never forced.
- Scene-bound canonical terminal reconciliation follows count hydration.
  Unknown/pending counts remain conservative; zero-addition terminal batches
  can mark handled. Deleted cards never reset result suppression.
- SQL guard state23514 requires exact allowlisted messages; P0001 compatibility
  remains. Typed raw calls and fixture casts match actual PostgreSQL. Published
  migrations/fingerprints are not modified to accommodate inaccurate mocks.
- Runners pin local unix/npipe Docker, empty owner config and exact ID/name/label
  cleanup. E2E publishes no ports: bounded cookie/body stdin reaches only
  allowlisted fixed-container-local HTTP. Auto-pull remains forbidden; explicit
  prerequisite image provisioning is separate.
- E2E GC uses API-created fake-storage imports. Only fixture timestamps are
  seeded under verified owner/sentinel SQL; real Worker claims and finalizers
  handle deletion. Recent/saved/completed-job/generated/legacy objects survive.
- Cached Turbopack chunk rejection has honest manual-refresh guidance and
  Return to Chat; no broken retry, silent reload or generation replay. Ordinary
  renderer errors retain in-place retry.

## Manual And Release Boundaries

- No real provider/S3 or production deployment test is performed. Runtime replay
  uses a SQL-seeded completed job, not fresh provider enqueue/precharge/complete.
  Those lifecycle pieces have production route plus real SQL/Go DB coverage;
  do not describe it as paid-provider E2E.
- Signed-session HTTP SSR is real; the separate fourteen-group browser uses
  fixture identity/HTTP. Browser login-to-provider, physical phone and OS-native
  IME candidate UI remain unperformed manual checks within the recorded scope.
- Docker classic-builder deprecation and Node typeless-TS fixture notices are
  tooling caveats, not a reason to change production module type.
- The independent mobile follow-up must plan/review its own editing UX and reuse
  these document/run/reference/ownership contracts, not a second phone schema.

## Reverification

Use repository `pnpm verify:*` wrappers with isolated environment and independent
stage deadlines. Do not load real `.env`, use a real DB or silently pull images.
Fresh changes require relevant targeted/full checks and affected real gates.
The previous temporary runtime/Next/browser fixtures remain under
`C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea`;
copied task receipts do not depend on that temporary directory surviving.
