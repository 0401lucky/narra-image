# Research: Incremental canvas persistence costs

- Query: Does account-backed canvas autosave create excessive server resource/cost burden, and which scoped persistence contract fits a cost-sensitive first version?
- Scope: existing media/job storage, browser/server work split, save frequency, persistence tradeoffs and proposed controls
- Date: 2026-10-28
- Method: static source/spec/example inspection only; no secrets, deployed configuration, hardware, DB, tests or benchmarks inspected
- Confirmed product context: canvas and conversation are independent; links resolve real inputs; each generation node runs manually; no whole-graph or edit-triggered generation.
- Decision update after the cost discussion: the user accepted local draft autosave plus explicit manual account saving. Other devices restore the last successfully saved account snapshot, not newer local edits. The comparison below remains research, not an implemented guarantee; background cloud autosave is not selected.
- Reference-save update: explicit account snapshots also include unsubmitted imported reference originals, reusing unchanged persisted files on later saves. The user accepted the added reference-file storage. Cleanup/retention after reference or canvas removal remains unresolved.

## Findings

### 1. Resource burden is not one quantity

A canvas is rendered and manipulated in the browser. Account persistence adds
scene API/DB operations and potentially imported-file uploads; it does not make
the server render every pan, zoom or connection. Existing manual generation
still adds its usual provider/worker, job and media costs under ALL contracts.
Scene save must never call generation; that separation also matches the user's
manual-per-node decision and existing enqueue path (`src/app/api/generate/route.ts:175`).

The key incremental quantities are active editors x save frequency x metadata
size; total retained documents/assets; and image reads/transformations/egress.
An idle account or saved canvas does not continuously consume save requests.
No repository fact establishes current-server spare capacity or cloud pricing.

### 2. Existing storage and what cloud restoring files adds

- `GenerationJob` already owns request/status/owner truth, and `GenerationImage`
  owns image ID, job ID, URL, dimensions and storage metadata
  (`prisma/schema.prisma:404`, `prisma/schema.prisma:511`). Canvas scene metadata
  can reference those IDs; it need not copy image bytes or job status snapshots.
- Go result persistence uploads bytes to configured S3-compatible storage and
  records URL/storage kind/key; it explicitly rejects production data-URL
  fallback (`worker/internal/worker/storage.go:108`,
  `worker/internal/worker/storage.go:127`, `worker/internal/worker/worker.go:985`).
  Production object storage is the required contract, not proof it is deployed
  here (`.trellis/spec/operations/media-storage.md:11`).
- Legacy media can be data URLs or external URLs and remains readable
  (`.trellis/spec/operations/media-storage.md:35`). "Local image fallback" in
  this code means base64 in a data URL, not an app image-directory write
  (`src/lib/storage/persist-generated-image.ts:153`). Such bytes can increase
  job/DB/response size; a scene must not duplicate even legacy media URL payloads.
- Unsubmitted reference files currently live in React state as `File` objects
  plus browser ObjectURL previews, released on cleanup. They do not survive a
  reload through any existing scene persistence
  (`src/components/create/hooks/use-reference-images.ts:25`,
  `src/components/create/hooks/use-reference-images.ts:37`,
  `src/components/create/hooks/use-reference-images.ts:58`).
- On manual generation, the API buffers new uploaded files and persists them,
  then stores uploaded/existing reference URLs on the job. Existing URL inputs
  avoid this file-upload branch (`src/app/api/generate/route.ts:153`,
  `src/app/api/generate/route.ts:170`, `src/app/api/generate/route.ts:211`).
- Restoring NOT-YET-SUBMITTED file nodes on another device adds new asset
  upload/identity/retention work BEFORE generation. No canvas upload/scene API
  or canvas quota exists. Current storage helpers generate a fresh object key
  per upload, not content deduplication (`src/lib/storage/persist-generated-image.ts:132`).
  Upload-once asset identities and reuse are proposals, not current behavior.
- Guard caveat: the Node reference helper's fallback checks its flag but has
  no visible equivalent production guard (`src/lib/storage/persist-generated-image.ts:153`).
  A future canvas uploader must explicitly meet the production no-base64
  contract; do not assume calling the existing helper alone settles that.

### 3. Browser versus server work

| Work | Resource owner / implication |
| --- | --- |
| Pan/zoom, node dragging, connecting, selection, local undo | Browser CPU/GPU/memory; no API needed per pointer event. |
| Scene serialization and local buffering | Browser CPU/IndexedDB/disk; full-document serialization can also hurt the client if done on every event. |
| Account load/save | Network, API auth/validation, PostgreSQL reads/writes, transaction/WAL/backup and any replica work. |
| First cloud upload of a local reference | Browser read + upload bandwidth + API buffering if proxied + object-store writes/retention; later reuse should send identity only. |
| Generated images | Existing manual generation/provider/worker and media storage; scene persistence adds only references/association metadata if designed that way. |
| Image viewing/download | Browser decoding/memory plus storage/CDN egress; some requests use the Next optimizer or app proxy, so not everything bypasses the app. |

Existing thumbnails target `/_next/image`, with data/blob/bypass cases; formats
and sizes are configured (`src/lib/image-url.ts:35`, `next.config.ts:7`). First
optimization/cache misses can consume app resources. Downloads can buffer up
to the route's existing limit (`src/app/api/proxy-image/route.ts:13`).
Canvas thumbnail reuse/culling is proposed; current canvas implementation is absent.

### 4. Save frequency and write amplification

Sending a complete JSON document on every drag sample multiplies auth, parsing,
network and DB updates without creating user value. A small coordinate change
can resend the whole document, and repeated row/document rewrites add WAL and
backup/replica pressure; wire bytes are not a measurement of physical DB I/O.
Many editors amplify this through concurrent API requests/DB connections; many
saved but inactive canvases instead mainly increase retained storage/backup size.

Proposed control: write local changes, save cloud only after meaningful edits
settle or a drag ends, combine changes, bound periodic/max-wait flushes, and
allow one cloud write in flight per scene. Pure debounce waits until idle; a
max-wait/rate policy is needed if continuous editing must eventually sync.
Save retries need backoff rather than a reconnect request storm. Full-document
snapshots are simpler initially, but must be bounded; patches do not magically
remove server-side JSON rewrite work or conflict handling.

Do not mark scene metadata dirty on every job poll, credit update or server
props refresh. Existing terminal polling updates UI and refreshes the route
(`src/components/create/generator-studio.tsx:255`); keep canonical job status in
jobs. Persist a newly associated job/media ID when necessary, not every status tick.

### 5. Three persistence contracts (comparison, not implementation)

| Contract | Incremental server work | User guarantees and limitations |
| --- | --- | --- |
| Local-only IndexedDB | No cloud scene reads/writes or pre-generation reference uploads; generation backend costs still exist. | Local drafts/files can survive ordinary reloads if stored successfully; no account cross-device recovery. Browser clearing, eviction, private mode, quota failure or another browser/device can lose the scene. Generated media can remain on the server without reconstructing its layout. |
| Account autosave + local buffer | Bounded background metadata saves plus upload-once new references, cloud loads and retained assets. | Account recovery/cross-device access after server acknowledgement; offline edits remain local/unsynced. Needs visible sync errors, revision conflict policy and local-buffer recovery. Last pointer event before crash is not guaranteed cloud-saved. |
| Local autosave + explicit manual account save | Local draft updates; cloud writes/new-asset uploads only for explicit saved snapshots, plus cloud loads. | Browser draft recovery; other devices see the last manually saved snapshot, not unsaved edits. Show local-vs-account saved states and warn about stale cloud snapshots. Discarded drafts can avoid early cloud uploads. |

All three need local storage keyed by user and canvas, quota/error handling,
and multi-tab ownership/revision behavior; "local" does not mean no conflicts.
Cloud autosave does not provide realtime collaboration by itself. A revision
check must prevent silent stale-tab overwrites (or expose an intentional policy).

Manual cloud save reduces write frequency, not necessarily final retained
image bytes: if the same references are ultimately saved, their originals still
need cloud storage. Re-uploading them per save would accumulate extra copies;
upload-once IDs and cleanup policy matter more than the button alone.

### 6. Compatible resource-control recommendations

- Store scene metadata only: node/link/config/geometry and canonical job/media
  or imported-asset IDs. No base64, raw files, duplicated job snapshots or secrets.
- Keep canvas ownership independent from conversation ownership. Load only the
  selected owner's canvas; list metadata, not every scene and image at once.
  Existing job reads show owner-scoped lookup (`src/app/api/me/generations/[id]/route.ts:25`).
- Upload only NEW assets; reuse existing media/ref IDs or persisted URLs. New
  cloud reference assets need their own owner/size/type/lifecycle checks and
  reference-aware cleanup. Do not delete shared generated media with a scene.
- Bound scene bytes, node/link counts, prompt/reference sizes and upload bytes;
  add per-user canvas/asset storage quotas and save rate/concurrency limits.
  Current 16-reference generation limit is NOT a scene/account storage quota
  (`src/lib/generation/parse-generate-request.ts:59`).
- Avoid infinite server snapshot history unless requested; keep local undo
  separate from cloud version retention. Account save needs ack/revision/sync
  state, not a promise that every edit is durable immediately.
- Reuse thumbnail URLs and load visible/near-visible canvas images rather than
  decoding every original; this reduces client memory and network, but actual
  optimizer/cache/CDN costs require observation. These controls are not implemented.

### 7. Illustrative calculation -- NOT measured capacity or a typical scene

Assume purely for comparison: 20 concurrent continuously dragging editors,
60 pointer samples/second/editor, and a 25 KiB metadata-only full JSON payload.
Ignoring headers, responses, compression, retries and DB/WAL amplification:

- Every sample: `20 x 60 = 1,200 requests/s`; `1,200 x 25 KiB = 29.30 MiB/s` incoming payload.
- Hypothetical periodic cap of one save per 2 seconds/editor: `20 / 2 = 10 requests/s`; `10 x 25 KiB = 0.244 MiB/s`.
- This is a 120x steady-state reduction under those artificial assumptions.
  Drag-end flushes add boundary bursts; pure debounce can produce fewer writes.

The useful relationship is `requests/s = active editors x save frequency` and
`payload bytes/s = requests/s x document bytes`. Retained assets, image reads,
generation calls, DB/replica I/O and account storage are NOT included in this example.

## Conditional Recommendation And Caveats

For a cost-sensitive v1, the report recommended local autosave + explicit account
save IF the user accepts that another device only restores the last saved
snapshot; it avoids frequent cloud draft writes and uploading discarded drafts
prematurely. The user subsequently accepted that proposal. Newer edits remain
local until a successful explicit account save; browser clearing/eviction can
remove unsynced drafts, and save failures must not be labelled cloud-saved.
If seamless account recovery is essential, metadata-only account autosave with
local buffering, bounded writes and upload-once assets is still a viable design
to evaluate, not inherently excessive, but is not the selected first-version
contract. Local-only fits only if device-bound recovery/eviction limitations are
acceptable and is likewise not selected.

Related specs: `.trellis/spec/operations/media-storage.md` and `.trellis/spec/frontend/state-management.md`.
Deployment examples advertise S3-compatible configuration (`.env.example:44`), not configured hardware/storage.
There are no measurements, actual scene sizes, user counts, spare-capacity or
price data here. Scene APIs, IndexedDB, quotas, upload-once IDs and conflict
controls described above are future design proposals, not existing guarantees.
