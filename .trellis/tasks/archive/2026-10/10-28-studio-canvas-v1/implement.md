# Canvas v1 execution and verification plan

## Activation And Ownership

- Wait for subsequent explicit approval of the latest parent review and checked
  `studio-history-cleanup` HA1-HA4 handoff. No concurrent history/canvas edits.
- Coordinator activates this child and dispatches `trellis-implement` with
  `Active task: <path from task.py current>` first, this PRD/design/plan, curated
  contexts, and explicit file/module ownership. Implement/check agents are not
  alone: preserve other edits and stop on unexpected workspace changes.
- Main owns planning/spec/integration/user decisions. Use fresh `trellis-check`
  after implementation; self-review is not the final Trellis quality gate.

### Checked Predecessor Handoff: 2026-10-29

- History cleanup HA1-HA4 and its frontend quality gate pass. Before future
  dispatch, read `.trellis/tasks/archive/2026-10/10-28-studio-history-cleanup/handoff.md` and
  `verification.md` for preserved latest-50/drop/action boundaries and live gaps.
- The predecessor task is `completed` and was archived at the user's request
  with `--no-commit`; its checked code patch is still uncommitted. Preserve it
  and all existing planning/research files. Receipt of that handoff alone did
  not authorize this successor. On 2026-10-29 the user separately confirmed the
  existing final plan/order and authorized canvas-v1 implementation; this child
  is now activated. No commit, push, deployment, real DB/storage validation or
  mobile-editor activation is authorized. See `progress.md` for actual execution.

## Ordered Implementation Checklist

1. Load child/parent artifacts, research, frontend/worker/media/release/shared
   specs, and the checked predecessor code. Recheck status, actual environment
   manifest, helpers/consumers, and regressions. Material changes return to
   planning/review, not silent expansion.
   Research is split below the 32 KiB per-file injection cap. If the total
   injected context degrades an entry to an index line, explicitly read its
   required report/spec in chunks before the corresponding edit; do not assume
   all listed sources were inlined or change global Trellis limits.
2. After activation only, install pinned React Flow MIT core and notices. Spike
   a client-only fixture adapter with four card types, handles, Chinese IME,
   scroll/focus, keyboard, phone read-only pan/pinch, negative coordinates,
   scene round-trip, lazy mount and return-to-chat. No direct-provider code or
   licensed Pro example; failed compatibility requires reviewed design revision.
3. Establish pure shared scene/input/run/asset types, schemas, constants and
   fixtures before consumers. Keep zod validation in its existing owner and
   runtime/server-only boundaries explicit. Node/Go retention/lifecycle fixtures
   and the audited environment manifest are authoritative, not copied fields.
4. Add additive owner shell/document, asset registry/leases, snapshot usages,
   run reservations/job-input usages and indexes/migration. Test CAS,
   idempotency, tombstones, upload/GC fences and no destructive cascades. Add
   schema/capability probes and disposable migration coverage; never rewrite
   published migration SQL/checksums or repair a real database.
5. Implement owner shell/list/read/rename/save/delete, upload/read, bounded
   scene-ID hydration, and run lookup services/routes with explicit DTOs and
   resource limits. Enforce production S3/no-base64 imports, stable upload
   identity, captured Save/revision, all-original availability, conflict recovery,
   and exact registered-key-only cleanup. Save does not submit generation.
6. Extend existing generation parsing/submission with opt-in `canvasRun` inputs.
   Preserve auth/CAPTCHA/moderation/provider/precharge and legacy transports;
   explicitly enforce prompt/reference/count/byte limits. Freeze run input and
   transactionally bind run/job/asset roots once. ACK-loss retry returns the
   existing job without another charge; reload lookup never auto-submits.
7. Add one joined cancellable GC scheduler in Worker.Run after enabled schema/
   topology readiness. Use fixed seven-day grace, bounded claims/batches,
   row-lock/deleting-state fences, idempotent exact-key remote delete/backoff,
   and safe storage-versioning capability handling. Keep job cancellation,
   refund, generated/legacy media, and per-generation slots out of this sweep.
8. Add shared feature/config/readiness contracts using the actual
   `contracts/runtime/v1/environment.json`, Node env.ts and Go config.go owners.
   Update examples/docs/tests. Staged-off deployment stays compatible; enabled
   Node/Worker must agree on schema/capability. Generic old-worker health is
   insufficient; interval/batch controls never shorten seven-day grace.
9. Add owner/conversation-scoped paginated content loading before changing
   `/create` global bootstrap. Guard selection/owner/request epochs, merge
   canonical IDs/terminal states, and preserve new/deleted-chat/create-failure
   behavior. Canvas jobs never crowd chat into global/orphan fallback.
10. Refactor mounted studio controllers/common command routing with captured
    origins and provisional new-chat epochs. Guard one single-flight poller
    with abort/entry epochs. Keep chat DOM measurement/scroll/focus in its
    mounted pane; no two complete studios or renderer-owned job lifecycles.
11. Implement account/canvas IndexedDB drafts/blobs/nonsecret outbox, monotonic
    transactions, conflict/storage-failure states, upload reuse and preview
    cleanup. Build metadata management/manual captured Save and deletion
    guards, stable results/run bindings/outputsHandled. Reopen only scene-bound
    IDs; never rebuild from every server run or overwrite newer local edits.
12. Wire branded desktop stage/toolbars and mode/canvas navigation. Implement
    typed edge ordering/direct Run, result viewing/downloading and fit view.
    Phone exposes select/view/pan/zoom only; chat creation remains. No duplicate
    canvas, full mobile editor, automatic graph run, or implicit cancellation.
13. Run targeted/complete checks, safe DB/fake-storage and both-topology gates,
    and browser acceptance. Dispatch fresh Trellis check/fixes. Map actual
    outcomes to CA1-CA13 and parent AC6-AC17; record gaps honestly before spec/
    commit/finish handoff. Mobile follow-up remains deferred.

## Behavioral Test Matrix

- Graph: prompt/reference/result port types, one prompt, 16-input/order limits,
  invalid/duplicate/expired identities, self-links, manual iteration through an
  immutable old result, unfinished upstream, and no edit-triggered submission.
- Commands: origin capture during switch/delete/new-chat, create failure,
  same-run idempotency/ACK loss, partial preparation, stale upload response,
  captured input while edits continue, count 1 with refs, and preserved charges.
- Poll/materialization: simultaneous timer/foreground events, abort/StrictMode,
  terminal monotonicity, lazy/culling remount, deleted source/result completion,
  once-only complete terminal batch, scene-bound reload/unknown run lookup,
  restored pending output-capacity before edits, and terminal ACK/poll catch-up
  after failed Delete with no new submission or suppression reset.
- Persistence: original blob/scene round-trip, manual-save ACK versus newer edits,
  upload reuse/failed upload, metadata revision versus saved graph revision,
  same-tab/multi-tab/cloud conflicts, eviction/quota/blocked storage, account
  switch, missing-input re-upload, and no credentials/transient URLs in JSON.
- Backend/GC: cross-owner IDs, malformed/oversized scene, staged/orphan leases,
  seven-day detach/reattach, saved/completed-job roots, pending prepare cleanup,
  concurrent Save/Run/Delete/GC claims, remote failures/retries, immutable-key
  fencing, generated/legacy exclusion, and unsupported storage capability.
- Chat/mobile: older scoped conversation pages, stale A response after B/new/
  delete, no global fallback, preserved edit/reference/provider/retry/cancel,
  chat pane composer observation on return, phone read-only and usable chat.

## Application Commands After Approval

```powershell
pnpm exec vitest run src/tests/unit/generator-studio-session-history.test.tsx src/tests/unit/generator-studio-feedback.test.tsx src/tests/unit/generator-studio-edit.test.tsx src/tests/unit/generator-studio-retry-cancel.test.tsx --testTimeout=30000
pnpm exec vitest run canvas use-image-poller --testTimeout=30000
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vitest run --testTimeout=30000 --exclude '**/worker-contracts-db.test.ts' --exclude '**/canvas-contracts-db.test.ts'
pnpm build
git diff --check
```

New canvas tests are planned, not existing files; use the exact implemented paths
or Vitest filename filters once written, including the existing poller tests.
Follow independent repository wrapper deadlines, not one short parent timeout.

## Cross-Layer And Operational Commands After Approval

```powershell
pnpm verify:worker-contracts:ts
pnpm verify:worker-contracts:go
pnpm verify:worker-contracts:db
pnpm verify:canvas-contracts:db
pnpm verify:migrations
pnpm verify:e2e
go -C worker vet ./...
go -C worker test -count=1 -timeout=50s ./internal/worker/...
go -C worker build ./...
docker compose config --quiet
docker compose -f docker-compose.e2e.yml config --quiet
```

Add the planned `verify:canvas-contracts:db` wrapper with its own longer bounded
deadline/cleanup reserve and sentinelled `canvas-contracts-db.test.ts`; exclude
it from ordinary Vitest and invoke it explicitly in repository CI wrappers.
Extend safe runners for enabled schema/GC/fake-S3 coverage while retaining
feature-off legacy cases; do not nest this suite under the short worker wrapper.
Runners must construct random
localhost DBs with sentinels/local images/owner labels; no .env fallback, image
pull, broad temporary-directory deletion, or real S3 deletion. Unavailable
required infrastructure is an unmet gate, not a pass; record it and stop rollout.

## Browser And Integration Acceptance

- Exercise desktop wheel/trackpad/keyboard, IME/text scrolling, node handle drag,
  reference upload/order, run/rerun, view/download and lazy return to chat.
- Exercise zoom 0.25/1/2, negative world positions, viewport restore, refresh,
  slow/lost ACK and Save while editing. Compare 50/200 realistic cards as stress
  cases and record observations, not invented throughput guarantees.
- Use two accounts and separate browsers/devices for saved-reference recovery,
  last-snapshot-only behavior, conflict/missing-input handling and app isolation.
- Phone-sized view: select/pan/pinch/view only, no metadata/graph/Run mutation;
  existing conversation creation, modals, safe areas and keyboard remain usable.
- Check works retention and no deletion-induced cancellation/refund. Use fake
  jobs/storage or disposable records, never delete real media for acceptance.

## Risk, Rollback, And Handoff

- Risky boundaries: generate parser/transaction, owner scope, shared poller,
  schema/readiness, asset deletion fences, and studio pane effects.
- Staged feature stays off until schema/Worker/storage capabilities and release
  checks pass. Release acceptance requires enabled canvas behavior, not merely
  a hidden UI that builds successfully. No rollout is authorized by planning.
- Reviewed rollback disables canvas/GC and follows worker rollback preflight;
  retain additive schema/snapshots/assets/roots/jobs/media. Never reset others'
  work, drop tables, or sweep a bucket/prefix.
- Capture verified scene/input/retention/runtime conventions into applicable
  specs; correct runtime-manifest doc drift. Hand actual contract/source pointers
  to parent integration and deferred `studio-mobile-canvas-editor`.
- All commands and checks here are future work. No application, browser, DB,
  Go, load, S3, migration or deployment verification ran during planning.
