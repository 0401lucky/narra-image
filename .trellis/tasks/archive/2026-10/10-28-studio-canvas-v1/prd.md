# Desktop-first independent canvas v1

## Status And Dependency

- Verified on 2026-10-30: after authorizing this implementation stage and later
  requesting completion of the missing tests before archive, the user receives
  passing final local/DB/runtime gates and independent review. CA1-CA13 are met
  within the explicit verification/manual boundaries in `verification.md`.
  Only this child is archived with `--no-commit`; parent integration and mobile
  editing are not activated, and no deployment is authorized.
- Second child of `.trellis/tasks/10-28-studio-dual-mode-canvas/prd.md`.
  Start only after `studio-history-cleanup` passes HA1-HA4 and its quality gate.
  Their studio/sidebar implementation must not run concurrently.

## Goal

Let desktop users create images through connected prompt/reference/generation/
result nodes in independent account-owned canvases. Preserve conversation
creation, prevent workspace mixing, and restore explicitly saved scenes and
reference originals on another device without cloud-saving every edit.

## Background

- Existing authenticated generation, provider validation, moderation, CAPTCHA,
  precharge, Go execution, media persistence, and cancellation/refund paths are
  the reusable business pipeline (`src/app/api/generate/route.ts:40`).
- No canvas document, asset registry, or standalone reference upload exists
  (`prisma/schema.prisma:499`, `src/app/api/generate/route.ts:153`).
- The global latest-50 bootstrap also restores chat content
  (`src/app/create/page.tsx:36`). Replace it safely with conversation-scoped
  loading before canvas jobs can crowd out existing conversation restoration.
- Late submission/poll responses have source-level scoping risks
  (`src/components/create/generator-studio.tsx:704`,
  `src/components/create/hooks/use-image-poller.ts:48`). No runtime reproduction
  is claimed; origin ownership and guarded polling are required integration work.
- Parent research establishes React Flow MIT-core suitability, existing
  cream/orange Chinese UI, and production object-storage/legacy-media boundaries.

## Requirements

- C1 / parent R7, R15: Add a conversation/canvas button switch and separate
  canvas navigation. Preserve each workspace's draft/selection; new canvases are
  empty and no switch imports global/history/other-workspace content.
- C2 / parent R6, R8: Expose editable prompt/reference/generation cards and
  stable result-image cards. Connections supply one prompt and up to 16 ordered
  reference sources to a generation node. Invalid types, duplicates, unfinished
  results, missing/expired inputs, and excess limits are actionable errors.
- C3 / parent R3, R8-R9: Manually submit only the selected node through the
  existing generation path, retaining origin canvas/node/run identity and a
  frozen input snapshot. Reuse existing limits: prompt 2-8000 characters,
  text-only count 1-4, reference-based generation count 1, and media/provider
  restrictions. No edit-triggered or graph-wide execution.
- C4 / parent R11: Autosave drafts locally by authenticated account/canvas and
  explicitly save account scene snapshots. Show local, dirty, saving, saved,
  failed, and conflict states honestly. Do not persist credentials or runtime
  editor objects in drafts/scenes; another device restores the last saved scene.
- C5 / parent R13: Persist unsubmitted imported originals during explicit Save
  and reuse the same unchanged uploaded reference identities in later Save/Run.
  Saving a snapshot with an unavailable input must fail without discarding its
  draft or claiming a complete account save.
- C6 / parent R14: Include empty-new/select/rename/delete, not duplication.
  Intentional metadata operations never mark unsaved scene edits account-saved.
  Confirm deletion and protect stale save/run responses from recreating it.
- C7 / parent R12, R14: Canvas/node/result deletion removes organization, not
  canonical jobs or generated images, and sends no implicit cancel/refund.
  Late success remains in works without resurrecting removed organization.
  Normal supported cancellation and failure/refund behavior remains separate.
- C8 / parent R15-R16: Implement the desktop core creation loop and read-only
  phone canvas selection/view/pan/zoom. Preserve phone conversation creation and
  hydration-safe loading. Link the independent full-phone-editor follow-up.
- C9 / parent R3, R7, R11: Keep shared controllers/polling above lazy renderer
  unmounts, with origin-scoped commands, stale-response guards, and mount-only
  server bootstrap. Refresh/switching must not overwrite local content or
  attach results to whichever workspace is now active.
- C10 / parent R17: Protect saved-snapshot/submitted-job reference roots,
  including completed jobs. Schedule bounded cleanup only for newly registered
  unrooted imports after seven-day grace, fence save/enqueue/delete races, and
  exclude generated works and unregistered legacy media. Expired local-only
  references allow re-upload while preserving graph/prompt metadata.
- C11 / parent R1, R3, R7: Load conversations by owner/conversation and hydrate
  canvas content only from its saved/local scene's canonical IDs. Canvas jobs
  do not become chat/global-history fallback; no scene is reconstructed from all
  jobs or from the latest global slice.

## Acceptance Criteria

- [x] CA1 / C1: Mode/canvas switching preserves separate drafts and selection;
  a new canvas is empty. Switching/refreshing sends no generation and never
  displays orphan or unrelated chat/canvas content.
- [x] CA2 / C2: Prompt/reference/generation/result cards connect through valid
  typed handles; a generation resolves exactly one prompt and 0-16 ready ordered
  references. Invalid/duplicate/excess links and missing upstream images block
  execution with usable Chinese messages.
- [x] CA3 / C3: Run submits one node with the connected inputs and existing
  validation/count/media limits; later edits do not change its job snapshot.
  Reruns produce stable new results without overwriting images already referenced
  downstream. Link/edit actions never submit upstream/downstream jobs.
- [x] CA4 / C3, C9: Slow/lost acknowledgements, repeated same-run requests,
  switching, and polling recovery do not double-charge/submit or attach to a
  different workspace. Origin jobs remain inspectable under existing ownership
  and supported cancellation contracts.
- [x] CA5 / C4, C9: Drafts, local reference blobs, viewport, and live run bindings
  recover after same-browser reload. Storage failure shows a warning, preserves
  in-memory edits, and does not claim durability. No secrets/blob URLs/callbacks
  or copied job-status snapshots enter durable scene JSON.
- [x] CA6 / C4, C6: Account Save reports only an acknowledged captured snapshot.
  Edits made while saving stay dirty; failures/conflicts preserve the local
  draft. Another device gets the last successful snapshot, not later edits;
  account switching cannot recover another account's cloud/local document.
- [x] CA7 / C5: Save an unsubmitted reference and reopen on another device;
  generation can use it without re-upload. A later Save/Run reuses the unchanged
  upload. Interrupted/failed uploads never yield a complete save; expired/missing
  references offer re-upload without deleting graph/prompt content.
- [x] CA8 / C6-C7: New/select/rename/delete work, duplication is absent, and
  metadata-only actions do not mark a dirty scene saved. Canvas/node/result
  deletion does not delete jobs/media, cancel generation, refund due to deletion,
  or resurrect organization after late completion/reload.
- [x] CA9 / C7: Successful deleted-node/canvas results remain in works. Existing
  conversation retention, supported cancellation, handoff/unknown errors, and
  normal failure/refund rules stay unchanged.
- [x] CA10 / C8: Desktop pan/zoom/drag, node input/connections, reference input,
  manual Run, image viewing/downloading, IME/focus, and keyboard access work.
  Phone canvas is view/pan/zoom/select only; phone chat still creates images.
  Both layouts load without hydration, lazy-load, viewport, or composer failures.
- [x] CA11 / C10: Fake-clock and disposable DB/fake-storage cases prove seven-day
  orphan/detach grace, saved/completed-job roots, reattachment, and save/enqueue
  versus cleanup fencing. Generated/legacy media never become candidates;
  remote-delete failure is bounded/retryable and does not corrupt retained roots.
- [x] CA12 / C11: Canvas activity cannot displace chat restoration. Selecting
  an older conversation loads owner-scoped content, with bounded pagination and
  stale-selection guards. Canvas hydration resolves only scene-bound IDs and
  does not rematerialize deleted result cards or automatically import all runs.
- [x] CA13 / C1-C11: Targeted regressions, lint, types, full non-DB tests, build,
  Node/Go generation contracts, additive disposable migration, GC/runtime gates,
  and a fresh Trellis quality review pass. Record actual browser/manual gaps;
  planning artifacts are not claims that these tests already ran.

## Exclusions

- History removal itself belongs to the checked predecessor; no video-history
  change, generated-media deletion, or works-storage cleanup redesign.
- Whole-graph execution, auto-regeneration, collaboration, masks/photo editing,
  video canvas, scene export, or a new provider/worker/billing pipeline.
- Background scene account autosave, duplicate/import-conversation canvases,
  unguarded last-writer-wins saves, or global-history fallback.
- Full phone editing/reference upload/connections/generation; deferred at
  `.trellis/tasks/10-28-studio-mobile-canvas-editor/prd.md` after verified v1.
- Real production DB/S3 operations, deployment, data backfill, or capacity claims.

## Risks And Handoff

- New asset retention and generation reservation operations need explicit
  transactional fencing; URL-prefix guesses are never ownership proof.
- Local-only drafts can be evicted and references can expire after their grace;
  preserve clear unsynced/missing-input recovery, not implicit cloud recovery.
- Follow the existing media/release/runtime contracts. Use additive migrations
  and safe disposable runners, not real DB repairs or broad object deletion.
- Record verified v1 document, input, save, and lifecycle contracts for the mobile
  follow-up. It is independent, not a child blocking this deliverable.

## Artifacts

- `design.md` owns technical schema/API/graph/runtime/upload/cleanup contracts.
- `implement.md` owns the ordered execution and verification plan.
- `implement.jsonl` / `check.jsonl` curate parent research and applicable specs;
  no app/code paths or execution checklist belong in these context manifests.
