# Studio dual-mode and independent canvas

## Status

- Final parent acceptance passed on 2026-10-30. AC1-AC17 are reconciled in
  `verification.md` and the independent `checks/integration-sql-final-review.md`.
  Required local/automated gates pass; physical-device and real-service/release
  limitations remain explicit. The parent is archived with `--no-commit`;
  source remains uncommitted and this is not deployment or mobile approval.
- Execution approved on 2026-10-30: final cross-child integration acceptance
  and closeout only. The user confirmed the latest final summary in the next
  message; activation applies only to this parent's direct acceptance work. The
  2026-10-30 continuation reuses this parent; it does not reopen canvas product
  design, recreate either completed child, or activate phone editing.
- Delivery history: the user approved history-cleanup first on 2026-10-29, then
  separately approved canvas-v1. Both children are verified within their recorded
  scopes and archived under `archive/2026-10` using `--no-commit`. Their archived
  `verification.md` and `handoff.md` are the execution/evidence authority.
- This parent owns R1-R17, the cross-child acceptance matrix, necessary narrow
  integration regressions/fixes, and final handoff. It is not a second canvas
  implementation. Its AC checkboxes below do not inherit child completion.
- The approved closeout plan is in `implement.md` and
  `research/final-integration-closeout-2026-10-30.md`. The preserved pre-execution
  source/index/archive baseline is in
  `checks/final-integration-2026-10-30/source-baseline.json`.
- Both child code patches remain uncommitted and undeployed. The independent
  mobile editor remains planning/deferred; archival does not authorize its work.

## Goal

Remove history-image clutter from the creation studio while preserving the
existing conversation experience. Offer a button-switchable, independent
connected-node canvas for visual image creation, with explicit per-node runs and
recoverable account-saved projects rather than mixed conversation/history data.

## Background: Original Research Baseline

These findings describe the 2026-10-28 pre-implementation source and retain its
historical file anchors. They are not a claim that the current tree lacks the
now-implemented canvas or scoped conversation loader. Current-source evidence
and remaining integration gaps are in the closeout research report.

- Stack: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Prisma/PostgreSQL, and
  the existing asynchronous Go generation worker.
- History has two studio surfaces: the desktop right rail and the phone
  sidebar's recent-images tab (`src/components/create/parts/session-sidebar.tsx:71`).
- Generated images are retained independently of conversation organization;
  works queries by account ownership (`prisma/schema.prisma:453`,
  `src/lib/server/works.ts:128`). Removing presentation must not alter retention.
- The global latest-50-job query also hydrates conversations, and older
  conversation restoration is already incomplete. It is not rail-only data
  (`src/app/create/page.tsx:36`,
  `src/components/create/generator-studio.tsx:189`,
  `src/components/create/generator-studio.tsx:937`).
- No canvas document/viewport/edge model or standalone reference-card upload API
  exists (`prisma/schema.prisma:499`, `src/app/api/generate/route.ts:153`).
- Existing frontend specs require mount-guarded initialization and
  active-conversation scoping; global/orphan history is not fallback content.
- GitHub research distinguishes linked-node applications from spatial boards.
  Contextual canvas chat does not establish shared content between these modes.
  React Flow core is MIT and has compatible React peers; current tldraw SDK
  requires separate production licensing. App-root licenses do not clear SDK or
  paid-example rights. Primary-source details remain in the research reports.

## Requirements

- R1: Produce a codebase-backed map of studio/history surfaces, generation
  lifecycle, conversation ownership, persistence, and regression boundaries.
- R2: Compare credible canvas libraries and AI-canvas applications using primary
  GitHub/official sources, recording licensing and integration constraints.
- R3: Recommend a two-mode architecture that reuses existing generation services
  without duplicating provider, billing, worker, cancellation, or polling logic.
- R4: Record and resolve user-owned product/scope/compatibility decisions before
  final design; permission to create/research a task is not implementation approval.
- R5: Keep product code, dependencies, schema, and existing stored data unchanged
  during planning/research. Activate implementation only after the final gate.
- R6: Include connected creative nodes in canvas v1, not a placement-only board.
  Expose editable prompt/reference inputs, generation actions, stable image
  results, and visible semantic connections.
- R7: Keep conversation and canvas content independent, with canvas-specific
  new/select navigation. A new canvas is empty; switching modes never
  automatically transfers conversation, other-canvas, or global-history content.
- R8: Connections supply actual prompt/reference inputs to the target generation
  node. Validate ready inputs and freeze them for each submitted job; visual-only
  lineage or fallback inputs from another workspace do not satisfy this behavior.
- R9: Run only after an explicit action on an individual generation node.
  Connecting/editing nodes does not schedule upstream/downstream jobs, regenerate
  results, or execute a whole graph.
- R10: Assess incremental API/database/media costs from repository evidence,
  clearly labelling estimates and assumptions. Do not claim measured deployed
  capacity, benchmarks, or spare server resources without actual verification.
- R11: Account-own canvas documents. Autosave drafts locally by account/canvas;
  save scene content to the account only through an explicit save. Distinguish
  local/unsynced edits from the last acknowledged account snapshot. Other devices
  restore that snapshot, not subsequent local edits. Intentional canvas
  new/rename/delete metadata and job/media persistence are separate from scene
  saving and must not misleadingly mark a draft as account-saved.
- R12: Remove desktop and phone studio history presentation, preserving generated
  jobs/images, works, conversation creation/actions, and the existing
  conversation-deletion retention contract. Canvas/node deletion removes
  organization/associations, not canonical jobs, image records, or result objects.
- R13: Explicit account save includes unsubmitted imported reference originals,
  permitting another device to use every saved input without the original
  browser/file. Reuse unchanged already-persisted references. Save success means
  both snapshot and all its reference inputs are available; it is not generation.
- R14: Include new/select/rename/delete canvas management, without duplication.
  Deleting a canvas/node does not automatically cancel a submitted generation or
  cause a deletion-induced refund. Successful outputs remain in works; existing
  supported cancellation and normal failure/refund contracts stay separate.
- R15: Desktop v1 supports pan/zoom/drag, node editing/connections, reference
  upload/reuse, manual generation, and image viewing/downloading. Phone canvas
  v1 is read-only selection/view/pan/zoom, without canvas editing, reference
  upload, connections, or generation. Preserve phone conversation creation and
  responsive, hydration-safe loading on both device layouts.
- R16: Track full phone canvas editing/reference inputs/connections/manual
  generation as an independent deferred task. It depends on verified v1
  foundations, is not started now, and does not block v1 acceptance.
- R17: Protect imported originals used by saved canvases or submitted jobs,
  including completed jobs. Only newly registered unused canvas imports become
  cleanup-eligible seven days after detach or successful orphan upload. Exclude
  generated works and unregistered legacy media. An expired input in an old
  unsynced draft requires actionable re-upload, without discarding graph/prompt
  metadata. A local removal does not detach the last cloud snapshot's inputs
  until an explicit replacement save or canvas deletion.

## Acceptance Criteria

- [x] AC1 / R1: Persisted architecture research identifies affected files, exact
  desktop/phone removal surfaces, data flow, and required regressions.
- [x] AC2 / R2: Persisted comparisons separate libraries from complete AI apps
  and record primary sources, retrieval dates, licenses, versions, and caveats.
- [x] AC3 / R3: The recommendation explains independent modes, shared generation
  services, persistence costs, and the selected v1 boundary.
- [x] AC4 / R4: The decision inventory records every selected product decision;
  no blocking v1 product question remains. The latest parent closeout summary
  received fresh explicit approval on 2026-10-30 before implementation.
- [x] AC5 / R5: Only planning/research artifacts change in this phase; no app
  code, dependency, schema, stored image, generation, or conversation changes.
- [x] AC6 / R6: Canvas exposes prompt, reference, generation, and result cards
  with visible input/lineage connections. A generation has one connected prompt
  and up to 16 explicitly ordered ready reference-image sources; invalid links,
  duplicate sources, or excess cardinality are rejected with a usable explanation.
- [x] AC7 / R7: New canvases have no inherited nodes/links. Selection shows only
  the chosen canvas; mode/project switching preserves separate drafts and does
  not copy content, submit jobs, or project global/orphan history into either view.
- [x] AC8 / R8: A run uses its connected prompt and ordered references, respecting
  existing prompt/provider/media limits and image-to-image count 1. Missing or
  unfinished inputs block the run rather than being ignored; later edits do not
  change that job's input snapshot. Reruns retain previously referenced images.
- [x] AC9 / R9: Clicking Run submits only the selected generation node using its
  ready inputs. Edits/connections never run jobs; an unfinished upstream result
  requires a separate explicit upstream run before it can be used downstream.
- [x] AC10 / R10: Cost research separates scene metadata/media, existing/new
  storage, and local-only/account-autosave/manual-account-save strategies, with
  explicit assumptions and no deployed-capacity claim.
- [x] AC11 / R11: Local edits survive reload without background scene saves.
  Save success appears only after acknowledgement; another device sees the last
  saved snapshot, not newer edits. Failed/conflicting saves preserve unsynced
  drafts. Other accounts cannot access either the cloud document or its locally
  indexed draft; browser clearing/eviction is not described as account recovery.
- [x] AC12 / R12: Neither desktop history rail nor phone recent-images tab
  remains. Conversation actions continue, works still lists retained images,
  and canvas/node deletion never deletes jobs, canonical image records, or result
  storage objects. Conversation deletion still preserves generated media.
- [x] AC13 / R13: Import and save a reference before generating; another device
  can restore and use it without re-upload. Saving again reuses the unchanged
  stored file. Failed uploads never yield fully-saved status or discard the
  local draft; save itself never submits a generation job.
- [x] AC14 / R14: Empty-new/select/rename/delete work and duplication is absent.
  Deleting a canvas/node while generation is pending/running sends no cancel
  request or deletion-induced refund. Completion remains in works without
  recreating deleted organization; normal cancel/failure/refund behavior remains.
- [x] AC15 / R15: The complete desktop creation loop works. A phone can
  select/view/pan/zoom a canvas but has no canvas mutation/run affordances;
  existing phone conversation creation still works. Both layouts load without
  hydration/viewport failures and retain usable Chinese controls/input focus.
- [x] AC16 / R16: `studio-mobile-canvas-editor` exists independently in planning,
  with reciprocal task links and an explicit verified-v1 prerequisite; it remains
  deferred and is not a parent child blocking the first release.
- [x] AC17 / R17: Before seven days detached imports remain available. Afterwards
  bounded scheduled cleanup removes only eligible new unused imports;
  reattachment/save/enqueue prevents a racing deletion. Saved/job-used inputs,
  generated works, and legacy objects survive. Expired local inputs show a
  recoverable missing-input state and cannot falsely save or run.

## Exclusions

- Whole-graph execution, automatic upstream scheduling, or edit-triggered
  downstream regeneration; realtime collaboration, masks/photo editing, video
  canvas, and full-scene export are not implied by this image-studio change.
- Background account autosave of scene edits, canvas duplication, or automatic
  conversation/canvas conversion and global-history fallback.
- Phone canvas editing/connections/reference upload/generation in v1; the
  independent mobile follow-up owns these later capabilities.
- Deleting generated media, changing works-delete storage behavior, or removing
  video-studio history. Canvas deletion is not a storage-release operation.
- During the original planning phase: product implementation, dependency installation,
  prototype execution, migrations, commits, real DB/S3 tests, or deployment.
- Approved final closeout: no feature expansion, full phone
  editor, production canvas enablement, real `.env` reads, development/production
  database, real S3/provider or paid generation operations. No staging, commit,
  push, or deployment; only the accepted parent may be archived with
  `--no-commit`, and any journal command must also suppress auto-commit.

## Risks And Deferred Items

- Local draft eviction/clearing loses unsynced data; old drafts can reference
  cleaned unused imports and require replacement uploads. Preserve actionable
  recovery states, not a claim of indefinite draft retention.
- Concurrent saves, late submission/poll responses, and deletion races must not
  overwrite another workspace or resurrect deleted nodes/canvases. Account
  conflicts need explicit recovery rather than silent last-writer-wins.
- The history child retained the shared latest-50 query until the canvas child
  verified its owner/conversation-scoped replacement. Final integration must
  preserve that completed ordering and verify old-conversation isolation, not
  restore the obsolete global bootstrap.
- Static React-peer/license evidence is not a successful app/browser spike.
  Preserve MIT notices and avoid separately licensed Pro examples/tldraw code.
- Reference storage is the main new retained-media cost. No deployment capacity,
  real object-store configuration, performance benchmark, or production rollout
  is verified/authorized by this plan.

## Task Map And Order

| Task | Owned Acceptance | Relationship / Order |
| --- | --- | --- |
| `studio-dual-mode-canvas` | AC1-AC5, AC10, AC16, final integration AC6-AC17 | Parent requirements/design/integration; not a direct product implementation target. |
| `studio-history-cleanup` | AC12 presentation subset; its HA1-HA4 | First v1 child; finish/check before overlapping canvas studio/sidebar edits. |
| `studio-canvas-v1` | AC6-AC9, AC11-AC15, AC17 and integration retention/loading | Second v1 child; depends on checked history cleanup. |
| `studio-mobile-canvas-editor` | Later full phone editing, not v1 acceptance | Independent P3 follow-up after verified canvas v1; own future design/review. |

- History child: `.trellis/tasks/archive/2026-10/10-28-studio-history-cleanup/prd.md`.
- Canvas child: `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/prd.md`.
- Mobile follow-up: `.trellis/tasks/10-28-studio-mobile-canvas-editor/prd.md`.
- The history-before-canvas implementation sequence is complete. Do not reopen
  or concurrently reimplement either archived child. The approved closeout plan
  activates only this parent's direct integration work.

## Planning Artifacts

- `prd.md`: converged source requirements, decisions, and acceptance mappings.
- `design.md`: technical boundaries/contracts and cross-child integration design.
- `implement.md`: sequential execution, validation, and review gates.
- `implement.jsonl` / `check.jsonl`: real spec/research contexts for dispatch,
  distinct from the human execution plan; no app/code paths belong in them.
- `research/current-studio.md`, `research/ai-canvas-references.md`,
  `research/canvas-library-comparison.md`, and its source snapshot preserve
  source/third-party evidence rather than claiming completed runtime tests.
- `research/canvas-persistence-costs.md`, `research/canvas-reference-retention.md`,
  `research/canvas-backend-contracts.md`, `research/canvas-backend-operations.md`,
  `research/canvas-frontend-contracts.md`, and `research/canvas-frontend-persistence.md`
  provide cost, ownership, lifecycle, and integration evidence. Topic reports are
  split losslessly below the per-file context injection cap.
- `research/recommendation.md` and `research/product-decision-inventory.md`
  preserve synthesis and the selected decisions. No blocking v1 product
  question remains; parent closeout is now approved, while later mobile work
  still requires its own review gate.
- `research/final-integration-closeout-2026-10-30.md` records the current
  evidence inventory, AC-by-AC review plan, concrete remaining test gaps and
  archive conditions. Its companion JSON records read-only applicability
  checks, not a new application test run. Parent `verification.md` now maps all
  ACs and fresh checks. The recovered `parent-db-contracts-04` result passes
  37 full-history and 37 additive-history cases with exact owned cleanup;
  the three earlier Docker preflight failures remain historical evidence.
  Final independent reconciliation passes in `checks/integration-sql-final-review.md`,
  superseding the earlier pending review without altering its historical record.
  Do not restart Docker/SQL merely because an earlier report predates this result.
