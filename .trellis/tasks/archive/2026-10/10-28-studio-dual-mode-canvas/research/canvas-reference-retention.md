# Research: Canvas reference retention boundaries

- Query: How can detached imported-reference cleanup avoid deleting saved inputs,
  generated works, or files still needed by generation and local drafts?
- Date: 2026-10-28
- Method: scoped static source/spec inspection; no DB, deployment, secrets,
  object-store operations, application tests, or performance measurements.
- Product context: independent node canvases, manual generation, local draft
  autosave/manual account snapshots with unsubmitted reference originals, and
  organization deletion without generated-media deletion or job cancellation
  are selected. The user also accepted the seven-day cleanup grace and local-draft
  re-upload trade-off on 2026-10-28. Implementation is not authorized yet.

## Repository Evidence

1. Generation inputs have a durable URL snapshot. New generation files are
   uploaded before transactional job creation; their URLs and existing URL inputs
   become `GenerationJob.sourceImageUrls`
   (`src/app/api/generate/route.ts:153`,
   `src/app/api/generate/route.ts:170`,
   `src/app/api/generate/route.ts:177`,
   `src/app/api/generate/route.ts:211`, `prisma/schema.prisma:439`). Deleting
   canvas organization must not break a retained job's source inputs.
2. Generated results have a separate canonical model and optional object key
   (`prisma/schema.prisma:511`, `prisma/schema.prisma:518`). Conversation deletion
   uses `SetNull` for jobs (`prisma/schema.prisma:453`); canvas deletion must honor
   the user-selected analogous retention boundary, not cascade to generated works.
3. The existing Node image helper returns a URL, creates a fresh
   `userId/randomUUID.extension` object key per upload, and does not return a
   registered reference-asset identity or retention metadata
   (`src/lib/storage/persist-generated-image.ts:118`,
   `src/lib/storage/persist-generated-image.ts:132`,
   `src/lib/storage/persist-generated-image.ts:138`). A user's URL prefix alone
   cannot distinguish disposable imports from generated results or legacy media.
4. The explicit works-delete route deletes the `GenerationImage` DB record. It
   does not call object-store deletion in that route
   (`src/app/api/me/works/[id]/route.ts:6`,
   `src/app/api/me/works/[id]/route.ts:19`). This is not an existing imported-asset
   cleanup service or proof that deleting a work frees physical storage.
5. No dedicated canvas/reference-asset object-cleanup implementation was found
   in the scoped search of `src/lib/storage`, `src/app/api`, `worker/internal`,
   and `prisma` for canvas/reference-asset identities or object-delete commands.
   The earlier architecture report also finds no scene/asset registry/API.
6. Production media must use configured S3-compatible persistence, not base64
   fallback (`.trellis/spec/operations/media-storage.md:11`). The Node helper's
   fallback branch visibly checks its flag without an equivalent production
   guard (`src/lib/storage/persist-generated-image.ts:153`); a new reference
   uploader must explicitly meet the production contract. No actual deployment
   configuration/capacity is established here.

## Selected Retention Contract

- Keep an imported original while any account-saved canvas references it, even
  if it has never been used for generation. Complete account recovery depends
  on that file remaining available.
- Keep imported files used by retained submitted generation jobs, including
  completed jobs, rather than protecting only currently running jobs. Their
  immutable input snapshots and reuse operations remain relevant after a
  canvas/node is removed.
- Apply a seven-day grace from becoming detached before cleaning only newly
  registered imported-reference assets with no saved-canvas/job roots. Staged
  uploads from failed/abandoned saves also need a bounded grace/lease policy.
  Seven days is the user's selected product policy, not an existing implemented
  constant or a capacity measurement.
- A local node edit/removal is not itself a cloud detach: the last manually saved
  account snapshot remains a retention root until explicitly replaced/deleted.
- Generated works and unregistered legacy URLs/keys are never candidates for
  this new imported-reference cleanup. Do not scan/delete a user's whole bucket
  prefix or infer deletable objects from URLs.

## Local Draft Recovery Trade-Off

The server cannot know every reference mentioned in a browser-only unsynced
draft. Another device can remove the last saved reference, or an abandoned upload
can outlive its grace period, while such a draft still exists locally.

- If the original blob is still in the local draft, a later explicit save/run
  can re-upload it under the validated upload/identity contract.
- If only an expired cloud asset ID remains locally, recovery needs an actionable
  missing-reference state and a replacement upload. Preserve node/graph/prompt
  metadata; do not silently drop the node or claim a fully restored/saved canvas.
- Local buffer eviction or browser clearing remains a separate previously
  disclosed risk. The grace proposal does not promise indefinite cloud retention
  of every local-only draft.

The user accepted this storage-recovery trade-off and seven-day grace on
2026-10-28. Recovery mechanisms and cleanup scheduling still need technical
design; no implementation or production object deletion is authorized now.

## Engineering Safeguards Carried Into Design

These are proposals now specified in the canvas-child `design.md` and the
backend contract report, not implemented infrastructure or verified production
capabilities. Final planning review/implementation approval remains pending:

1. Register new imports with owner, asset kind, internal object key/location,
   type/bytes, lifecycle state, and upload identity. Reuse the same persisted
   identity on later saves; do not treat generated media as imported assets.
2. Track saved-document and submitted-job usage explicitly. Register job usage
   inside the generation enqueue transaction before a file becomes eligible for
   cleanup; `sourceImageUrls` remains the worker input snapshot, not the only
   race-prone retention index. Save and generation should share upload identities
   so using a reference before saving does not require another unchanged upload.
3. Protect in-progress upload/save work with bounded leases. Mark detach time
   only after authoritative usage is removed; reset eligibility on a valid new
   attachment. Define retry/idempotency and quota accounting for staged uploads.
4. Claim cleanup candidates transactionally with an authoritative no-roots check
   and a deleting state. Reject attachment to deleting/deleted assets; never do
   a naive read-no-references followed by an unguarded remote delete that races
   with save or enqueue. Object I/O, final tombstones, and retry failures need an
   explicit state machine.
5. Use bounded batches, audit/dry-run output, owner/key validation, idempotent
   object deletion and backoff. Research and specify an actual scheduling entry
   point before promising periodic cleanup; none exists for these assets today.
6. Validate missing/replaced references before save/run, preserve unsynced drafts
   on errors, and keep cleanup entirely separate from generation cancellation,
   charging/refunds and explicit generated-work deletion.

## Validation Needed After Approval

- Fake-clock cases for seven-day eligibility, staged uploads, detach/reattach,
  saved-canvas roots, and pending/completed job-input roots.
- Concurrent save/enqueue versus cleanup claims; no attached object can be
  deleted after a stale no-roots read.
- Shared-reference ownership, unauthorized asset IDs, generated/legacy media
  exclusion, upload/remote-delete failures and idempotent retry handling.
- Missing expired reference in a local draft: visible recovery/re-upload, intact
  graph metadata, no false account-save success or unexpected generation.
- Disposable database/object-store verification and bounded scheduling tests,
  not real production object deletion. No validation in this list has run yet.
