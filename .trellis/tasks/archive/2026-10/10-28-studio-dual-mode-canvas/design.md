# Dual-mode studio integration design

## Authority And Phase Boundary

- `prd.md` owns R1-R17 and AC1-AC17. This document owns cross-child architecture,
  compatibility, and release boundaries; the canvas child owns detailed contracts
  in `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md`.
- All product decisions are resolved. Both v1 children have now implemented and
  verified this design within the boundaries of their archived evidence. The
  architecture below remains the contract, not a new implementation request.
- The user approved the final closeout summary on 2026-10-30, after its review.
  Execution activates only this parent's direct acceptance work and necessary
  narrow fixes, not either archived child or the
  independent mobile editor. The pre-execution evidence inventory and gaps are
  recorded in `research/final-integration-closeout-2026-10-30.md`; current
  execution and acceptance results belong to `verification.md` and `handoff.md`.

## Deliverable Boundaries

| Deliverable | Responsibility | Must Not Do |
| --- | --- | --- |
| History child | Remove desktop rail and phone image tab, reclaim layout, preserve shared chat actions/data. | Remove the latest-50 bootstrap before a replacement exists, edit media/schema, or touch video history. |
| Canvas child | Independent canvas controller/renderer, graph/run contracts, account/local persistence, asset roots/cleanup, scoped chat loading. | Duplicate generation business logic, automatically synchronize modes/scenes, delete works, or implement full phone editing. |
| Parent | Source requirements, sequential dependencies, research, final cross-child acceptance and narrow integration regressions/fixes. | Reimplement the canvas, expand features, or overlap a restarted child. |
| Mobile follow-up | Later phone editor over verified v1 contracts. | Block v1 or invent a separate mobile scene/generation format. |

Both v1 children touch `generator-studio.tsx` and sidebar wiring. Their required
history-before-canvas sequence is complete. Preserve both uncommitted patches;
do not restart that sequence. A task tree is not a scheduler: the mobile task
must still explicitly depend on the completed parent integration acceptance.

## Studio Architecture

```text
Authenticated /create server bootstrap
  -> serialized current owner + provider/CAPTCHA configuration
  -> conversation summaries / scoped initial conversation content
  -> one mounted studio shell and controller
       -> conversation controller: selection, composer draft, conversation jobs
       -> canvas controller: selection, local scenes, references, run bindings
       -> shared generation command adapter and guarded job registry/poller
       -> conversation renderer OR lazy client-only canvas renderer
       -> shared zoom/download/settings/error presentation where appropriate
```

The implemented client-only renderer uses React Flow `@xyflow/react@12.12.0`
MIT core; the archived canvas child records its approved build/interaction spike
and notice/peer verification. Do not repeat the spike without changed inputs,
or copy Pro examples or reference-app stores/provider calls. Its
internal state dependency is not a new application-wide state store.

Keep cream/orange tokens, existing card language, Chinese labels and accessible
controls. Put navigation/toolbars outside transformed content. Use explicit node
drag handles and isolate input/IME/scroll/buttons from pan/drag/key handlers.
Phone canvas controls permit select/view/pan/zoom, not scene/metadata mutation or
Run; existing phone conversation creation remains available.

## Ownership And Loading

- Pass an explicit studio-only authenticated `ownerId`; do not silently widen
  the shared video viewer type or use an unqualified global draft key.
- Separate mode, conversation ID, canvas ID, node ID, run ID, and job ID. Sharing
  providers/polling does not mean sharing workspace membership or prompt drafts.
- Server props initialize once. Read browser preferences/storage after mount;
  `router.refresh()` must not continuously replace local scenes/selections.
- The history-only child retained the latest-50 query until the canvas child
  added owner/conversation-scoped, bounded paginated generation loading with
  abort/selection-epoch guards and replaced the shared global bootstrap. That
  sequence is complete; final integration must preserve the scoped loader.
- Canvas loading resolves only canonical IDs present in its saved/local scene.
  Never reconstruct it from all canvas jobs, global history, or orphan records.
  Missing owned IDs become explicit unavailable states, not substitute content.

## Graph And Generation Data Flow

```text
prompt node --prompt input--> generation node --lineage--> stable result node
reference/result node --ordered image input--> generation node

explicit Run
  -> capture origin + immutable resolved prompt/options/reference IDs + run ID
  -> persist local provisional binding/outbox
  -> ensure live owner canvas metadata shell; upload only new required references
  -> existing POST /api/generate with opt-in canvas origin/input extension
  -> auth/CAPTCHA/moderation/provider validation + idempotent transactional enqueue
  -> canonical job + immutable imported-reference usage roots
  -> existing Go worker and owner-scoped job polling
  -> update canonical job registry and only still-live origin bindings
  -> materialize stable results once in local scene; account snapshot stays manual
```

Each target uses exactly one prompt, 0-16 visibly ordered ready reference
sources, prompt length 2-8000, text-only count 1-4, and image-to-image count 1.
Apply existing provider/input-size/safe-media validation rather than using JSON
to bypass multipart restrictions. A generation-to-result edge records provenance,
not executable scheduling. Stable result image IDs prevent reruns from changing
an already-connected downstream input. Invalid/missing inputs block Run.

The child design bounds new resource surfaces: 100 live canvases/account,
512 KiB/200-node/400-edge scenes, 8 MiB imports, 1 GiB/1000 accounted imports per
owner, and three active uploads. These are protective unmeasured defaults for
review, not a capacity or pricing claim. Known imported byte sums can be checked
before enqueue; the existing worker remains authoritative for the 32 MiB total
when generated source byte lengths are unknown.

Common commands capture origin before any asynchronous work, including the
provisional new-conversation epoch. ACK/poll/credit refresh uses that origin,
never whichever mode/project is now active. One root registry owns bounded
single-flight polling, request abort/epoch guards, hidden-tab pause, and terminal
cleanup above lazy/offscreen renderer boundaries.

Scene run bindings track whether canonical outputs have already been handled.
Materialize images and mark handled in one local scene/storage mutation. Removing
results never resets that flag; removing a generation/canvas revokes attachment.
Late completion can update retained jobs/works but cannot recreate organization.
Another device opening an older manually saved snapshot may still contain a
node removed only in an unsynced local draft; that is the selected save contract,
not implicit cross-device deletion synchronization.

## Saving And Reference Lifecycle

- Explicit New creates an owner metadata shell with stable client UUID, no saved
  scene, and honest `hasSavedSnapshot=false`. Failed/offline New preserves the
  local identity; explicit Save/Run may ensure the same shell, never recreate a
  tombstoned ID. Explicit Rename is metadata CAS, not a scene-save acknowledgement.
- Local autosave uses account/canvas-scoped IndexedDB for versioned scene data,
  local imported blobs, and pending run bindings. Object URLs are runtime-only
  and cleaned up; credentials/callbacks/library stores are not durable data.
- Manual Save captures a local edit generation and expected cloud revision,
  persists any new imported originals, then commits one validated snapshot plus
  its imported-asset usage roots. Acknowledge only that captured version; edits
  made in flight stay dirty. Failures/conflicts preserve the local draft.
- Owner-scoped optimistic concurrency protects Save/Rename/Delete. Deleted IDs
  are tombstoned; no stale autosave, response, or explicit retry may restore them.
- Reference files have an upload-once owner registry with immutable storage keys,
  validated bytes/type, bounded staging leases, and retry identity. Scenes store
  canonical asset/job/image IDs, not embedded bytes or temporary URLs. Runtime
  preview URLs are resolved from the canonical records.
- Saved-snapshot roots and submitted-job input roots protect imported originals,
  including after successful jobs or canvas deletion. The existing job
  `sourceImageUrls` remains its durable worker request snapshot; explicit asset
  usage is the transactional cleanup fence, not URL-prefix inference.
- Only new registered imports without roots become eligible seven days after
  detach/successful orphan upload. Save/enqueue locks and deleting-state fencing
  prevent attach-versus-GC races. Generated/legacy media never enter this registry
  cleanup. Old unsynced drafts recover missing references by re-upload.

## Operational And Migration Boundaries

- Use additive canvas document/asset/run/usage tables and indexes; do not rewrite
  historical generation contracts, conversation retention, or media rows.
- Stage with shared `CANVAS_ENABLED` off; enable explicitly only after canvas
  migration/capability/readiness and acceptance gates. Enabled Node and Worker
  must agree on schema/capability; a generic healthy old Worker is insufficient.
- Actual runtime manifest: `contracts/runtime/v1/environment.json`. The original
  research found a stale `runtime-environment-contract.json` spec reference;
  the canvas child's spec update corrected it. New variables still belong only
  in Node `env.ts` and Go `config.go` loaders.
- Run one managed, joined, cancellable bounded imported-asset GC loop in
  `Worker.Run` after schema/topology readiness, not in each generation slot.
  Initial interval 60 seconds and batch 20, with interval minimum 60 and batch
  maximum 100; seven-day grace is fixed, not operator-shortenable.
- V1 imported-object reclamation requires a verified unversioned immutable-key
  object-storage contract; unknown/versioned storage needs explicit safe
  capability handling or version-aware inventory before claiming physical
  reclamation. No production storage/versioning configuration was inspected.
- Production imports explicitly require configured S3-compatible storage and
  forbid base64 database fallback. Use simulated object storage and disposable
  localhost DBs for implementation validation, never real production deletion.

## Compatibility, Rollback, And Review

- No canvas/node DELETE calls works DELETE, job cancel, or refund. Existing
  lifecycle/handoff/refund rules remain the only generation authority.
- History-only rollback is a reviewed presentation patch. Canvas rollback first
  disables canvas/GC and follows worker rollback preflight, retaining additive
  schema, jobs/media, saved scenes, and roots. Never use a workspace reset or
  destructive schema rollback.
- Canvas browser/React 19, storage failures, ID round trips, ACK loss, stale
  polls, cross-account access, old conversation loading, deleted-node completion,
  save/GC races, and both device layouts are required implementation checks.
- The archived child plans and final receipts distinguish their actual checks
  from earlier research-only/preflight checkpoints. This continuation's planning
  reads and hash comparisons are not another runtime verification or deployment.

## Final Integration Evidence Boundary

- Reuse source-matching child checks per gate, with explicit provenance in the
  parent's final AC1-AC17 matrix. A handful of hashes cannot attest an entire
  build; use the retained source baseline, final deltas and dependency/config
  identities as well as the named browser/runtime manifests.
- A required direct regression covers scoped conversation loading and
  deletion-to-works retrieval against real isolated PostgreSQL. Existing mocked
  loader/controller tests and canvas job-retention SQL do not themselves execute
  the conversation DELETE plus `listUserWorksPage` path.
- Prefer the existing sentinelled canvas DB harness for that narrow regression;
  exercise production loaders/retention queries with real SQL, not a second
  handcrafted in-memory interpretation. No new generation provider or production
  API is needed. Any product defect discovered is fixed minimally and reviewed
  independently under the same contracts.
- Actual signed-session HTTP SSR/API/runtime checks and the separate real
  Next/React Flow/native IndexedDB fixture browser checks remain distinct. Their
  combination does not establish browser login-to-paid-provider E2E.
- Physical phones, OS-native IME, real services, deployment and measured capacity
  remain unverified. They are explicit release/manual residuals, not waived
  failing local automated gates or authorization to enable production canvas.
