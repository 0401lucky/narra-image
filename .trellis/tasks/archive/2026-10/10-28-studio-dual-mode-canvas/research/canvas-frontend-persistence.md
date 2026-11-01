# Research: Canvas frontend persistence, management, and verification contracts

- Query: Continue the approved frontend contract with versioned local drafts, explicit account snapshot management, reference-original capture, conflicts, phone read-only behavior, and verification boundaries.
- Scope: internal design research; continuation of the completed controller/graph/run report, not new product or source research.
- Date: 2026-10-28.
- Status: planning only. No product changes, installation, application tests, browser/load experiments, database access, or secret inspection.
- Companion: [canvas-frontend-contracts.md](canvas-frontend-contracts.md) owns sections 1-8 (mounted controllers, immutable sources, graph/direct Run, result suppression, root polling, and scoped chat loading). Section numbering is preserved across the split.

## Findings

### 9. Versioned Scene, Local Envelope, Runtime

```ts
type CanvasSceneV1 = {
  schemaVersion: 1;
  nodes: CanvasNodeV1[];
  edges: CanvasEdgeV1[];
  viewport: { x: number; y: number; zoom: number };
  runBindings: AcceptedCanvasRunBinding[];
};
```

Cloud references require registered asset IDs; an explicit local variant can carry local blob locators before registration. File bytes/base64/object URLs are not scene JSON. Version/schema/bounds validation occurs before rendering. Unknown versions do not silently become empty documents. Share pure schemas/types/constants/input resolver; no duplicated API field lists or client imports of server-only storage/database code.

IndexedDB envelope: composite owner/canvas key, storage version, local scene/edit revision, last acknowledged coarse cloud revision and particular saved scene edit revision, writer/write revision, display timestamps, File/Blob records/mappings, and nonsecret outbox. Read/write originals using structured clone after mount. Cloud revision advancement from Rename is not an acknowledgement of current graph edits.

Runtime only: canonical job/image/asset DTOs/current URLs, abort controllers/timers, focus/selection/measured geometry, object URLs, provider secrets/challenge, upload promises, source tombstones, result reservations. React Flow maps domain types/layout and applies permitted commands; renderer measurement changes are not document edits.

Create previews from loaded blobs after mount and revoke consumer URLs on cleanup. Do not revoke originals because a node ran or renderer unmounted. Existing chat reference hook remains scoped to chat; persistent canvas originals need their own asset/draft contract rather than its one-list/16-total model.

### 10. Unsaved UUID, New/Rename/Save/Delete

Generate one immutable canvas UUID immediately. Keep that ID through local drafting, shell registration, retries, selection and first Save; no temporary-to-server identity migration or duplicate document on retry.

- New creates an empty local draft and idempotently registers an owner shell: `scene=null`, revision 0, `hasSavedSnapshot=false`. Failure preserves local draft and shows retry. Explicit New/Save/Run retry may ensure a shell, but a known-deleted UUID cannot recreate. Another device sees an unsaved/empty shell, not a restored full canvas.
- Select remembers separate owner-scoped active canvas/conversation IDs; never copies another space's scene/draft. Owner/selection/load epochs guard delayed loads.
- Rename is explicit metadata PATCH with captured UUID and expected coarse revision. Acknowledgement updates title/revision, not graph-save status or local scene.
- Save freezes scene/edit revision and resolves every reference original, including disconnected/unsubmitted imports, then sends its mapped snapshot under CAS. Shell/asset/metadata intent calls are not background cloud scene autosave.
- Delete marks source as deleting and blocks new preparation/attachment, then issues owner-scoped revision DELETE. Do not discard an account-backed local draft/report success before acknowledgement. Failure retains/restores organization/error; success persistently tombstones UUID, removes selection/draft and rejects delayed create/save/upload/run attachments. A never-registered local-only draft can delete locally with the same guards. No cancellation/refund API call.

Save/Rename/Delete share a conservative coarse server revision. Serialize same-canvas management operations; do not bypass CAS by silently retrying an old frozen snapshot with a newer revision. A saved graph edit revision and shell metadata revision are separate facts.

### 11. Upload/Save Capture While Editing

Capture owner/UUID/cloud expected revision/save request ID/local edit revision/deletion epoch and immutable blob identities at Save click. Work on the frozen capture, not selected mutable nodes.

1. Reuse registered unchanged owner asset IDs. Share upload promise/stable upload ID/digest per local original across Save/Run to avoid duplicate originals.
2. Resolve **all** reference nodes in the capture, not only connected/running ones. Results reuse canonical IDs, not uploaded generated bytes.
3. Apply upload mappings to current local nodes only if captured blob identity still matches. If a file changed during upload, save may use the old captured original, but must not overwrite the new local reference.
4. Submit frozen resolved scene under revision CAS/request identity. Upload success is not account save success; acknowledgement means snapshot plus all originals are available.
5. ACK updates the captured canvas's base/ack metadata, not current selection. New local edits/deletions/runs remain and are visibly newer than the acknowledged scene.
6. Owner/deletion epoch invalidates attachment; never recreate organization for a successful upload/job. Backend grace/GC handles detached imports.
7. Failed upload/save retains scene/files and visible unsynced/error state. Saving does not submit a generation; a valid unsaved graph can Run under the separate shell contract.

UI states distinguish local transaction pending/committed, local failure, uploading, account save pending/acknowledged, newer local edits, conflict, missing original and unsaved shell. Use existing Chinese labels/ARIA; no account checkmark on click or after only upload.

### 12. Storage/Conflict/Expiry/Isolation

- Access IndexedDB/active IDs after mount only; SSR/client shell stays consistent. Lazy-renderer failure has retry/return-to-chat without draft loss.
- Debounced local writes commit monotonic edit revisions; an older delayed write cannot restore a deleted node. "Locally saved" requires transaction ACK. Page-hide flush is best effort, not browser-termination guarantee.
- Same owner/canvas concurrent writers use IndexedDB transactional read/version/compare/write; detect conflict instead of silent last-write-wins overwrite. Broadcast is optional acceleration, not correctness.
- Cloud CAS conflict preserves local draft. Offer explicitly warned reload of account version, not automatic merge/force overwrite or invented canvas duplication/Save As. Local draft based on an older changed cloud version also requires conflict handling; client timestamps do not decide product intent.
- Quota/blocked/unavailable/evicted storage preserves in-memory scene/error where possible. Manual account Save can still use in-memory originals. Evicted unsynced scene/outbox/files are not recoverable as account state.
- An old local-only draft may point to an unrooted import cleaned after accepted seven-day grace. Validate availability before Run/Save; re-upload local original or ask replacement, preserving text/layout/order. Never false-save/run a missing reference.
- Backend protects saved-canvas/job-rooted assets; frontend does not perform cloud GC or delete generated works/legacy objects.
- App account isolation uses authenticated composite keys and invalidates callbacks/runtime on owner change. IndexedDB is not a cryptographic vault against malicious same-origin code/developer tools in a shared browser profile; no secrets/tokens are stored there.

### 13. Phone Read-Only And Established UI

Desktop exposes core editor/management; phone exposes existing-canvas selection, view, pan and zoom while keeping conversation creation. Gate mutation commands as well as buttons: no phone node add/move/edit/delete, connections/reconnect/delete, paste/drop/upload, Run/Retry, or document-management/save mutation. This does not implement the deferred phone-editor task.

For React Flow disable dragging/connectability/reconnectability/delete shortcuts; keep selection/focus/pinch/pan. Filter changes to selection/runtime measurements only, hide editing handles/inspector/management controls. Constrain touch handling to the canvas viewport, not the whole page or other modes. Use a nonzero flex viewport within the current 100dvh frame and separate read-only camera/selection from document changes.

Keep cream/brown/orange variables and typography (`src/app/globals.css:8`, `src/app/globals.css:10`, `src/app/globals.css:49`, `src/app/globals.css:156`, `generator-studio.tsx:975`, `composer.tsx:193`). New parts use named exports, `cn`, Chinese UI/ARIA, semantic buttons/status/errors and existing lazy-loading, not default diagram branding.

Reuse thumbnail helper `src/lib/image-url.ts:34` and viewer/download `generator-studio.tsx:470`; no new thumbnail storage pipeline. Card dimensions remain separate from actual media dimensions. Fixed-size draggable cards meet the approved core without unrequested resizing/freehand/whole-scene export.

Challenge/provider dialogs require an explicit target (chat draft or canvas/node ID); current global chat setters must not mix options. Keep correctly reset runtime challenge integration independent of renderer lifecycle (current reset: `generator-studio.tsx:680`), reserve each token per request, never serialize/reuse it. Unsaved provider secrets remain runtime data.

## Affected Files

Candidate boundaries, not a mandate to create every module; main owns the final split.

| File/module | Responsibility |
| --- | --- |
| `src/app/create/page.tsx` | Explicit studio owner identity, optional initial canvas summaries, compatibility-safe chat initial data. |
| `src/components/create/generator-studio.tsx` | Mounted mode/controllers, source dispatch, shared cache/poller/viewer/challenge, no history feed. |
| `src/components/create/parts/session-sidebar.tsx` | Remove mobile image tab, preserve conversation navigation; separate canvas navigator IDs. |
| `src/components/create/parts/history-rail.tsx` | History-removal child owns presentation removal; do not recreate its global feed. |
| `src/components/create/parts/chat-pane.tsx` (new) | ChatStream/Composer and mount-aware DOM effects; business state above. |
| `src/components/create/parts/canvas-stage.tsx` (new) | Lazy controlled renderer and desktop/read-only projection. |
| `src/components/create/parts/canvas-sidebar.tsx`, `canvas-toolbar.tsx`, `canvas-node-inspector.tsx` (candidates) | Controlled management/status/selected-node inputs, no database calls. |
| `src/components/create/canvas/` (new) | Feature-local scene operations/resolver/adapters/local runtime types. |
| `src/components/create/hooks/use-canvas-documents.ts` (new) | UUID selection/drafts, manual management/save/conflict acknowledgements. |
| `src/components/create/hooks/use-canvas-draft.ts` (new) | Post-mount IndexedDB, revision/writer/eviction and nonsecret outbox. |
| `src/components/create/hooks/use-studio-jobs.ts` (new) | Source registry/cache, provisional/accepted run routing, materialization guards. |
| `src/components/create/hooks/use-conversation-generations.ts` (new) | Scoped paged chat content and stale selection/delete guards. |
| `src/components/create/hooks/use-image-poller.ts` | Guarded abortable/single-flight cleanup while retaining existing backoff behavior. |
| `src/components/create/types.ts`, `utils.ts`, `constants.ts` | Reuse option/media normalization; distinguish runtime references/canonical IDs and generation/studio modes. |
| `src/lib/canvas/contracts.ts` (candidate), `src/lib/validators.ts` | Shared pure DTO/schema/constants for local adapter/API; backend must share, not duplicate. |

Backend researcher owns routes, Prisma/job association, upload/media/GC details. Adding scoped chat content and canonical scene-reference/run-ID hydration is part of compatibility work, not an assumption existing endpoints already provide it. Canvas `canvasRun` changes must preserve no-canvas conversation/video callers.

## Behavioral Test Map

Read these existing tests; none were executed in this research:

- `src/tests/unit/generator-studio-session-history.test.tsx:110`: empty conversations never show orphan history; preserve and extend across mode changes.
- `src/tests/unit/generator-studio-session-history.test.tsx:142` and `src/tests/unit/generator-studio-session-history.test.tsx:180`: deleted/new chat stays empty after fresh props; extend to stale content pages and canvas loads.
- `src/tests/unit/generator-studio-session-history.test.tsx:216`: failed conversation creation does not submit; canvas must submit independently without creating chat.
- `src/tests/unit/use-image-poller.test.tsx:75`: hidden-tab foreground catch-up; add stale response after unsubscribe/unmount, single-flight foreground/timer race, and no owner-change callback/reschedule.
- `src/tests/unit/generator-studio-feedback.test.tsx:268`: composer inset measurement; test mode unmount/return reattachment.
- `src/tests/unit/generator-studio-feedback.test.tsx:294`: ordered references; add mixed imported/result IDs preserving exact ordinal order.
- `src/tests/unit/generator-studio-edit.test.tsx:99`: current edit action; keep chat semantics and test canvas selected result identity rather than rebinding to a new run.
- `src/tests/unit/generator-studio-retry-cancel.test.tsx:96`: chat replacement retry stays unchanged; canvas fresh rerun appends result nodes, preserves old references and never sends replacement ID.
- `src/tests/unit/generator-studio-retry-cancel.test.tsx:186`: cancellation remains explicit; deleting canvas/node during accepted pending job sends no cancel/refund request.
- `src/tests/unit/generator-studio-feedback.test.tsx:367`: history-only context-menu test belongs to removal child; preserve equivalent result reuse assertions outside removed presentation.

Add focused pure-controller/DTO/adapter tests with deferred fetches and injected storage fakes:

- Exactly one prompt, 0/1/16/17 refs, contiguous ordering, duplicate/wrong/unknown endpoints, missing images, and valid prior-result feedback without recursive execution.
- Manual Run only; editing/connecting never submits. Freeze A inputs, edit/switch/delete while awaiting upload/ACK, verify original payload/source ownership and no draft reset/resurrection.
- Multi-image terminal batch creates unique canonical result nodes once; delete a result/gen, deliver repeated terminal data, reopen local/cloud-saved scene, assert suppression. Fresh rerun preserves old output reference IDs.
- Persist provisional run ID before submit; lose ACK/reload, use read-only lookup without automatic POST. Explicit retry uses the same key/projection without duplicate job. Eviction falls back to works, not invented layout recovery.
- New UUID reused across shell/Save/Run retries; rename/save/delete coarse revisions, failed deletion retains draft, successful tombstone rejects stale shell/save callbacks.
- Save an unconnected unsubmitted original; restore from account without local File. Repeated save reuses asset; failed upload cannot claim account success. Replace/modify during upload/save and assert captured ACK never overwrites newer edits.
- IDB revision/write race, quota/version/eviction, multi-writer CAS, account switch and cloud conflict all preserve explicit error/local draft boundaries; missing expired import retains graph and blocks false save/run.
- Older conversations displaced by canvas jobs still restore via scoped pages; late page A cannot replace B/deleted chat, no global fallback.
- Phone controller mutations reject even direct command/keyboard/drop dispatch; selection/view/pan/zoom remain, conversation composer remains available, no hydration initialization from storage.

Future quality gate remains lint/typecheck/Vitest/build and cross-layer contracts; this report does not assert they pass. Browser/touch/performance and DB/GC concurrency checks belong to authorized implementation verification, not this static research.

## Related Specs And Companion Evidence

- `.trellis/spec/frontend/state-management.md:37`: feature container/shared state; `.trellis/spec/frontend/state-management.md:41`: server props are initial values; `.trellis/spec/frontend/state-management.md:74`: storage after mount; `.trellis/spec/frontend/state-management.md:78`: no global-history fallback.
- `.trellis/spec/frontend/component-guidelines.md:73` and `.trellis/spec/frontend/component-guidelines.md:80`: semantics/Chinese ARIA and component/controller boundaries.
- `.trellis/spec/frontend/hook-guidelines.md:36` and `.trellis/spec/frontend/hook-guidelines.md:54`: timer/listener/object-URL cleanup and existing polling.
- `.trellis/spec/frontend/type-safety.md:27`: shared Zod input validation; `.trellis/spec/frontend/directory-structure.md`: feature-local parts/hooks and server-only boundaries.
- `research/current-studio.md`: exact source/API/removal map. `research/canvas-library-comparison.md`: already verified React Flow APIs/licenses; no version/license re-research here.
- `research/canvas-reference-retention.md`: accepted seven-day grace/missing-draft caveat; backend contract report supplies canonical references, revision/idempotency/GC races.

## Static Planning Review (2026-10-28)

- Query/scope: Continue the parent/canvas-child artifact consistency review for local/cloud persistence, metadata management, stale acknowledgements, phone read-only behavior and verification coverage. No implementation, tests, browser or infrastructure access.
- P2 clarification: Failed account Delete must restore result reconciliation, not only visible organization. The child blocks attachment while Delete is pending and restores on failure (`.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:221`); terminal polling stops and callbacks attach only to live sources (section 10). A terminal poll or accepted-run ACK during that pause can therefore be retained only in canonical cache/outbox. On failed Delete, reconcile that same source against retained accepted/terminal data, materialize still-unhandled results once, and resume only needed read-only lookup/polling. Never resend generation, cancel/refund, reset outputsHandled or attach after successful tombstoning. Add the deferred DELETE-failure plus terminal-ACK/poll test to the command/materialization matrix.
- Alignment: Immutable shell UUIDs including uncertain creation/delete outcomes, accepted-only cloud Save content, all disconnected/unsubmitted original capture, upload-identity reuse, newer-edit-safe ACKs, separate metadata and saved-scene revisions, cloud/IDB CAS, storage failure/expiry/account isolation and phone controller-level mutation rejection are represented. Full phone editing remains independent/deferred. The companion report records the pending-result reservation restoration clarification.
- Evidence boundary: The current non-streaming worker transaction inserts the complete image batch before terminal completion/commit; the backend research source audit supports outputsHandled rather than a second per-image authority. Its regression test remains future implementation work. All quality/browser/storage/DB/GC commands in reviewed plans are future-only, not executed passes.
- Resolution (2026-10-28): CLOSED in planning. The updated child design restores live attachment after failed Delete and explicitly reconciles retained canonical terminal cache/accepted outbox/read-only run lookup against still-current bindings, even after terminal polling stopped, without new POST, suppression reset or removed-card recreation (`.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:231`). The deferred terminal ACK/poll plus failed-Delete regression is named in `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/implement.md:91`. Focused reread confirms this P2 clarification and the companion reservation clarification are resolved; no outstanding material frontend planning finding remains from this review. Tests were not run.

## Caveats / Not Found

- All contracts are proposed design research, not implementation or empirical validation. No app tests/browser/load/DB were run.
- Final shared field names/constants/route schemas must converge with backend and main design; do not independently implement these illustrative types.
- Complete terminal image batches are the key assumption behind `outputsHandled`; otherwise use per-image handling. Root source identity/guards remain necessary either way.
- Local unsaved edits and accepted jobs are not automatically account scene saves. An older acknowledged snapshot can retain unsaved-deleted nodes elsewhere; that is the selected manual-save boundary, not cross-device resurrection.
- IDs/job status do not reconstruct evicted unsaved scene/originals. Account recovery means last acknowledged snapshot and its protected originals only.
- No new product assumption about auto execution, DAG-only graphs, duplication, full phone editing, secret backup, or automatic destructive cleanup is introduced.
