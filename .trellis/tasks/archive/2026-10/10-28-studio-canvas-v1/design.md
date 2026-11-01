# Independent canvas v1 technical design

## Authority And Evidence

- Child PRD C1-C11/CA1-CA13 and parent R1-R17 are product authority. This is a
  planning design; no dependency, schema, application, or production verification
  exists yet. Latest final-review approval and checked history handoff precede work.
- Detailed evidence is in the parent's `research/canvas-frontend-contracts.md`,
  `research/canvas-frontend-persistence.md`, `research/canvas-backend-contracts.md`,
  `research/canvas-backend-operations.md`, `research/current-studio.md`, library
  comparison, and retention/cost reports.
- The following schema/API names and safety defaults are the converged technical
  proposal for that review, not independently selected user product requirements.

## 1. Mounted Architecture And UI

```text
CreatePage -> serialized owner/catalog/config/scoped initial chat data
  GeneratorStudio (one mounted feature shell)
    chat controller -> ChatPane -> ChatStream + Composer
    canvas controller -> lazy CanvasStage -> controlled React Flow
    common generation transport + owner canonical job/source registry/poller
    local canvas draft/blob/outbox store; asset upload promises and runtime cache
    existing image viewer/download/settings/CAPTCHA presentation
```

- Use `@xyflow/react@12.12.0` MIT core after a narrow approved peer/build/input
  spike. Keep its internal store confined to rendering; no new app-global state
  library, copied Pro examples, reference-app styles, or browser-direct providers.
- Keep the existing cream/orange tokens, Chinese controls, named component
  exports, `next/dynamic` client-only pattern, explicit nonzero responsive stage,
  and safe recovery/return-to-chat on lazy-load failure. Ordinary renderer
  failures support an in-place retry. Actual Turbopack rejected chunk imports
  can remain cached despite a new React lazy loader: a `ChunkLoadError` must
  instead explain manual refresh and memory-only draft loss, preserve Return
  to Chat, and never silently reload, mutate bundler internals or resubmit.
- Put navigation/toolbars outside transforms. Use node drag handles and isolate
  textareas/IME/scroll/buttons with appropriate nodrag/nopan/nowheel behavior.
  Preserve keyboard selection/focus and Chinese accessible instructions.
- Move chat DOM measurement/observer/scroll/focus effects into its mounted pane
  while keeping business drafts above the renderer switch. Returning to chat
  must reattach composer observers, not reuse a vanished DOM ref.
- Mode switch is not New, generation-type switch, or content import. Default new
  node options come from supported account/catalog defaults, not the chat draft.
  URL initial prompt seeds chat only. Existing chat conversation-switch draft
  semantics remain; this does not invent full per-conversation draft persistence.
- Phone canvas rejects mutation commands as well as hiding controls: no New,
  Rename/Delete/Save, node edits/connections/drop/Run, or mutation shortcuts.
  Select/view/pan/zoom and existing image viewing/downloading remain; phone chat
  retains its composer/creation experience. Phone viewport inspection does not
  cloud-save a scene.

## 2. Identity, Domain Scene, And Runtime

Pass a studio-only authenticated `ownerId`; do not widen shared Video viewer
types. Client UUIDs for canvas/prompt/reference/generation/run/upload/save are
immutable and never reused. Canonical job/image IDs are bounded opaque server
IDs, not assumed to share UUID format. Result node ID is stable per image within
a canvas, e.g. `result:<imageId>`.

```text
CanvasSceneV1:
  schemaVersion: 1
  nodes: prompt | reference | generation | result
  edges: prompt-input | image-input | output-provenance
  viewport: finite x, y, zoom
  runBindings: [{runId, nodeId, jobId, outputsHandled}]
```

| Node | Durable Domain Fields | Runtime Only |
| --- | --- | --- |
| Prompt | ID/layout/text, including incomplete draft text. | Focus/validation/selection. |
| Reference | ID/layout and registered asset ID in cloud; local blob locator in local variant. | Blob/File, preview/display URL, upload/missing state/promise. |
| Generation | ID/layout and normalized nonsecret current provider/model/size/quality/output/moderation/count/options subset. | Credentials/challenge, submission phase, canonical status, reserved result capacity. |
| Result | Stable canonical job/image IDs and layout; run identity when recording output provenance. | Current URL, actual image dimensions, availability. |

Title/owner/cloud revision are document metadata outside scene JSON. A document
binding is the single accepted-run authority, not duplicated latest-job fields
on generation nodes. `jobId` is non-null for cloud/accepted bindings; a null job
ID belongs only to the local uncertain-submission outbox.

Scenes never contain file bytes/base64, URLs, credentials, callbacks, library
stores, measured DOM internals, or copied job-status snapshots. Runtime canonical
DTOs resolve IDs. Unknown scene/storage versions or malformed geometry produce
recoverable errors rather than loading an empty replacement document. Finite
negative world coordinates are valid; display geometry is not output pixel size.

## 3. Graph And Direct Input Rules

- `prompt-input`: prompt -> generation; exactly one is required to Run. Reject
  additional prompt inputs rather than concatenate or choose arbitrarily.
- `image-input`: reference or canonical completed result -> generation; ordinal
  `1..N` is the only ordering authority, `N <= 16`. Reorder explicitly; removal
  compacts ordinals. Node positions/object iteration never set reference order.
- `output-provenance`: generation -> its canonical produced result, created by
  materialization and validated against the run/job origin. It is not executable
  input or a user-manufactured output claim.
- Reject wrong/unknown endpoint kinds/ports, literal same-node links, duplicate
  edges/ordinals/sources, and repeated canonical input identity at one target.
  One source may feed several targets. A canvas may contain more than 16 reference
  nodes; only each target's input cardinality is capped.
- Do not impose a general DAG ban: a prior immutable result may feed its own
  originating generation for manual iteration. Resolution reads direct ready
  identities only, never traverses/schedules a visual cycle or upstream graph.
- A generation node is not an image input. Select a specific completed result;
  missing/pending inputs block Run and ask for explicit upstream generation.
- Deleting inputs removes incident edges; downstream becomes invalid rather
  than running automatically or receiving replacement content.
- Reserve the effective output count's node/provenance capacity before Run and
  preserve it during edits. A new billable result must not silently disappear
  because concurrent edits consumed the bounded scene's remaining slots.
  On restore, reconstruct unhandled pending reservations from canonical job
  output count or the outbox's frozen projection before capacity-consuming edits.
  Unknown bindings must resolve or conservatively block those edits; current
  edited node parameters are not the original count. Handled runs reserve nothing.

## 4. Initial Safety Limits

These are unmeasured protective defaults for v1, not capacity or pricing claims.
Define them once in shared contract/constants and reuse UI/server/tests; preserve
drafts on rejection. Existing generation limits remain authoritative.

| Surface | Default Bound |
| --- | --- |
| Live canvas shells per account | 100, including unsaved shells. |
| Scene | 512 KiB normalized UTF-8 JSON, 200 nodes, 400 edges. |
| Title | Trimmed nonempty string, at most 120 characters. |
| One imported original | 8 MiB verified bytes and supported verified image type. |
| New import storage per owner | 1 GiB and 1000 physically accounted imports; generated/legacy media excluded. |
| Active upload reservations | 3 per owner; byte/count reservation before remote PUT. |
| One target run | One prompt of 2-8000 characters; 0-16 ready ordered images. |
| Output count | Text-only 1-4; any image references means image-to-image count 1. |
| Aggregate decoded run images | Existing worker 32 MiB cap; Node prechecks known imported sizes only. |
| Runtime resolution | 200 distinct ID slots per bounded batch; chunk larger scenes. |
| Metadata/conversation pages | Default 50, maximum 100; stable keyset cursors, not full startup history. |

Bound transport bodies before untrusted buffering: small metadata/run/resolve
JSON, snapshot document plus bounded envelope, and one 8 MiB multipart original
plus bounded overhead. Content-Length alone is not enforcement. Reject extra
files/oversized bodies/declarations. Snapshot byte limits do not forbid saving
incomplete prompt inputs; Run performs execution validation separately.

Current generated images have no verified byte length. Do not claim complete
precharge aggregate-size assurance for mixed/generated inputs: the existing
worker validates all downloaded sources at 32 MiB, with ordinary failure/handoff/
refund semantics unchanged. Adding byte metadata or bounded prefetch is not
required to rewrite the existing generation pipeline in v1.

## 5. Additive Persistence And Locking

| Proposed Model | Required Invariants |
| --- | --- |
| Canvas | UUID, immutable principal, title, coarse revision, nullable scene/lastSavedAt, last-save ID/hash/ack revision, deletedAt tombstone. scene=null means unsaved shell. |
| CanvasImportAsset | Unique owner/upload ID and physical location/key; verified digest/bytes/type, import-only kind, monotonic lifecycle, upload/preparation/delete fences/leases, detach/backoff/remote outcome. |
| CanvasSavedAssetUse | Distinct canvas/asset roots derived only from last successful saved snapshot. |
| CanvasRun | Unique owner/run ID; immutable canvas/node/intent/input snapshot, PREPARING/COMMITTED/REJECTED, preparation fence/expiry, immutable original job ID and nullable live relation. No job-status mirror. |
| CanvasJobAssetUse | Immutable ordinal/import roots from submitted inputs, retained through node/canvas deletion and job termination. |
| CanvasGcLease | Singleton sweep token/expiry controlling fleet-wide claims; per-asset tokens still fence finalizers. |

No Canvas -> GenerationJob/Image cascade. Preserve immutable original principal/
job/key inventory with nullable live relations so existing administrator job or
account deletion does not unexpectedly fail or erase retention evidence. Missing
live jobs are unavailable, never regenerated under a committed run ID. A new
physical account purge policy is out of scope; retain input protection
conservatively rather than infer object deletion from legacy cascades.

Saved/job root attachment requires owned READY assets and uses a shared database
guard/row lock, not only Node route discipline. Lock a live canvas, run/admission
row where needed, then all affected asset rows in sorted identity order before
root mutations; GC locks assets only, never a canvas after holding an asset.
Serialize quota reservations under an owner-scoped transaction gate, with bounded
serialization/deadlock retry. Keep object I/O outside short DB transactions.
Eligibility is derived from roots/leases plus authoritative detach time, not a
second unsynchronized reference-count truth.

## 6. Owner API Contracts

All new routes are authenticated app routes, not public `/v1` provider APIs.
Validate bodies/params/cursors with shared schemas; return explicit serialized
DTOs and safe Chinese errors. Never expose Prisma entities, raw DB errors,
credentials, or client-selected owner/bucket/key fields.

| Route | Command / Response |
| --- | --- |
| POST /api/me/canvases | Explicit New with client UUID/title; create revision-0 scene-null shell or return existing owned live identity without overwrite. Foreign/deleted ID is never recreated. |
| GET /api/me/canvases | Bounded owner metadata pages: id/title/revision/lastSavedAt/hasSavedSnapshot. No all-scene or all-job payload. |
| GET /api/me/canvases/:id | Live shell or last saved scene/metadata. Unsaved shell never claims browser-only graph recovery. |
| PATCH /api/me/canvases/:id | Explicit title + expectedRevision; metadata CAS, not scene saving. |
| PUT /api/me/canvases/:id/snapshot | expectedRevision/saveId/resolved scene; atomically replace scene and saved-asset roots; return exact saved hash/ack revision and current metadata. |
| DELETE /api/me/canvases/:id | Expected-revision tombstone, clear saved scene/roots, retain jobs/results/job roots; owned already-deleted identity is idempotent. |
| POST /api/me/canvas-assets | Stable uploadId, declared length/type/SHA-256 plus one bounded file; return READY identity, active 202, or explicit failed/quarantined outcome. |
| GET /api/me/canvas-assets/uploads/:uploadId | Owner upload status for lost response; no second PUT just because status/ACK is missing. |
| GET /api/me/canvas-assets/:id | Owner canonical asset state/verified media DTO; expired/missing state is actionable. |
| GET /api/me/canvas-runs/:runId | Read-only original origin/job or PREPARING/REJECTED/unknown/missing-live-job outcome, including after canvas deletion. |
| POST /api/me/canvas-runtime/resolve | Read-only bounded explicit scene ID hydration; maps plus missing entries, exact owner/run-origin validation. Never executes or saves. |
| GET /api/me/conversations/:id/generations | Owner/conversation keyset page; unchanged no-query global generation endpoint remains compatible. |

Foreign IDs return no ownership information. Resource/format errors, unavailable
inputs, active reservations, revision/intent conflicts, deleted IDs, and storage
capability failures have distinct stable codes; define their status/message
fixtures before handlers. Never silently replace missing data or force Save.

## 7. New, Rename, Captured Save, Delete

- New immediately creates an empty local UUID draft, then intentionally registers
  its metadata shell. Failure/offline preserves identity and visible retry;
  explicit New/Save/Run can ensure the same shell. No periodic shell/scene sync.
- Rename is an explicit metadata operation sharing coarse revision with Save/
  Delete. Update its ACK/title, not the locally saved graph revision.
- Serialize same-canvas metadata mutations. Save captures owner/canvas/save ID,
  expected cloud revision, local edit generation/deletion epoch and original blob
  identities before any uploads. It resolves every reference node, including
  disconnected/unsubmitted originals, not only this run's references.
- Reuse READY assets/upload promises. Map the frozen capture, then validate
  owned canonical images/accepted run origins/READY assets and commit scene plus
  saved roots atomically. Apply upload mappings to current nodes only when their
  captured blob identity still matches; do not overwrite a replacement file.
- Acknowledgement applies to that captured scene/hash. Newer edits, deletions,
  runs or selection stay local/dirty. Upload success is not saved-scene success;
  failed/conflicting saves keep local scene/files and retry identities.
- Cloud bindings contain acknowledged job IDs only. A Save during uncertain
  submission includes existing accepted bindings, not a fabricated null-job ACK.
  Late acceptance changes the local scene and needs a later manual Save.
- Last-save ID/hash/ack-revision supports lost-response replay while that receipt
  is retained. Matching replay returns the exact old ACK/current metadata;
  changed content or a replaced old receipt conflicts. Check tombstone first.
  Do not retain unlimited historical snapshots or overwrite a newer Save.
- A 409 preserves local content and offers explicitly warned account reload;
  no automatic merge/rebase/force overwrite, duplication, or timestamp-wins rule.
- Delete blocks preparation/attachment while pending; discard an account-backed
  draft/report deletion only after server ACK. Failure restores organization and
  error state. Known-never-registered local drafts can delete locally; uncertain
  in-flight shell creation must resolve its server/delete outcome, not pretend
  a possibly created cloud shell vanished. Successful deletion persists the
  local/server tombstone and rejects delayed responses. No cancel/refund call.
  Failed Delete restores live attachment and explicitly reconciles retained
  canonical terminal cache/accepted outbox/run lookup against still-current
  bindings. Terminal polling may already have stopped while deleting: catch up
  without new POST, resetting outputsHandled, or recreating removed result cards.
- Node deletion is local until explicit Save. The older account snapshot still
  legitimately contains unsaved-removed nodes on another device.

## 8. Upload-Once Import Protocol

Authenticate, bound body/concurrency, verify bytes/digest/content type, and reserve
owner byte/count/staging capacity before remote PUT. Treat declaration values as
reservations, not proof. Register the immutable trusted storage identity first;
never upload and then lose the only known key on a failed DB insert.

Unique owner/upload ID selects one immutable payload. Changed digest/bytes/type
conflicts; READY replay returns original asset without PUT; active UPLOADING
returns 202/status lookup. Perform at most the original fenced PUT with bounded
timeout outside transactions; publish READY only under the current lease/token.
Initialize orphan grace at successful readiness without saved/job roots.

An expired/ambiguous PUT is not permission to PUT the same key again or let a
stale request publish READY. Quarantine/retain its key/outcome/accounting and
reconcile that identity; a deliberate replacement uses a fresh upload identity.
Unchanged READY references are reused between Save and Run, not uploaded on
every save. This is not global/cross-owner content deduplication.

Only new imported originals enter this registry. Canonical generated results
remain job/image IDs, not uploaded copies. Raw external URLs, browser data/blob
URLs or user-supplied keys do not establish owned inputs. Existing chat file/URL
transport remains compatible; canvas uses files or canonical ready result IDs.
Production imports require S3-compatible persistence and explicitly reject new
base64 DB fallback. Existing legacy media reads remain unchanged.

## 9. Frozen Run And Idempotent Existing Generation

```text
POST /api/generate (strict opt-in JSON branch)
  X-Narra-Canvas-Run: 1
  Content-Type: application/json
  canvasRun:
    canvasId, nodeId, runId
    input:
      prompt: {sourceNodeId, text}
      references: [{sourceNodeId, ordinal, kind, assetId}
                   | {sourceNodeId, ordinal, kind, jobId, imageId}]
    parameters: normalized nonsecret generation options
  turnstileToken / customProvider: existing request-only runtime fields
```

The research's flat `CanvasRunProjectionV1` is a local resolver result, not a
second wire format. One shared pure encoder maps its prompt/references to
`canvasRun.input` and params to `canvasRun.parameters`, attaching transient
request fields separately. The server consumes only this strict nested wire
contract; renderers/routes must not each maintain a competing field list.

Implementation transport clarification: the additive opt-in header selects the
new 128 KiB stream-counted JSON boundary before buffering. A `canvasRun` member
without that header is rejected with `CANVAS_RUN_OPT_IN_REQUIRED`. Existing
no-canvas JSON and multipart retain their prior transport semantics; do not
apply this new cap globally to legacy requests. The shared input fixture owns
the header/value/content type and the shared encoder exports request headers.

Reject mixed common prompt/reference payloads, conversation/replace-job IDs,
video, raw URL lists, arbitrary files, and client data URLs in this branch.
Legacy no-canvas JSON/multipart behavior remains. Resolve zero images to
text-to-image, otherwise image-to-image/count 1 with existing edit normalization;
do not drop refs or allow JSON to bypass the 16-reference/input-byte constraints.
Run validates the frozen unsaved local projection, not saved graph equality.

1. Capture immutable owner/canvas/node/run and one coherent scene input revision.
   Check ready direct inputs/capacity, persist nonsecret local outbox before a
   potentially billable request, ensure live shell, and register new needed files.
   Slow preparation checks source still live before beginning POST.
2. Authenticate/strictly normalize intent and fingerprint origin, prompt,
   ordered canonical identities and parameters/provider selection. CAPTCHA,
   display URLs, save revisions and edit counters are not identity. Transient
   credential influence uses a non-reversible fingerprint, never plaintext JSON.
3. Reserve/lookup owner/run ID with short fenced preparation, initially 120s.
   Matching COMMITTED replay returns original job before reused CAPTCHA/current
   balance/provider/media validation, without charge or compensation. Changed
   intent conflicts; active preparation returns 202/read-only lookup advice.
   After the committed-replay fast path, fresh PREPARING reservation also locks
   the live canvas/node admission scope and checks other valid preparations or
   canonical PENDING/PROCESSING jobs before insert/takeover, excluding its own
   run ID. Two different run IDs cannot both prepare one node; final enqueue
   repeats this guarded admission check. Do not use the collapsed UI pending
   status or worker-host clock as the database admission authority.
4. Fresh run alone performs existing CAPTCHA/moderation/provider/safe-source
   checks. Protect READY imports with bounded preparation leases. Unknown-size
   canonical generated refs still face existing worker size validation.
5. Final short transaction locks live canvas/run/assets, verifies fence/current
   inputs/account admission, and atomically writes normal job, immutable job
   input roots, COMMITTED binding and conditional credit deduction. No S3 I/O.
   Enforce one preparing/pending run per node by live reservation/canonical job
   status under canvas admission locking, not a second status mirror.
6. Expired preparation takeover uses a new fence; stale requests cannot enqueue.
   Preparation failure creates no job/charge. Ambiguous commit/ACK is recovered
   by same run ID, never a new run or existing catch-path failure/refund.
7. Genuine manual rerun uses a fresh run ID after the current run settles;
   preserve older canonical results. Canvas never uses failed-chat replacement.

The job `sourceImageUrls` is the frozen durable worker input projection. Run/asset
ledger roots are separate cleanup protection; deleting organization cannot
rewrite inputs or refund/cancel. Existing Go job/handoff/retry/finalization is
unchanged. Credentials remain encrypted in their existing job path/request-only
runtime, never scene/local outbox.

## 10. Canonical Loading, Polling, And Result Suppression

- Root owner cache/source registry is mounted above renderers. Capture source
  before all async work; provisional New Chat has its own draft ID/epoch so late
  creation never selects/appends to an obsolete chat. Create failure still blocks
  chat generation. Canvas does not create a conversation.
- One deduplicated known-job poller uses per-entry identity/epoch, abort and
  single-flight guards. Before callback/reschedule verify subscription/owner/
  mount epoch; stale requests cannot restart stopped entries, including StrictMode.
  Preserve backoff/hidden-tab pause/foreground catch-up/terminal stop/attempt cap.
- Update canonical job cache first, then only live captured run bindings. Being
  selected is not required; being the current live source is. Deleted nodes/
  canvases lose attachment, but submitted jobs may finish into works.
- Complete canonical terminal batches materialize stable result nodes/provenance
  and mark outputsHandled in one scene/IndexedDB transaction. Failure closes the
  binding without clearing old results. Removed result cards never reset handled;
  removed generation bindings cannot rematerialize. Verify the existing complete
  terminal-batch contract in tests; partial streaming would require per-image
  suppression, not a silently reused boolean.
- Reopen reconciles only saved/local scene accepted bindings and explicit result
  IDs. Local outbox lookup is read-only: COMMITTED gives original job, PREPARING
  202, REJECTED safe error, unknown 404 or missing-live-job explicit unavailable.
  Unknown/lost ACK never proves original cannot arrive. Only explicit user
  transport retry resends its original run ID/intent with needed runtime inputs.
- Never enumerate all canvas runs to reconstruct a scene. Later unsaved runs
  belong to that local draft/works, not an older snapshot on another device.

## 11. Scoped Conversation Compatibility

Before replacing global latest-50 bootstrap, add owner/conversation loading:
query by user/conversation, use immutable `(createdAt,id)` keyset, serialize
canonical DTOs, and return page/nextCursor metadata. Start with selected recent
content and explicit older-page loading, not all conversations/all historical
jobs or one request per ID. Preserve the unchanged global no-query API.

Guard owner/conversation/selection/request epochs and abort obsolete loads.
Merge/deduplicate exact membership, preserve local accepted jobs and terminal
states, and show loading/error instead of global/orphan fallback. Server props
seed once after mount; refresh does not resurrect deleted/new content or load a
different workspace. Canvas activity cannot displace old chat restoration.

## 12. Local Drafts, Conflicts, And Expiry

Use native IndexedDB composite owner/canvas keys for versioned scene/edit
generation, last ACK cloud metadata and saved scene generation, writer/write
revision, Blob originals/upload mappings, and nonsecret uncertain-run outbox.
LocalStorage is only account-scoped mode/active-selection preferences. Read all
browser state after mount, never in render/SSR/lazy initializer.

Debounced monotonic transactional writes report local durability only on ACK;
page-hide flush is best effort. Same-canvas writers compare/write revisions in
IDB transactions, detecting conflict rather than last-writer-wins. Broadcast can
accelerate UI notification but is not correctness. Storage errors preserve
in-memory edits and warn; manual Save can use present originals even if local
durability failed. Do not claim recovery after eviction/browser clearing.

Create runtime previews from original blobs and clean consumer object URLs;
running/unmounting a renderer does not remove originals. Owner change invalidates
requests/cache/previews/selections and opens only its authenticated keys. This is
app isolation, not cryptographic protection from same-origin malicious code or
developer tools in a shared browser profile; no credentials/tokens are stored.

Older local drafts may mention cleaned rootless imports. Validate before Save/
Run and re-upload an available original or request a replacement while keeping
graph/text/layout/order. An expired ID never becomes a false saved/ready scene.

## 13. Reference Roots And Managed Cleanup

Protect saved-snapshot uses and all submitted-job uses, including completed/
failed retained jobs. A local node removal does not change cloud roots. Root
mutation locks assets: last root detach stamps time; valid reattachment clears
eligibility. Staged orphan readiness or ambiguous upload expiry starts conservative
seven-day grace. Preparation/upload protection is bounded, not permanent roots.
Use database-authoritative timestamps for grace, leases, takeover and claims;
client/worker clock skew cannot shorten retention or regain an expired fence.

State moves UPLOADING -> READY -> DELETING -> DELETED, with known-key quarantine
for rejected/ambiguous writes. Exactly registered import kind/owner/location/key
is eligible; never infer keys from URLs or scan a user/bucket prefix.

1. Acquire singleton sweep lease, initially 90s; indexed bounded asset claims use
   row locks/SKIP LOCKED, authoritative roots/leases/time recheck, and delete token.
   Mark DELETING before remote I/O; attachment then rejects it permanently.
2. Delete only recorded verified unversioned immutable objects outside DB
   transactions, with one remote delete in flight, 30s per-object cap and 45s
   pass cap. Unfinished rows remain fenced retry work; no connection held for S3.
3. Remote success/confirmed missing permits token-checked finalization. Denial/
   timeout/unknown capability retains inventory/accounting/deleting state and
   bounded exponential backoff. Never remove registry/root evidence or report
   reclaimed bytes on remote failure.
4. SQL fences do not undo already-sent PUTs. Keep ambiguous-upload/deleted-key
   tombstones and bounded exact-key reconciliation; a prior DELETE/HEAD-missing
   is not proof a late PUT cannot arrive. Never reuse keys/identities or release
   uncertain physical accounting prematurely.

Run one managed joined cancellable scheduler in Worker.Run after enabled schema/
storage/topology gates, alongside consumers under runtimeCtx. Immediate bounded
pass then 60s ticker, batch20 (range1-100, interval>=60), panic/unexpected-exit
reporting, drain/topology-loss stop-claim and bounded shutdown join. Not each
generation slot's one-second job sweep. Fixed seven-day retention has no
operator-shortenable env override. Bound/observe the existing small DB pool,
not blindly increase connections. No cancel/refund/generated/legacy cleanup.

## 14. Storage Capability, Flags, Migration, Rollback

- V1 imports require verified UNVERSIONED storage with immutable single-upload
  keys. Ordinary versioned DeleteObject creates markers, not physical byte
  reclamation. Perform bounded non-destructive GetBucketVersioning or an equally
  verified provider adapter capability after approval; enabled/suspended/denied/
  unknown/unsupported/mismatched location fails closed for import/reclamation.
- Refresh capability before claims/on bounded schedule. Unexpected PUT version
  receipts are recorded/quarantined, not v1 READY. Version-aware inventory/exact
  version deletion requires later explicit engineering before supporting it.
  No real bucket/versioning/delete permission was checked during planning.
- Actual environment source is `contracts/runtime/v1/environment.json`; correct
  release-hardening's stale filename during spec capture. Define shared
  CANVAS_ENABLED=false, worker GC interval60 minimum60 and batch20 range1-100 in
  that manifest before sole Node env.ts/Go config.go loaders/docs/deployment tests.
- Enabled Worker readiness composes generation and canvas schema guards,
  trusted storage location/capability and live managed GC; add versioned canvas
  capability so Node cannot report ready against an old/disabled Worker. Enabled
  Node checks canvas schema/capability even if generic worker checks are optional.
  Delete errors back off/are observable; dead scheduler/unknown schema/storage is
  not advertised as available. Feature-off legacy generation tests stay valid.
- Add only new migrations/tables/guards/indexes. Rollout: migrate -> new app/
  Worker with feature off -> disposable/schema/storage/topology checks -> explicit
  enable -> enabled acceptance/readiness. Feature hidden/off is not v1 success.
- Rollback disables new canvas writes/GC claims and uses existing worker safety
  preflight, retaining additive schema/key inventory/snapshots/roots/jobs/media.
  No automatic repair, destructive data rollback or real rollout is authorized.

## 15. Verification And Deferred Work

Child implement.md maps concrete tests/commands to CA1-CA13, including pure graph,
API/body/owner/lease/quota/idempotency, local storage, origin/poll/materialization,
scoped chat and phone/controller/browser behavior. Existing generation/credit/
handoff/cancel/refund regressions remain mandatory.

Use safe disposable complete/additive migration and fake-S3 integration with
seven-day clocks, concurrent Save/Run/GC fences, late PUT/delete, schema/readiness,
both topology/shutdown and account/admin retention. A new canvas DB wrapper has
its own longer bounded deadline/cleanup reserve; do not nest it under the existing
short worker-contract wrapper or ordinary unsentinelled Vitest. CI exclusions and
wrapper stages must include it explicitly. No real DB/.env/S3 fallback or image
pull; Windows cleanup verifies resolved runner-owned targets before native removal.

Deferred: full phone editor in the independent linked task, duplication,
collaboration, graph scheduling, video/photo/mask/scene-export features, versioned
import storage, verified generated-input byte metadata, and production capacity/
deployment validation. None changes the selected manual v1 creation/save behavior.
