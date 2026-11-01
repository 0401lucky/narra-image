# Research: Canvas backend, persistence, execution, and cleanup contracts

- Query: What concrete backend contracts support independent manually saved
  canvases, manually run connected nodes, upload-once references, and safe
  seven-day cleanup without changing conversation, generation, or works retention?
- Scope: mixed; primarily repository architecture and proposed backend contracts,
  with PostgreSQL locking and S3 deletion documentation as external references.
- Date: 2026-10-28
- Method: static source/spec inspection and official documentation reads only.
  No code changes, installations, tests, database connections, storage operations,
  migration execution, deployment inspection, or actual secret/config-file reads.
- Product authority: the current task PRD, especially R6-R17. Earlier exploratory
  shared-conversation canvas and account-autosave recommendations are superseded.
- Status: technical recommendations for the main session's design review, not
  implemented services or authorization to begin implementation.

## Findings

### 1. Existing facts and reuse boundary

| Source | Established behavior |
| --- | --- |
| `src/app/api/generate/route.ts:44` | Auth, parsing, CAPTCHA, moderation, provider resolution, source handling, enqueue, and charging already form one generation pipeline. |
| `src/app/api/generate/route.ts:90` | Custom generation can use the owner's saved provider credentials when none are supplied in the request. |
| `src/app/api/generate/route.ts:136` | Conversation ownership is checked before binding a job. A canvas run must use a separate origin, not an invented conversation. |
| `src/app/api/generate/route.ts:153` | New reference files are currently uploaded before the enqueue transaction, without a canvas asset registry. |
| `src/app/api/generate/route.ts:177` | Job creation and conditional credit deduction happen transactionally. |
| `src/app/api/generate/route.ts:211` | `sourceImageUrls` is the existing worker-input snapshot. |
| `src/app/api/generate/route.ts:269` | The route's post-enqueue catch can fail/refund its job; an idempotent replay must not accidentally enter this compensation path. |
| `src/lib/generation/parse-generate-request.ts:59` | Multipart references are capped at 16 and image-to-image count is forced to one. |
| `src/lib/generation/parse-generate-request.ts:146` | The current JSON parser returns an empty `imageUrls` array. Adding JSON reference fields without a new typed branch does not work. |
| `src/lib/validators.ts:61` | Shared generation normalization already exists; prompts need 2-8000 characters at execution and ordinary image count is 1-4. |
| `worker/internal/worker/storage.go:255` | The worker enforces a 32 MiB aggregate decoded-source limit; remote sources are additionally individually bounded. |
| `prisma/schema.prisma:453` | Conversation removal retains jobs through `SetNull`; generated images belong to jobs, not canvas layout. |
| `prisma/schema.prisma:511` | Generated images have canonical identity, URL, dimensions, and optional storage metadata, but no recorded byte length. |
| `src/lib/server/works.ts:128` | Works are loaded by job ownership independently of conversation membership. |
| `src/lib/storage/persist-generated-image.ts:132` | The existing Node helper chooses a fresh random key and returns only a URL; it is not an upload-once reference API. |

Reuse provider routing, encrypted job credentials, moderation, CAPTCHA, billing,
generation contract fields, worker claim/handoff, polling DTOs, cancellation, and
refunds. Add canvas ownership/input resolution and idempotency around that path;
do not copy it into a second worker lifecycle. No whole-graph scheduling is needed.

### 2. Minimal additive persistence proposal

Names below are proposed, not existing Prisma models. Keep geometry and
incomplete editing state in one bounded versioned JSON document rather than
making every pointer move a relational write.

| Proposed record | Important fields and invariants |
| --- | --- |
| `Canvas` | Client UUID primary identity, immutable owner, title, `revision`, nullable `scene`, nullable `lastSavedAt`, last-save UUID/hash/acknowledged revision, timestamps, and `deletedAt` tombstone. A shell has `scene=null`; it is not an account-saved canvas document. |
| `CanvasImportAsset` | Immutable owner/upload UUID, server asset ID, verified SHA-256/bytes/type, import-only kind, recorded endpoint/location/bucket/key, nullable object version ID, lifecycle state, upload fence/expiry, readiness time, detach time, preparation protection expiry, delete fence/expiry/backoff, and remote-outcome/tombstone metadata. Unique `(ownerId, uploadId)` and unique physical object identity. |
| `CanvasSavedAssetUse` | Distinct `(canvasId, assetId)` roots derived from the last successful saved document, with owner consistency and an asset-attachment guard. Local draft edits do not update these rows. |
| `CanvasRun` | Unique `(ownerId, runId)`, immutable `(canvasId, nodeId)`, normalized intent hash/input snapshot, `PREPARING/COMMITTED/REJECTED` state, preparation fence/expiry, immutable original job ID, nullable live-job relation, and safe preparation error. No layout or current job-status mirror. |
| `CanvasJobAssetUse` | Immutable submitted-input roots for each asset used by a committed run/job, including input ordinal. Retained after canvas/node removal and normal job termination. Use stable original job identity plus a nullable live-job FK if preserving the ledger across existing explicit administrative job deletion. |
| `CanvasGcLease` | A singleton sweep lease/token/expiry to avoid every dedicated replica independently consuming a full cleanup batch. Individual asset delete leases still fence retries and stale finalizers. |

Use owner/state/eligibility indexes for bounded cleanup and owner/canvas indexes
for metadata lists. Asset-use insertion should lock the asset and reject an owner
mismatch or a state other than `READY`; a database guard makes the invariant
shared by Node save/enqueue and Go cleanup, not just a route convention.
Detach/reattach maintenance belongs to these guarded transactions. Define one
consistent lock order and retry bounded database serialization/deadlock failures.

Do not add a cascading `Canvas -> GenerationJob/GenerationImage` relation. A
canvas origin can remain in the independent run ledger after organization is
deleted. Do not make new job-input FKs unexpectedly block existing administrator
cleanup of failed legacy jobs with no attempts
(`src/app/api/admin/generations/cleanup-failed/route.ts:11`). A committed run whose
job was independently physically deleted returns a missing-job outcome, not a
new job under the same run ID.

Do not cascade-delete the asset registry and lose known object keys when an
account is removed: the current administrator account route deletes the user
(`src/app/api/admin/users/[id]/route.ts:25`), and jobs already cascade from that
user (`prisma/schema.prisma:450`). Preserve immutable principal/key tombstones
with nullable live relations. This task does not authorize a new physical
account-media deletion policy; retain submitted-input protection conservatively
until a separately defined explicit purge policy applies.

### 3. Canvas identity, title management, and manual snapshots

Recommended explicit command/API split:

| Proposed operation | Contract |
| --- | --- |
| `POST /api/me/canvases` | Explicit New registers the client UUID and owner metadata shell, `scene=null`, initial revision zero. Retrying the same owned live ID returns its current shell without overwriting it. A foreign or deleted ID is not recreated. |
| `GET /api/me/canvases` | Bounded paginated metadata only: ID/title/revision/last-save time/`hasSavedSnapshot`. Never include every scene, asset original, or job. |
| `GET /api/me/canvases/:id` | Owner-scoped live shell or last acknowledged saved document; `hasSavedSnapshot=false` means no cloud draft contents are available. |
| `PATCH /api/me/canvases/:id` | Explicit Rename with title and expected revision. The title is account metadata outside scene JSON. Rename advances the shared row revision but does not save or mark local graph edits as synced. |
| `PUT /api/me/canvases/:id/snapshot` | Explicit Save with expected revision, fresh save UUID, and normalized bounded scene. Validate assets/origins, replace document and saved-asset roots atomically, advance revision, and acknowledge this exact scene/hash. |
| `DELETE /api/me/canvases/:id` | Explicit deletion with expected revision. Tombstone the ID, clear its document/saved roots, advance revision, and retain jobs, generated media, and job-input roots. An already owned tombstone can return an idempotent deleted response. |

If shell creation fails or the browser is offline, retain the same local UUID and
draft; a later explicit New/Save/Run retry ensures that same identity. Do not
silently switch to another ID, continuously synchronize draft contents, or label
a shell/newer local edits account-saved. Other devices can list a shell but cannot
restore its browser-only nodes. Run-before-Save is allowed once its live owner
shell exists.

One coarse revision across Save/Rename/Delete is sufficient for v1. A stale
mutation returns `409 CANVAS_REVISION_CONFLICT`; retain the local draft and offer
reload/reconciliation, not an automatic last-writer-wins overwrite. Node removal
is initially a local scene mutation: its saved asset roots remain until a later
explicit successful save or canvas deletion. No cancel or works-delete call is
part of node/canvas removal.

The server checks the canvas tombstone before snapshot/rename replay. A delayed
save must never revive a deleted ID. Save and Delete lock/CAS the same canvas row:
whichever commits first determines the revision visible to the other; stale
Delete must not discard a newly saved document. An incoming run only needs a
live canvas, not the document revision; its final enqueue also locks that row.
If deletion wins, a new enqueue is rejected. If enqueue wins, its job continues
without recreating canvas organization.

Save captures a specific local scene revision before uploads. Upload every
unsubmitted local reference in that snapshot, resolve previously uploaded IDs,
then commit scene plus roots in one short transaction. No object-store requests
occur inside that transaction. If one upload or validation fails, no successful
snapshot acknowledgement is returned; keep the local scene and successfully
uploaded staged identities for retry. Saving references submits no generation.

Lost Save acknowledgements use the stored last-save UUID/hash/acknowledged
revision. A matching currently retained receipt can return its exact acknowledgement
without another document write; reuse of an ID with a different snapshot is a
conflict. A later distinct save replacing that receipt must not be overwritten by
an older retry; return conflict/current metadata rather than inventing success.
This does not require storing unlimited historical scene snapshots. Responses
distinguish the acknowledged saved revision from the current row revision.

### 4. Shared upload identity, leases, and quota

Propose one owner-scoped importer used before either explicit Save or Run:
`POST /api/me/canvas-assets`, plus an owner-scoped upload-ID status lookup. A
multipart upload carries stable client `uploadId`, declared byte length/type,
SHA-256, and the file. The server validates declarations against actual bounded
bytes and verified content; a file extension or `image/*` string is not proof.
Do not accept arbitrary external URLs or client-selected bucket/key/owner fields
as owned imports.

1. Authenticate and apply bounded request/body and concurrency controls. Reserve
   the owner byte/count/staging quota and registry/key BEFORE any remote PUT.
   A declared size is only a reservation; require exact verified bytes/digest
   before storing or finalizing. Registry reservations themselves are bounded.
2. Unique `(ownerId, uploadId)` selects one immutable payload. A different hash,
   bytes, or verified type with the same identity returns `409`. A matching
   `READY` identity returns its original asset ID without another object write;
   a matching active `UPLOADING` request returns `202`, not a second PUT.
3. PUT the verified bytes outside the database transaction, with a bounded
   timeout and recorded immutable key/location. Finalize `READY` only if the
   original upload fence/state/lease still permits it. Initialize orphan grace
   at successful readiness when no saved/job root exists.
4. Ambiguous remote failure or an expired upload lease must not be reclaimed by
   another PUT to that same key, nor allow a stale process to publish `READY`.
   Retain the known key/outcome tombstone; require a fresh upload identity for a
   replacement after terminal expiry. Matching retries/status checks discover
   the old outcome first. Ordinary later saves/runs reuse an existing ready ID.
5. Failed or detached objects count toward quotas while their physical outcome
   is unresolved; do not release storage accounting merely because a browser
   abandoned its save. Delete success/finalization and uncertain late writes
   require explicit accounting rules, not an unconditional registry cascade.

This is upload-once identity reuse, not global cross-user content deduplication.
Saving/running an unchanged ready reference sends its asset ID, not another file.
A lost first upload response may require a status lookup or resending its body,
but must not create another physical object. Generated image IDs remain canonical
generated media and are not copied into the disposable-import registry.

Suggested unmeasured safety defaults: scene 512 KiB, 200 nodes, 400 edges; imports
8 MiB each; at most three active upload reservations per owner; e.g. an owner
1 GiB/1000-import retained-byte/count quota and a bounded canvas-shell count.
These are technical starting limits, not business pricing or server-capacity
measurements. Define actual limits once in shared validators/constants and use
the same values in UI errors and route tests. Rejected limits preserve drafts.

New durable imports should use registered S3 objects. Production must never fall
back to new base64 database media; preserve legacy reads separately
(`.trellis/spec/operations/media-storage.md:11`). The existing Node fallback has
no equivalent visible production guard
(`src/lib/storage/persist-generated-image.ts:153`); do not inherit it as the new
importer's policy. Disposable/mock S3 is the safe verification environment.

### 5. Frozen direct inputs and the opt-in generation branch

Add a strict JSON `canvasRun` branch to the existing `/api/generate` parser, with
one authoritative frozen input projection rather than duplicate prompt/reference
fields. The following field arrangement is a proposal to align with the frontend
contract, not a new endpoint or final generated schema:

```text
canvasRun:
  canvasId, nodeId, runId
  prompt: sourceNodeId + text
  references: [{sourceNodeId, ordinal, kind: imported, assetId}
               OR {sourceNodeId, ordinal, kind: result, imageId, jobId}]
  params: normalized nonsecret generation options
turnstileToken: existing transient CAPTCHA field
customProvider: existing transient credential request, if necessary
```

Validate canvas/run UUIDs, bounded stable node/canonical ID strings, parameter
enums/size/prompt bounds, owner identity, and direct references with Zod. Result
node IDs such as `result:${imageId}` are not UUIDs. Reject `conversationId`,
failed-chat `replaceGenerationId`,
video generation, raw `imageUrls/referenceImageUrls`, client data/blob URLs,
mixed duplicate common prompt fields, and unvalidated files in this new branch.
Keep the no-canvas JSON and multipart chat contracts unchanged. Map the validated
canvas projection into the existing normalized enqueue input.

Semantic edge rules shared with the frontend:

- Exactly one connected prompt supplies the target generation at execution.
  Incomplete editing documents can still be saved; Save is not Run.
- Image-input edges run from imported references or immutable completed results
  into the generation. Ordinal 1-16 is the single ordering authority; reject
  duplicate source/slot/canonical identity, gaps, invalid endpoint kinds, and
  literal self-edges.
- With zero image inputs use text-to-image; with 1-16 inputs use image-to-image,
  count one, with the existing image-edit option normalization. Do not silently
  drop references or promise four edit outputs. Generation text count remains
  the existing 1-4 range where applicable.
- Output-provenance edges go generation -> result and are non-executable. There
  is NO general DAG/cycle ban: a prior completed immutable result may feed its
  originating generation for iterative editing. Resolve only this run's direct
  ready inputs, never traverse or schedule upstream/downstream nodes.
- Resolve asset IDs through the owner's `READY` registry rows; resolve image IDs
  through their canonical owned job/media rows and require completed usable media.
  Validate a supplied job ID against the image's actual job rather than trusting
  it. Missing/unready input is actionable and prevents that run.

The server validates this submitted UNSAVED projection, not equality with the
last manually saved graph. Otherwise unsaved edits and Run-before-Save would fail.
Its immutable run snapshot records source-node IDs, order, prompt, options, and
canonical source identities; final job `sourceImageUrls` is the worker projection.
Client URLs/labels never establish asset ownership or deletion rights.

The 32 MiB limit is an aggregate decoded reference-input limit, not a 16 x 8 MiB
allowance. Node can precheck verified imported byte lengths, but current generated
images have no byte-length column (`prisma/schema.prisma:511`); without new verified
metadata or a bounded fetch it cannot truthfully precheck every canonical image.
The existing worker must recheck all downloaded sources at 32 MiB
(`worker/internal/worker/storage.go:255`). Do not claim an unknown-size input was
verified under that cap before enqueue. Legacy owned generated data URLs can be
resolved only through trusted canonical image IDs if supported; the worker
already parses them (`worker/internal/worker/storage.go:261`). Never relax general
public URL/redirect safety to accept raw client data URLs.

### 6. Run idempotency, enqueue, and immutable attachment origin

A unique final run/job key alone is insufficient: two requests can both spend
time validating/uploading, or a retry can be rejected by a used CAPTCHA before
discovering its existing job. Proposed sequence:

1. Authenticate and normalize/hash the stable submitted intent: origin, prompt,
   ordered canonical identities, and parameters/provider selection. Exclude
   CAPTCHA, display URLs, local edit counters, and save revision. Where transient
   credentials affect intent, use a non-reversible fingerprint, not plaintext
   credentials in scene/run JSON. Saved-provider selection is resolved into the
   original encrypted job snapshot, not re-resolved on a committed replay.
2. Look up/reserve `(ownerId, runId)` in a short transaction. A matching committed
   replay returns the same canonical job BEFORE CAPTCHA, current credit/provider,
   or now-missing-media checks, without another charge. A changed intent is `409`;
   active preparation is `202`/same-key retry. Preserve committed identity even if
   its canvas was subsequently deleted; that job belongs in works.
3. A fresh preparation owns a short fencing lease, e.g. two minutes. Perform
   CAPTCHA/moderation/provider/URL-safe resolution on this genuinely new run.
   Protect ready referenced imports with bounded preparation expiry as needed;
   independent leases must not be cleared by an older concurrent request.
4. Final enqueue transaction locks the live owned canvas, run reservation, and
   sorted referenced assets/canonical media; verifies current preparation token
   and lease, readiness/ownership, and resolves immutable URL snapshots. Create
   the normal job, input-use roots, committed run binding, and conditional credit
   deduction in that SAME transaction. No object-store I/O is held inside it.
5. Expired preparation may be taken over only with a new fence; the old request
   cannot enqueue afterward. Preparation errors create no job/charge. An
   uncertain transaction/response outcome is resolved by the same run ID, not by
   automatically choosing another ID or failing/refunding an already committed
   job. Keep the existing catch/refund code outside this replay boundary.

Each genuine rerun gets a fresh run UUID and retains older runs/results. Editing
inputs after clicking Run does not mutate the frozen request. Failed chat bubble
replacement is not the canvas history model.

Capture `(ownerId, canvasId, nodeId, runId)` before asynchronous work. Route job
updates through this immutable origin plus the root runtime job cache, not the
currently selected conversation/canvas/mode. Removed generation nodes/canvases
lose attachment rights; completion still updates its canonical job/works. Neither
node removal nor mode switching issues cancellation/refunds.

### 7. ACK-loss lookup, bounded hydration, and saved-scene reconstruction

Propose `GET /api/me/canvas-runs/:runId`, authenticated and owner-scoped:

- `COMMITTED`: return original `(canvasId,nodeId,runId)` and canonical job ID/DTO,
  even if organization is deleted; do not grant attachment to a removed entity.
- `PREPARING`: return `202` plus bounded retry advice, without submitting again.
- `REJECTED`: return safe preparation error/no-job status; no generation retry.
- Unknown: `404`, without revealing another owner's key. This is NOT proof that
  an earlier request cannot still arrive; a local outbox must retain its run ID
  and frozen intent. A deliberate retry uses that same ID, never a new one merely
  because an acknowledgement or lookup was missing.
- Committed original job independently deleted: explicit missing-job outcome,
  never another enqueue under the committed key.

Persist a local submission outbox BEFORE sending the generation request; it can
have preallocated run ID and `jobId=null`. Store no CAPTCHA/provider secret in the
durable scene/outbox. Recovery can query that run ID and rebind the same canonical
job. Any retry requiring fresh CAPTCHA/ephemeral credentials remains visible;
loading an outbox is not permission to auto-run a graph.

Add a bounded read-only runtime-resolution API, e.g.
`POST /api/me/canvas-runtime/resolve`, accepting the selected canvas and explicit
referenced run/job/image/asset IDs. Cap body/IDs (e.g. 200 distinct IDs per batch),
deduplicate, return canonical serialized DTO maps plus explicit missing entries,
and chunk larger documents. Validate all requested IDs under the account. For
run bindings additionally verify exact canvas/node/run/job association. A result
image's ownership comes from its actual job. Do not accept cached client URLs as
the authoritative hydrated media or fetch arbitrary URLs from this endpoint.

The versioned scene carries accepted
`runBindings[{runId,nodeId,jobId,outputsHandled}]` with a non-null canonical job ID.
Allow one current accepted binding per generation node, not an unlimited scene
attempt-history array. Older result nodes retain their immutable job/image IDs
and optional run ID after the generation's current binding changes.

Unconfirmed preallocated IDs and null job IDs belong ONLY to the local submission
outbox, not accepted cloud bindings. Save during uncertain acceptance captures
the existing scene/accepted bindings and must not claim the missing job ACK was
received. Late acceptance/recovery changes the local draft and leaves it visibly
newer/unsynced until a later explicit Save. Reject fabricated or mismatched
accepted bindings during snapshot validation. Read-only run lookup itself does
not write a cloud scene.

Only bindings PRESENT IN THE RESTORED SAVED SCENE are reconciled on another
device. Never query all server runs associated with a canvas and manufacture
nodes: runs submitted after the last manual save belong to works and that
originating local draft/outbox, not the old account snapshot. A recorded pending
binding can derive its later canonical completion when viewed; this is not
background cloud scene saving.

Terminal materialization is one atomic local scene/IndexedDB mutation: append
one stable result node per canonical image, set `outputsHandled=true`, and retain
that flag when results are manually removed. Current complete image batches are
verified: `completeJob` inserts all its images and finishes job/attempt success
within one transaction (`worker/internal/worker/worker.go:971`,
`worker/internal/worker/worker.go:1032`). The boolean is sufficient for this
contract; partial-output streaming would need a future handled-image-ID contract
instead. Delete generation bindings/edges and tombstone runtime attachment rights
when removing that node. No later poll, reload of that durable local suppression,
or old response may recreate a deleted result/node.

Unsaved local node deletion is not instantly global: another device can still
restore the last acknowledged older account snapshot that includes it. This is
the manual-save contract, not permission for a late callback to undo a newer
local deletion. Cloud canvas tombstones fence all later organization writes.
Frontend result-capacity reservation before submission is also required so scene
limits cannot silently omit a billable completed batch; generated media remains
in works independently.

## Companion Operations Report

- `.trellis/tasks/10-28-studio-dual-mode-canvas/research/canvas-backend-operations.md` preserves sections
  8-11: seven-day GC/late-write inventory, storage capabilities, schema/environment/
  rollout gates, disposable verification wrappers, scoped chat loading, and their
  complete source evidence/caveats. This split is for the context-injection cap,
  not a scope or retention-policy change.

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
- `.trellis/spec/guides/cross-layer-thinking-guide.md` and
  `.trellis/spec/guides/code-reuse-thinking-guide.md`: shared input/DTO ownership,
  explicit boundary round trips, and generation pipeline reuse.

## External References And Versions

- PostgreSQL 17 explicit locking, read 2026-10-28:
  https://www.postgresql.org/docs/17/explicit-locking.html . Row locking/consistent
  lock order underpin guarded attachment versus deletion; they are not a
  substitute for object-store fencing and tombstones.
- Declared dependencies read from `package.json`: Next 16.2.4, React 19.2.4,
  Prisma/@prisma/client `^7.7.0`, Zod `^4.3.6`, Node S3 SDK `^3.1034.0`, Vitest
  `^4.1.5`. These are declared constraints, not an installation inspection.
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
- Account deletion/explicit legacy admin job deletion must not silently erase
  key/input protection evidence. A new physical account purge policy is outside
  the selected organization-removal feature.
- Rootless imports can expire even while an unsynced local draft still mentions
  them. Preserve its graph/prompt metadata, show missing-input recovery, and use
  a fresh validated upload identity; never report a falsely saved/runnable scene.

## Planning Consistency Review (2026-10-28)

- Scope: parent/canvas-child artifacts only; no repeated source research.
- Resolved: initial and final node admission exclude other valid preparations and
  canonical PENDING/PROCESSING jobs after committed replay; see
  `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:304`.
- Resolved: section 5's flat illustration is the local projection; the sole nested
  wire format uses a shared pure encoder, not competing request fields; see
  `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:279`.
- Verified: accepted-only cloud bindings, pre-CAPTCHA/refund-safe replay, sorted
  asset locks, and 100 live canvases / 1 GiB / 1000 imports / 3 upload slots align.
- Result: no remaining backend planning blocker. This is not runtime verification.
