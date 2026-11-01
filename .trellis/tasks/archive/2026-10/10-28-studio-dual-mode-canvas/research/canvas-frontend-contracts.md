# Research: Canvas frontend integration and runtime contracts

- Query: Define compatible frontend/controller, graph-input, local-draft, manual-save, and job-reconciliation contracts for approved PRD R6-R17.
- Scope: internal design research; reuses the completed library/source reports and coordinates with the backend researcher.
- Date: 2026-10-28.
- Status: planning only. No product changes, installation, application tests, browser/load experiments, database access, or secret inspection.

- Companion: [canvas-frontend-persistence.md](canvas-frontend-persistence.md) continues sections 9-13 and the affected-file, verification, spec, and caveat maps. Section numbering is preserved across the split.

## Findings

### 1. Smallest Mounted Boundary

Keep `GeneratorStudio` mounted as the authenticated workspace shell. Keep independent chat/canvas controllers and job/asset state mounted; switch only renderers. Do not mount two complete studios or put polling/durable drafts inside lazily mounted React Flow nodes.

```text
CreatePage: authenticated owner, initial data, catalogs
  GeneratorStudio: mounted feature shell, no application-global store
    chat sessions + existing chat composer draft
    canvas documents/drafts keyed by ownerId + canvasId
    shared submission transport + canonical job cache + source registry
      one guarded useImagePoller for known pending jobs
    shared image viewer/download + challenge/provider runtime
    conversation -> ChatPane -> existing ChatStream + Composer
    canvas       -> lazy CanvasStage -> controlled React Flow
```

A mode toggle must not create a canvas, clear a chat draft, invoke New Conversation, copy prompts/results, or populate content from history. New node defaults come from supported account/catalog defaults, not an unrelated chat draft. URL `initialPrompt` seeds chat only.

Extract view-dependent chat DOM effects into `ChatPane` or a pane-local UI hook: current composer measurement runs once (`generator-studio.tsx:228`), textarea measurement depends only on prompt (`generator-studio.tsx:218`), and chat scrolling runs at `generator-studio.tsx:208`. Blindly unmounting their DOM beneath unchanged root effects loses observer/ref attachment on return. Business drafts remain mounted; measurement/scroll/focus follows the mounted pane.

Keep React Flow a rendering adapter, not the job/credits/provider database. Its internal state does not require an app-wide Zustand store. Existing cream/orange styling and named-export/dynamic patterns remain authoritative.

### 2. Source Evidence And Existing Risks

Paths abbreviated here are under `src/components/create/`.

| Evidence | Design implication |
| --- | --- |
| `generator-studio.tsx:177` | Guarded initial conversation hydration must survive fresh server props. |
| `generator-studio.tsx:166`, `generator-studio.tsx:199` | Existing job cache is not scene state or global-content fallback. |
| `generator-studio.tsx:255`, `generator-studio.tsx:263` | Current polling routes to the active chat array and observes only it. |
| `generator-studio.tsx:501`, `generator-studio.tsx:594`, `generator-studio.tsx:704` | Snapshot lacks origin IDs; async acceptance can append into the new current list. This is a static race risk, not a reproduced failure. |
| `generator-studio.tsx:604`, `generator-studio.tsx:718` | Delayed conversation creation must not select an obsolete draft; responses must not fall back to the currently selected conversation. |
| `generator-studio.tsx:702` | Chat revokes submitted preview URLs; persistent canvas references cannot inherit that lifecycle. |
| `generator-studio.tsx:875`, `generator-studio.tsx:890` | Chat retry forces text-to-image/replacement. Canvas retry must preserve connected inputs and old successful results. |
| `hooks/use-image-poller.ts:48`, `hooks/use-image-poller.ts:80`, `hooks/use-image-poller.ts:145` | No per-request epoch/abort/single-flight guard; a late read can reschedule a removed entry. |
| `hooks/use-reference-images.ts:25`, `hooks/use-reference-images.ts:50` | Its single-array, 16-total limit is for the chat composer, not the whole multi-target canvas. |
| `types.ts:11`, `src/components/video/video-studio.tsx:9` | `ViewerUser` lacks an ID and is shared with video. Add a studio-only owner prop/type rather than broad unrelated type churn. |
| `src/app/create/page.tsx:66`, `src/app/create/page.tsx:84` | Serialized user already has an authenticated ID at runtime; type/supply it explicitly for storage keys. |
| `src/app/create/page.tsx:36` | Global latest-50 jobs cannot provide complete chat content once canvas jobs occupy that pool. |
| `src/app/api/me/generations/route.ts:7`, `src/app/api/me/generations/route.ts:26` | Current global GET has no scoped query parser and returns 24 jobs. |
| `src/app/api/me/conversations/[id]/route.ts:9` | Detail route has PATCH/DELETE, not a full-content GET. |
| `src/lib/generation/parse-generate-request.ts:146` | Current JSON parsing returns an empty reference URL list; merely adding canvas fields would silently lose references. |

### 3. Immutable Ownership And Independent Drafts

Use a discriminated source, plus a root authenticated-owner epoch:

```ts
type StudioSource =
  | { kind: "conversation"; ownerId: string; conversationId: string; draftEpoch: number }
  | { kind: "new-conversation"; ownerId: string; draftId: string; draftEpoch: number }
  | { kind: "canvas"; ownerId: string; canvasId: string; nodeId: string; runId: string };
```

- View selection is never the destination of an async response. Update the canonical owner cache, then the captured live source; derive visible content from its explicit membership.
- New chat requires a provisional draft ID/epoch. Its delayed creation must not select it after New/Switch/Delete; creation failure still prevents generation, preserving the existing regression contract.
- Mode changes preserve the chat draft. Existing conversation-switch clearing behavior need not become a new per-conversation draft product feature.
- Each canvas/node owns its prompt/reference graph and generation parameters. Canvas submit never calls `createSession` or sends `conversationId`/`replaceGenerationId`.
- One preparing/submitting/pending run per generation node is sufficient. Other nodes run manually under existing account limits/challenge availability. A second click while acceptance is unresolved is not a new run.
- Freeze resolved input at Run click. Edits during upload/submission affect the next run, never mutate the frozen request or get overwritten by its callback.
- New manual rerun/retry gets a new run ID. Explicit transport retry after ambiguous acceptance reuses its original ID and frozen payload; timeout is not proof a billable job failed. Reload itself never submits a POST.
- Before submission, a deleted source must not start a POST after slow preparation. Once a POST may have been accepted, deletion detaches organization, not the job; acknowledgement recovery leaves results in works without reattaching nodes.
- Owner change invalidates old requests/cache/previews/selection and opens only the new owner's storage keys. Credit/catalog refresh with the same owner does not reset drafts. No email/nickname/credits-based or unqualified global draft keys.

### 4. Minimal Four-Kind Graph V1

| Node kind | Durable content | Runtime only |
| --- | --- | --- |
| `prompt` | Stable ID/layout and editable text | Focus/selection/validation; no execution on edit. |
| `reference` | One original; local blob locator before registration, owner asset ID for a cloud snapshot | File/Blob, preview URL, upload/missing/evicted state, current display URL. |
| `generation` | Nonsecret parameters and input edges; accepted run/job binding | Submit phase, canonical job, provider secret/challenge, result-slot reservation. |
| `result` | Stable `jobId`/`imageId` (and optional `runId`) plus layout | Canonical URL, actual dimensions, readiness. |

One reference node represents one original; batch import creates multiple nodes. One result node represents one canonical image; multi-image output creates explicit separate results. A canvas can contain more than 16 references, but each target has at most 16 image inputs.

```ts
type CanvasEdgeV1 =
  | { id: string; kind: "prompt-input"; source: string; target: string }
  | { id: string; kind: "image-input"; source: string; target: string; ordinal: number }
  | { id: string; kind: "output-provenance"; source: string; target: string };
```

- Prompt -> generation: exactly one to run. Reject a second prompt, do not concatenate or pick arbitrarily.
- Reference or ready canonical result -> generation: contiguous ordinals `1..N`, `N <= 16`. This edge ordinal is the single ordering authority. Reordering updates ordinals; removal compacts them. Node position/object iteration is not input order.
- Generation -> produced result: non-executable output provenance. Create from canonical output; never follow it in input resolution or let a user manufacture arbitrary output lineage.
- Reject unknown/wrong-kind endpoints/ports, literal same-node links, duplicate edges/ordinals, and repeated canonical image identity within one target. An image may feed several different targets.
- No general DAG/cycle ban: a prior immutable result may feed its originating generation for manual iteration. That visual provenance cycle cannot auto-run because resolution reads only direct ready identities, never recursively schedules nodes.
- Generation itself is not an image input; connect the specific completed image. Missing/pending upstream output asks the user to run upstream first. Edits/connections never schedule it automatically.
- Deleting an input removes incident edges and invalidates affected projections, without substituting unrelated content, deleting canonical media, or regenerating downstream.

### 5. Direct Run Projection

Read one coherent local scene revision and freeze direct inputs before asynchronous work. Prompt trims/validates the current minimum 2 and maximum 8,000 characters (`src/lib/validators.ts:71`, `src/lib/generation/limits.ts:2`). Draft prompts can be incomplete but cannot run.

Zero images means text-to-image/count `1..4` (`src/lib/validators.ts:62`); 1..16 images means image-to-image/current fixed count 1 (`generator-studio.tsx:747`, `parse-generate-request.ts:83`). Display that effective mode/count, not hidden coercion. Normalize current model/size/quality/output/moderation/negative-prompt options per generation node.

```ts
type CanvasRunProjectionV1 = {
  canvasId: string;
  nodeId: string;
  runId: string;
  prompt: { sourceNodeId: string; text: string };
  references: Array<
    | { sourceNodeId: string; ordinal: number; kind: "imported"; assetId: string }
    | { sourceNodeId: string; ordinal: number; kind: "result"; jobId: string; imageId: string }
  >;
  params: CanvasGenerationParams;
};
```

Use the backend's typed `canvasRun` branch in existing `POST /api/generate`; reuse existing charge/worker/polling/cancellation rules, not a parallel subsystem. Run validates the frozen **unsaved local projection**, not equality with the last saved graph. A live owner shell is required, a saved graph/revision is not.

Local imported originals register owner asset IDs before execution. Ready result inputs use verified image/job IDs, not a temporary URL or a latest-run pointer. Missing/evicted/expired references block run/save with actionable re-upload while preserving graph/text/order. Server revalidates ownership/readiness/options/order/idempotency; frontend validation is only UX.

`CanvasGenerationParams` is the nonsecret current settings subset. Provider keys/challenge are request-only runtime data; saved account provider identifiers can be referenced, but a non-remembered key requires reentry after reload. Never promise secrets restore from a saved canvas/outbox.

Align the backend's proposed shared safety defaults: <=512 KiB scene JSON, <=200 nodes, <=400 edges, <=8 MiB original, <=32 MiB aggregate ready run references, <=16 ordered inputs. These are protective proposals, not capacity measurements. Reserve expected result nodes/provenance edges before accepting a run and honor that reservation during later edits, preventing a billable output from silently being omitted when the canvas fills.

### 6. Stable Results, Reruns, And Durable Suppression

Use stable result IDs such as `result:${imageId}` within a canvas. A result's job/image IDs never rebind to a newer run. Rerun/retry replaces only the generation node's current attempt binding; new results append, old result nodes/outgoing reference edges remain.

```ts
type AcceptedCanvasRunBinding = {
  runId: string;
  nodeId: string;
  jobId: string;
  outputsHandled: boolean;
};
```

One current binding per generation node is enough with one active run per node. Old result nodes carry their own canonical IDs; an unbounded editor attempt-history array is not necessary. A document-level `runBindings` collection avoids duplicating a `latestJobId` on each node.

1. A callback updates owner-scoped canonical cache first. Attachment also requires the same live canvas/node/current run binding and no deletion/source tombstone. Being selected is not required; ownership is.
2. Materialize only canonical terminal batches: append stable result nodes/provenance edges and set `outputsHandled=true` in one scene mutation and one local transaction. Failure closes the attempt without clearing previous successful outputs.
3. Deleting a result does not reset `outputsHandled`; later polls/cache refresh/reopen cannot recreate it.
4. Deleting a generation removes incident edges/current bindings and revokes runtime attachment rights. Existing result nodes can remain standalone with their canonical image IDs. Its accepted job continues, but no callback recreates the generation/new output organization.
5. Canvas deletion closes source attachment while pending; successful deletion removes organization without cancel/refund. A job can finish into works without a new shell/node.
6. Reopen hydrates only accepted bindings explicitly in the selected local draft/manual snapshot, and explicit result image IDs. Never enumerate all canvas-associated jobs and make them nodes.
7. If terminal output can arrive incrementally, use a durable handled/suppressed-image set instead of the single flag. Current proposal assumes immutable complete terminal batches; backend must verify this, not keep two redundant authorities.

A persisted local deletion survives reopening that local draft. Another device intentionally restores the last acknowledged manual snapshot: if deletion was never saved, that older snapshot may still contain the node. Making unsaved deletion instantly global would contradict R11. Late Save acknowledgements must never overwrite newer local deletion. Node IDs are immutable and never reused.

### 7. Root Polling And Unsaved Run Recovery

Maintain a canonical cache plus immutable job/source registry per owner. The single root pending subscription is deduplicated accepted/known jobs in encountered spaces, not the visible renderer or arbitrary recent history. Leaving/selecting/deleting a view never invokes cancellation or creates another poller.

Extend the existing hook with per-entry identity/epoch, `AbortController`, and in-flight state. Foreground/timer events cannot start simultaneous reads for one entry. Before callback or reschedule, verify owner/mount context, current entry identity, and subscription. Stop invalidates the entry; aborted/stale responses cannot recreate it. Abort reads/clear timers/listeners on cleanup. A boolean mounted flag alone is insufficient across StrictMode cleanup/setup.

Preserve existing hidden-tab pause/foreground catch-up/backoff/terminal stop/attempt bound. Stable callbacks route by source/job ID. Existing `router.refresh()` may refresh credits/catalogs but cannot reload drafts or regress a cached terminal job to stale initial pending data.

Record a local nonsecret submission outbox **before** sending a potentially billable request: owner/canvas/node/run IDs, frozen projection, blob/asset locators and phase. Store originals before relying on durable recovery. No API keys or challenge tokens. A failed/unavailable local write needs an explicit recovery warning, not a false durability claim.

After acknowledgement, accepted binding/job ID and outbox completion commit together locally. Reopen performs only the backend's bounded owner-scoped **read-only** run-ID lookup for uncertain acceptance. A found job attaches only to its still-live source. Missing/unknown/unresolved lookup leaves an actionable uncertain/retry state; it does not automatically POST or assume failure. Only an explicit user transport-retry action resends the original run ID/frozen projection, never current edited inputs or a fresh automatic job. Missing runtime credential/challenge may require user action.

- Same-device unsaved runs resume from persisted local binding/outbox.
- Another device reconciles only bindings captured in the manual snapshot. A later unsaved run remains in works/local draft until another Save, not injected into the old account graph.
- Evicted local scene/outbox cannot reconstruct unsaved layout from retained jobs; works remains media recovery.
- Save during unresolved acceptance captures only what exists in that scene. It cannot claim an unreceived job acknowledgement; acceptance afterward makes the local draft newer/unsynced.

### 8. Complete Conversation Loading Before The Canvas Changes The Pool

History-removal child leaves the existing query intact. Canvas child adds bounded owner/conversation content loading before canvas jobs can displace chat in global latest 50.

An additive `GET /api/me/conversations/:id/generations?cursor=...` is the smallest clear surface; alternatively add a validated scoped branch while preserving the existing no-query global GET. Backend owns auth/stable pagination. Do not query one endpoint per historical ID or load all conversations' full history at startup.

Initialize selection once after mount. Seed only exact conversation memberships from available initial/cache DTOs; fetch selected conversation content with captured owner/conversation/request epoch and abort obsolete reads. Late A pages must not replace B or a new/deleted conversation. Merge/deduplicate its pages, preserving accepted local jobs/terminal states; render its membership only. Loading/error is explicit, never a reason for orphan/canvas/global history fallback. Fresh props cannot restore cleared/deleted conversation content.

## Static Planning Review (2026-10-28)

- Query/scope: Compare the parent and canvas child's `prd.md`, `design.md`, and `implement.md` against sections 1-8 and the companion persistence contract. Static frontend review only; no application or infrastructure checks.
- P2 clarification: Reconstruct result-node/provenance reservations when restoring accepted pending bindings or uncertain local outbox entries, before allowing capacity-consuming edits. The child stores reservations only in runtime (`.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:69`) and specifies reservation before Run (`.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:104`), but the restore contract must also preserve it. Example: 196 scene nodes, an accepted count-4 run, reload, then four new cards before canonical hydration consumes the 200-node budget. Use the original frozen projection/canonical job count, not newly edited generation parameters. Add a deferred-hydration/reload capacity test; unavailable identity must not falsely mark outputs handled or silently omit billable images.
- Alignment: One mounted shell/pane-aware chat effects, owner/source epochs, accepted-only cloud bindings, direct ordered input resolution with valid prior-result feedback, immutable results and durable suppression, no automatic POST on reload, and scoped chat loading are represented in the child design/plan. The child design's explicit encoder distinguishes the flat local resolver projection from its nested `canvasRun.input`/`canvasRun.parameters` wire contract; do not submit the illustrative local type directly.
- Failed-Delete reconciliation and persistence/device review notes are in [canvas-frontend-persistence.md](canvas-frontend-persistence.md#static-planning-review-2026-10-28). Both reports and the converged child design are required context; these are planning clarifications, not reproduced bugs or new product requirements.
- Resolution (2026-10-28): CLOSED in planning. The updated child design explicitly reconstructs unhandled pending reservations from canonical job count/frozen outbox before capacity-consuming edits, conservatively blocks unresolved identity, rejects edited parameters as count authority, and reserves nothing for handled runs (`.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/design.md:107`). The regression is named in `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/implement.md:91`. Focused reread confirms this P2 clarification is resolved; implementation/test execution remains future work.

## Caveats / Not Found

- This is static planning research, not implementation or executed validation. The original report was split losslessly after section 8 to fit context injection limits.
- Persistence, management, phone, verification, and shared caveats continue in [canvas-frontend-persistence.md](canvas-frontend-persistence.md); do not implement only this half of the contract.
- Existing library/version/license evidence remains in [canvas-library-comparison.md](canvas-library-comparison.md), not repeated here.
