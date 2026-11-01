# Research: Canvas backend operations and release contracts

- Query: Which GC, storage capability, schema/environment, verification, and
  conversation-loading contracts complete the independently saved canvas backend?
- Scope: mixed; persisted source-backed operational research and planning review.
- Date: 2026-10-28
- Method: lossless split of sections 8-11 from `canvas-backend-contracts.md`; no
  additional source research, tests, database/storage calls, deployment inspection,
  secret reads, implementation, or git operations.
- Product authority: the parent and canvas-v1 PRDs. Main-session planning artifacts
  own the converged design; these proposals do not authorize implementation.
- Companion: `.trellis/tasks/10-28-studio-dual-mode-canvas/research/canvas-backend-contracts.md` retains
  sections 1-7 on schema, shells/CAS, uploads, frozen runs/idempotency, ACK recovery,
  and accepted-only scene hydration.

## Findings

### 8. Seven-day cleanup state machine and actual managed scheduler

Fixed product eligibility: registered owned canvas IMPORTS only; no saved-canvas
root, no submitted-job root, no valid preparation/upload protection, and seven
days since detach or successful orphan upload. A local edit is not cloud detach.
Removing the last authoritative root stamps detach; valid reattachment clears
eligibility under the same asset lock. Generated media and unregistered legacy
keys/URLs are excluded, even when they resemble an import key prefix.
Grace, detach, and lease timestamps use the authoritative database clock, not
client timestamps or independently skewed app/worker host clocks.

Proposed states: `UPLOADING -> READY -> DELETING -> DELETED`, with rejected or
ambiguous uploads retaining known-key quarantine/tombstone metadata. Expired
unknown uploads also receive a conservative seven-day orphan grace; lease expiry
alone is not evidence that their remote PUT never wrote an object.

1. Claim a bounded candidate batch in a short DB transaction using indexed
   eligibility and asset row locks/`SKIP LOCKED`. Recheck BOTH authoritative root
   sets and current leases after obtaining the lock, using a fresh read rather
   than trusting the candidate prefilter, then set `DELETING` with a fresh delete
   token before releasing the lock. Save/enqueue/attachment locks these same assets and
   requires `READY`. A reattachment winning before claim prevents cleanup; after
   claim, never revive that asset or reuse its key, even if deletion fails.
2. Delete only the registry's recorded trusted location/bucket/key outside the
   transaction. No user-prefix listing, URL-derived deletion, generated-image
   cleanup, provider call, cancellation, or refund is part of this operation.
3. Remote success/confirmed missing permits fenced finalization. Remote failure,
   timeout, authorization error, or unknown capability retains the registry/key,
   deleting state, accounting/root evidence, and a bounded backoff retry. Do not
   report physical cleanup or delete the database inventory on remote failure.
4. A late PUT is a distinct risk: SQL fencing stops READY publication, not an
   already sent object-store write. Keep immutable key tombstones for ambiguous
   uploads and bounded reconciliation of those known keys; one earlier DELETE
   or HEAD-missing response is not proof a late PUT cannot appear afterward.
   Never recycle a deleted asset identity/key or lose its inventory row.

Exact scheduling integration: add ONE managed GC goroutine in `Worker.Run`, after
storage/topology acquisition and successful generation+canvas schema gates,
alongside but not inside generation consumers
(`worker/internal/worker/worker.go:131`,
`worker/internal/worker/worker.go:153`). It uses `runtimeCtx`, a separate joined
WaitGroup, panic/unexpected-exit reporting, immediate bounded pass plus ticker,
and stops claiming on drain/topology loss. Join it within the existing shutdown
hard-stop contract rather than copying the unjoined prompt scheduler launch
(`worker/internal/worker/worker.go:184`). The prompt scheduler shows the ticker
shape (`worker/internal/worker/prompts.go:856`), not complete GC lifecycle safety.

Do NOT put GC in `runLoop`'s expired-job sweep
(`worker/internal/worker/worker.go:320`): that runs per generation slot at the
generation poll cadence. Recommended unmeasured runtime bounds: 60-second GC
interval, at most 20 candidates/pass (configurable up to 100), one remote delete
in flight per sweep, 30-second per-object timeout, short DB operations, and a
bounded pass wall time, e.g. 45 seconds. Leave unfinished claimed rows as durable
retry work rather than overrun a shutdown deadline. A singleton DB sweep lease,
e.g. 90 seconds, gates new claims by token; old finalizers are independently
asset-fenced. Remote retries remain idempotent if leases overlap after failure.

Do not hold a pool connection while doing S3 I/O. The current pool has only
`concurrency + 2` connections (`worker/cmd/worker/main.go:36`) and already serves
schema/metrics/other periodic work; bound and observe contention rather than
blindly enlarging it. Existing advisory topology lock uses a separate connection
(`worker/internal/worker/topology_lock.go:33`) and permits multiple dedicated
workers, so per-process batching alone is not a fleet-wide request-rate cap.

Both deployment topologies run this same entry point:
`worker/cmd/worker/main.go:45`; embedded supervisor spawns that binary with its
environment (`scripts/start-prod.mjs:231`); dedicated Compose builds/runs it
(`docker-compose.yml:63`). No new external cron or HTTP-per-drag cleanup is needed.

### 9. Storage capability, schema, environment, and rollout gates

For v1, use explicitly UNVERSIONED storage and immutable single-upload keys for
new imports. AWS documents that ordinary DeleteObject in a versioned bucket only
adds a delete marker; exact version IDs are required for physical reclamation.
Current helpers do not establish bucket versioning or inventory object versions.
An operator declaration alone must not become a silent reclamation guarantee.

Proposed concrete capability gate after approval: the configured import storage
adapter performs a bounded non-destructive `GetBucketVersioning` check (or an
equally explicit verified unversioned-provider capability). Only a verified
unversioned result enables new durable imports and deletion claims. Enabled,
suspended, denied, unsupported/unknown, or changed location results fail the
canvas storage capability and block reclamation. Refresh that capability before
sweeps/on a bounded schedule; actual PUT receipts with an unexpected version ID
must be recorded/quarantined rather than published as v1 READY. Storage location
changes require a verified matching adapter, not deletion against today's
unrelated bucket. Version-aware storage needs a separately implemented inventory
and exact-version deletion contract before claiming byte reclamation.

No destructive production canary is proposed at startup. Read capability does not
prove delete permission: runtime denial retains retryable inventory and exposes
cleanup failure metrics. Rollout must verify permitted storage behavior in the
disposable adapter and obtain any separately authorized real-storage validation;
this research made no bucket/API call. Unknown capability never causes a fake
successful delete or removal of roots/registry evidence.

| Integration file | Required later work |
| --- | --- |
| `prisma/schema.prisma:404` | Add independent canvas/import/run/use/lease models; keep generation retention and existing lifecycle columns unchanged. |
| `prisma/migrations/` | New additive migration with guards/indexes/FKs; never edit published migration SQL/checksums or run automatic repair. |
| `worker/internal/worker/schema.go:36` | Existing probe lists only generation tables. Add a separate canvas schema contract and compose it into readiness when canvas is enabled; verify tables, columns, unique/owner/root guards, indexes, and lifecycle constraints. |
| `src/lib/readiness.ts:58` | Current Next DB probe is only SELECT 1. Canvas-enabled readiness needs read-only canvas-schema verification and worker canvas capability, not only generic worker-ready. |
| `contracts/runtime/v1/environment.json:1` | Actual single environment manifest. Add shared `CANVAS_ENABLED` and worker GC bounds before loaders/docs/deployment fixtures. |
| `src/lib/env.ts:168` | Sole Node loader; parse shared capability flag/constraints here, not scattered `process.env` reads. |
| `worker/internal/worker/config.go:56` | Sole Go loader; parse shared enable flag and bounded worker-owned GC settings here. |
| `worker/internal/worker/storage.go:50` | Current injected object interface has PutObject only. Add tested delete/capability operations or a separate narrow import-GC adapter. |
| `worker/internal/worker/worker.go:90` | Managed GC lifecycle, capability/schema gate, joined shutdown, sweep lease, and structured redacted observability. |
| `scripts/start-prod.mjs:219` | Preserve migration-before-worker/app ordering in embedded deployment. |
| `Dockerfile:40`, `docker-compose.yml:63` | Both build the worker; ensure required contract/adapter files and explicit enablement reach both topologies. |
| `src/tests/contracts/runtime-environment-contract.test.ts:30` | Loader/read-path/docs audit must cover new manifest variables. |

Recommended new environment contract: shared `CANVAS_ENABLED=false` for staged
rollout; worker-owned `CANVAS_ASSET_GC_INTERVAL_SECONDS=60`, minimum 60; worker-owned
`CANVAS_ASSET_GC_BATCH_SIZE=20`, range 1-100. Keep seven days a fixed product
constant, not an operator knob that can shorten retention. If a dry-run switch is
added, normal enabled release must not silently run permanently in dry-run mode.

With canvas enabled, worker ready means canvas schema/storage capability and
managed scheduler are active as well as ordinary consumers/topology. Add an
explicit versioned capability to its ready response; Next checks it so a new
canvas-enabled app cannot appear ready against an old/canvas-disabled worker.
This requirement applies even when generic WORKER_READINESS_REQUIRED is otherwise
disabled. Transient delete errors back off and expose failures; missing schema,
unknown storage capability, or a dead scheduler is not advertised as available.

Rollout shape: additive migration -> new worker/app with canvas off -> verify
schema, disposable capability/race tests and both topology probes -> explicitly
enable canvas and its automatic cleanup together -> verify enabled readiness.
The release acceptance gate must use enabled mode; leaving the flag off does not
fulfill the feature. Rollback disables new canvas writes/claims and retains
additive schema, key inventory, snapshots, run/job roots, and normal jobs. Observe
existing generation rollback-preflight safety rather than changing handoff/refund
contracts.

### 10. Verification inventory and disposable test matrix

No tests in this section were executed during research. Existing anchors:
`src/tests/unit/parse-generate-request.test.ts:1`,
`src/tests/unit/generate-route-security.test.ts:1`,
`src/tests/unit/generation-cancel-route.test.ts:1`,
`src/tests/unit/admin-generations-cleanup-route.test.ts:1`,
`worker/internal/worker/storage_test.go:1`,
`worker/internal/worker/worker_runtime_test.go:1`, and
`worker/internal/worker/worker_contracts_integration_test.go:1`.

| Layer | Required assertions after approval |
| --- | --- |
| Node parser/service tests | Old JSON/multipart behavior unchanged; strict canvas branch; unsaved ready projection; count one/16 refs; ordering/type/ownership/missing input; no raw-URL ownership shortcut; saved-provider and CAPTCHA/moderation/charge reuse. |
| Snapshot/metadata route tests | Shell is not saved; explicit Rename does not save graph; revision conflicts; save-ID replay/hash conflict; capture/upload failure; all unused imports saved; no new upload for ready IDs; stale Save/Delete/tombstone races; no cancel/refund/media deletion. |
| Run/ACK-loss tests | Same intent/key concurrent requests commit exactly one job/charge; changed intent conflicts; expired preparation fenced; committed replay bypasses now-used CAPTCHA and lower balance; lost transaction/response ACK; null job-ID outbox lookup; deleted origin never reattached; admin-deleted job never regenerated by replay. |
| Owner hydration/chat tests | Batch caps and explicit missing entries; canonical job/image/asset ownership; exact run origin; no foreign IDs; only scene bindings reconcile; removed output remains removed; legacy conversation pagination still complete when canvas jobs fill global recent-job lists. |
| Upload and fake storage tests | Body/type/digest/size checks; atomic concurrent quota reservation; duplicate ready identity/pending 202; storage error/timeout/late PUT/fence loss; recorded key retention; no versioned/unknown capability reclamation; unchanged repeated saves use the original object. |
| Go scheduler/runtime tests | One managed scheduler independent of generation concurrency; fake-clock seven-day boundary; bounded pass/remote timeout/backoff; shutdown and topology loss stop claims/join; schema/capability failures not ready; multiple dedicated replicas/sweep fencing. |
| Disposable PostgreSQL races | Empty and legacy-plus-additive schema; attachment guard and owner FKs; save/enqueue vs GC row-lock races; detach with another root remaining; pending/completed/failed job-use roots retained; delete failure cannot erase inventory; upload/delete lease staleness; quota and idempotency concurrency. |
| Disposable object-store/topology integration | Controlled Put/Delete/GetBucketVersioning adapter; late/failed operations and missing keys; embedded/dedicated enabled readiness and shutdown; no real S3/CDN calls; generated/legacy objects never deleted. |

Keep API code tests under current Vitest mocks and run Go tests through existing
wrappers. Real dependency tests require safe disposable runners with an explicit
sentinel and runner-generated localhost DB URL, owner labels, tmpfs, locally
inspected images, `--pull=never`, and checked cleanup targets. Reuse
`scripts/lib/disposable-postgres.mjs:1`; do not read/fall back to actual
environment database credentials.

The current generation DB harness applies only two hardcoded additive migrations
(`src/tests/integration/worker-contracts/postgres-runner.ts:37`). A new
enabled canvas suite must use its own complete additive/full-history setup or
explicitly extend that safe harness. Preserve generation-only legacy fixtures
under the disabled flag; do not demand canvas tables in unrelated old snapshots.

New DB/object integration tests must be excluded from ordinary full Vitest and
covered by an explicit wrapper/CI stage. Current `verify:ci` excludes just the
worker DB file (`scripts/verify-ci.mjs:54`). Also, the current worker wrapper has a
57-second parent deadline (`scripts/verify-worker-contracts.mjs:12`) while its DB
runner itself declares 150 seconds
(`src/tests/integration/worker-contracts/postgres-runner.ts:24`): do not
nest a larger canvas DB suite beneath that short parent. Give new disposable
integration its own longer bounded process/deadline and cleanup reserve.

`docker-compose.e2e.yml:40` currently has no mock S3 service. Add only runner-owned
disposable/mock storage for enabled canvas E2E, rather than pointing tests at a
configured real bucket. GitHub Actions should call repository wrappers
(`.github/workflows/verify.yml:1`), not duplicate their command lists. Existing
lint/type-check/build, generation/worker contracts, migration, and topology E2E
gates remain in force.

### 11. Conversation loading is a compatibility prerequisite

Independent canvas jobs will join the owner's global recent-generation pool,
but cannot be used as conversation fallback content. The current create page
loads only latest 50 jobs (`src/app/create/page.tsx:36`), while conversation IDs can
refer to older jobs. Current `/api/me/generations` has no query parser and returns
global latest 24 (`src/app/api/me/generations/route.ts:7`); the conversation detail
route has only PATCH/DELETE (`src/app/api/me/conversations/[id]/route.ts:9`).

Before introducing more global canvas jobs, add a bounded owner/conversation
content loader, preferably
`GET /api/me/conversations/:id/generations?cursor=...`. Validate the owned parent
and cursor; query by `(userId,conversationId)`, use stable `(createdAt,id)` order
and an opaque validated owner-scoped keyset cursor, serialize through existing
generation mappers, and return explicit pagination metadata. Alternatively, add a
validated conversation/cursor branch to the existing global route while preserving
its unchanged no-query response. Do not delete the latest-50 query simply because
history presentation is removed; replace the actual conversation-loading need.

Frontend loading caches by canonical owner/conversation ID and rejects stale
selection epochs/aborted responses. Neither global latest jobs nor canvas runtime
resolution can populate a different or deleted conversation.

## Related Specs

- `.trellis/workflow.md`: research/design before activation; task permission is
  not implementation permission; research belongs in task artifacts.
- `.trellis/spec/frontend/type-safety.md`: Zod external validation, server-only
  services, safe serialized DTOs, no Prisma entities/credentials across clients.
- `.trellis/spec/frontend/state-management.md`: scoped content, guarded props and
  async ownership, no global history fallback into conversations.
- `.trellis/spec/frontend/generation-worker-contracts.md`: preserve Node/Go
  lifecycle/charge/refund/attempt contracts and disposable DB safety.
- `.trellis/spec/frontend/quality-guidelines.md`: route tests/mocks, verification
  wrappers, DB exclusions, and manifest-loader audit.
- `.trellis/spec/operations/media-storage.md`: production S3 policy, legacy
  readable media, optional generated storage metadata, no real-storage research
  operations or unauthorized production cleanup.
- `.trellis/spec/operations/release-hardening.md`: additive migration, both
  topologies, readiness/shutdown, loader ownership, safe runners and rollback.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` and
  `.trellis/spec/guides/code-reuse-thinking-guide.md`: shared input/DTO ownership,
  explicit boundary round trips, and generation pipeline reuse.

## External References And Versions

- PostgreSQL 17 explicit locking, read 2026-10-28:
  https://www.postgresql.org/docs/17/explicit-locking.html . Row locking/consistent
  lock order underpin guarded attachment versus deletion; they are not a
  substitute for object-store fencing and tombstones.
- AWS S3 DeleteObject API, read 2026-10-28:
  https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html . Versioned
  buckets require exact version deletion; delete markers alone do not free
  retained versions. Compatibility with the actual configured provider is NOT
  established by AWS documentation.
- Declared dependencies read from `package.json`: Next 16.2.4, React 19.2.4,
  Prisma/@prisma/client `^7.7.0`, Zod `^4.3.6`, Node S3 SDK `^3.1034.0`, Vitest
  `^4.1.5`. These are declared constraints, not an installation inspection.
- `worker/go.mod:3`: Go 1.24 language declaration; Go S3 SDK `v1.88.4`
  (`worker/go.mod:9`) and pgx `v5.7.6` (`worker/go.mod:10`). Container builder
  versions can differ from the language declaration.

## Caveats / Not Found

- Canvas/import/run/use models, all proposed new routes, capability checks,
  quotas, cleanup, and idempotency fencing do not exist yet. This is a proposal,
  not a report of working code or passing tests.
- No server/storage capacity, provider limits/costs, bucket policy/versioning,
  measured scene sizes, spare DB connections, deployed secrets, or actual media
  inventory was inspected. Numerical defaults are unmeasured safety proposals.
- Existing generated media lacks verified byte lengths, so complete pre-enqueue
  reference-size assurance needs metadata/bounded fetch; worker enforcement
  remains authoritative in the unchanged model.
- The release-hardening spec names a stale environment manifest filename. Actual
  source is `contracts/runtime/v1/environment.json`; the named
  `runtime-environment-contract.json` is absent. Record a spec correction in the
  later implementation/spec-update phase; this researcher did not edit specs.
- Unversioned import-storage verification may be unsupported by some S3-compatible
  providers; unknown must fail closed for reclamation, not be guessed from a URL.
  Version-aware inventory is required before supporting physical cleanup there.
- Account deletion/explicit legacy admin job deletion must not silently erase
  key/input protection evidence. A new physical account purge policy is outside
  the selected organization-removal feature.
- Rootless imports can expire even while an unsynced local draft still mentions
  them. Preserve its graph/prompt metadata, show missing-input recovery, and use
  a fresh validated upload identity; never report a falsely saved/runnable scene.

## Planning Consistency Review (2026-10-28)

- Scope: static parent/canvas-child PRD/design/plan comparison, not new source
  investigation or application, database, storage, or deployment verification.
- Resolved: the independent `verify:canvas-contracts:db` wrapper has a longer
  deadline/cleanup reserve and explicit CI stage; ordinary suites exclude its
  sentinelled file as well as the existing worker DB file. See
  `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/implement.md:137` and
  `.trellis/tasks/10-28-studio-dual-mode-canvas/implement.md:61`.
- Verified: database-authoritative grace/lease timing is explicit at
  `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:403`; late-PUT exact-key
  inventory/tombstones and uncertain physical accounting survive deletion retries
  at `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:421`.
- Verified: unversioned capability/unknown failure gate, shared feature-off
  staging then enabled schema/scheduler readiness, and retained-data rollback
  match this report; see `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:435` and
  `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:457`.
- Result: no remaining backend operations planning blocker. Capability compatibility,
  quotas, races, wrapper execution, and both topologies still require the planned
  authorized implementation checks; none passed merely because this review exists.
