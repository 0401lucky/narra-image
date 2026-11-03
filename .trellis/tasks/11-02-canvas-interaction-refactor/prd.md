# Canvas interaction refactor

## Status And Authorization

- On 2026-11-02 the user permitted refactoring and task creation, then approved
  the image-first, secondary-connections direction in a subsequent reply.
- The user approved the latest complete final planning summary on 2026-11-02.
  See `checks/implementation-approval-2026-11-02.md`. This authorizes task
  activation and the scoped implementation/check work, not commit or deployment.
- On 2026-11-03 the user requested delivery to GitHub `main` in the original
  session, then explicitly approved preserving and synchronizing three newer
  remote commits before integrating, verifying and pushing this refactor.
  `checks/delivery/integration.json` records the protected synchronization.
  Commit/push approval does not authorize deployment, paid/live tests or automatic
  task archive; the existing device and service evidence boundaries remain.
- Product implementation begins after successful `task.py start`. Material scope
  changes must return to planning instead of expanding this approval.

## Goal

Let users create images, choose references and continue from results without
learning manual graph assembly first. Make selection, movement and editing
coherent while preserving existing canvas work.

## Background And Source Evidence

- The user reports that the previous canvas feels awkward and is not easy to
  use, and supplied https://github.com/basketikun/infinite-canvas as an
  implementation reference. This is not a cosmetic-only request.
- The reference was inspected at MIT-licensed commit
  `9cd3deacbcc598361807afc16c059a80dd18b6f9` (2026-10-25). It remains a node graph;
  useful patterns are image-focused cards, screen-sized contextual controls,
  direct creation/editing and adjacent linked results. Its mobile behavior was
  not browser-verified. Evidence: `research/infinite-canvas-reference.md`.
- First generation currently needs separate prompt creation, generation
  creation and manual connection
  (`src/components/create/parts/canvas-toolbar.tsx:63`,
  `src/components/create/parts/canvas-stage.tsx:172`,
  `src/components/create/parts/canvas-stage.tsx:191`). Board import does not
  attach an image to a generation target
  (`src/components/create/parts/canvas-stage.tsx:162`).
- Desktop image bodies open the viewer while movement is restricted to the
  header (`src/components/create/canvas/renderer-adapter.ts:27`,
  `src/components/create/parts/canvas-nodes/result-node.tsx:35`). Selection and
  manipulation should no longer compete with implicit preview.
- Durable scene v1 distinguishes prompt/reference/generation/result
  (`contracts/canvas/v1/scene.json:1`). Shared prompts, owner-scoped drafts,
  account snapshots, revision CAS, frozen manual runs and original-media
  retention are compatibility boundaries, not reference migration targets.
- `research/current-canvas.md` records current workflows, earlier decisions,
  source anchors and validation entry points. Friction is source-backed UX
  analysis, not a browser-reproduced defect or measured performance regression.
- `research/canvas-interaction-design-seams.md` records exact command, editor,
  import and gesture seams. Repository-answerable technical questions are
  resolved; no blocking product-direction question remains.

## Product Decisions And Constraints

- D1, user-approved: image creation/iteration are primary; manual graph setup
  and connections remain available as secondary/advanced operations.
- D2, approved direction: keep existing canvas data, connection capability,
  account/Save/run/media mechanisms and independent conversation creation.
- D3, compatibility: old shared prompt nodes remain shared. New quick creation
  gets a fresh prompt; moving editing into a composer must not silently clone
  or overwrite another source. Show shared-source context explicitly.
- D4, implementation boundary: preserve all existing nodes and coordinates.
  Make images dominant and workflow cards compact; do not hide, merge, migrate
  or auto-layout old graphs to simulate a different document format.
- D5, responsive boundary: desktop images select/drag directly; phone browse
  and explicit Move remain distinct to avoid conflicts with pan/pinch. The
  editor stays readable and screen-sized, with one active captured target.
- D6, visual boundary: retain Chinese cream/orange editorial styling, existing
  typography and the independent conversation interface.

## Requirements

- R1: Provide a direct New image/creation action that opens an integrated
  prompt/reference/settings composer without requiring separate add/connect
  steps. New canvas is still empty until an explicit creation/import action.
  Creating or opening a draft does not submit a generation request.
- R2: Selected reference/result images expose Continue creating and explicit
  preview/download. Continuation prepares a new target with that image as input;
  the original and older results remain intact. Explicit Generate is required.
- R3: Unify desktop selection and whole-card/image movement, with a movement
  threshold and one accepted final position. Cancelled/interrupted gestures
  do not become edits or trigger viewing. Keep pan, cursor-anchored zoom,
  focused-card keyboard access and explicit Locate.
- R4: Put primary prompt, reference and generation controls close to the
  selected creation card without scaling inputs with the scene or shrinking
  the viewport on selection. Use a bounded native-scroll sheet on phones;
  preserve focused DOM, composition, raw fields and reachable actions.
- R5: Use identifiable thumbnail-first same-canvas reference selection with
  add/replace/remove/reorder, canonical duplicate/readiness checks and the
  existing 16-input limit. Imports retain spatial positioning and captured
  chooser targets. Batch import/attachment is accepted together or rejected
  without partial scene changes or altered old input order.
- R6: Keep old nodes, coordinates, edges, explicit input order and provenance
  selectable/editable. Secondary graph tools preserve prompt-source selection,
  shared-prompt behavior and direct connections; no data migration is required.
- R7: Preserve local automatic drafts versus manual captured account Save,
  owner/readOnly/readiness guards, pending-field validation, immutable manual
  runs/outbox/retry/recovery, one job poller, result suppression, originals and
  viewer/download leases. Navigation, editing, importing and movement never
  run a graph, silently discard an input, cancel work or change billing.
- R8: Verify the new flow through real component/controller regressions and
  fresh source-bound browser fixtures. Preserve unrelated application behavior,
  document verification boundaries, and do not inherit old test receipts.

## Acceptance Criteria

- [ ] AC1 / R1,R7: From empty New, one creation action opens a composer with
  connected private prompt and generator. Type and explicitly Generate without
  hand-wiring. Draft creation/selection/opening sends zero generation requests;
  rejected growth/inputs leaves the previous scene and selection unchanged.
- [ ] AC2 / R2,R5,R7: Continue from a live same-canvas image, supply an ordered
  validated reference and explicitly run the captured new target once. Results
  appear nearby through existing materialization; originals, old result IDs and
  positions survive rerun, navigation and recovery.
- [ ] AC3 / R3,R7: Single image click selects rather than opens the viewer;
  visible preview/download work. Whole-card drag previews locally and commits
  once. Below-threshold clicks, cancellation, second pointer, outside completion,
  stale camera/source and owner/readOnly/deletion changes commit no movement.
  Keyboard selection/movement and viewport-scoped Delete remain accessible.
- [ ] AC4 / R4,R7: Desktop composer remains readable across supported zoom and
  does not change scene camera or viewport dimensions just by opening. At
  360/390/430px and short layouts, the phone sheet scrolls natively, controls
  remain reachable, inputs are >=16px and primary touch targets >=44px. Close,
  mode/selection/orientation changes retain raw drafts and focused composition.
- [ ] AC5 / R5,R7: Thumbnail add/replace/remove/reorder changes the intended
  target and explicit ordinal only. Invalid/duplicate/unavailable sources and
  over-capacity or invalid batch files preserve the complete old scene/input
  list. Late/cancelled chooser events cannot target the latest selection.
- [ ] AC6 / R4,R6,R7: Load a representative old graph without changing IDs,
  coordinates, sources, runBindings or stored format. All nodes/connections remain
  manageable. Existing shared-source edits remain shared and are labelled;
  missing-prompt repair keeps the generation textarea/caret and accepts successive
  native input events without silent source replacement.
- [ ] AC7 / R7,R8: Existing Save/continued-edit/conflict/owner/outbox/terminal/
  original retention and chat regressions pass. Invalid pending fields block
  Run/Save; IME/Enter cannot submit accidentally; feature-off/real readOnly remain
  enforced independently of layout. No credentials/library/UI state enter scene.
- [ ] AC8 / R1-R8: Lint, strict types, full non-DB tests, production build and
  fresh native-browser fixture flows pass against recorded source hashes. Inspect
  desktop/mobile visuals and native IndexedDB reload. Report fake HTTP/CDP,
  physical-device, real-service and actual CI evidence separately.

## Out Of Scope

- New video/audio/agent/plugin/collaboration or crop/mask/upscale tool suites;
  account-wide works/reference discovery; groups/multi-select/graph undo/redo or
  arbitrary persisted image resizing/layers. Native text undo remains native.
- Renderer replacement, shared scene/API/SQL/Worker/billing/storage rewrites,
  automatic whole-graph generation, account autosave or cross-mode copying.
- Production flags, migrations/deployment, live credentials/provider/DB/S3 or
  paid testing, actual remote CI or automatic task archive. Git commits and the
  GitHub `main` push have separate 2026-11-03 delivery approval.
- Unrelated homepage/conversation redesign or upstream theme/branding adoption.

## Risks And Verification Boundaries

- Native IME, gestures, clipping and image hit areas require browser evidence;
  jsdom/CSS assertions alone do not prove usability. No FPS guarantee is claimed.
- Physical iOS/Android, OS chooser/download, real authentication/services and
  actual GitHub CI remain unperformed unless separately requested. Automated
  code completion does not certify those targets or production rollout.
- The reference is inspiration, not a storage/provider transplant. Substantial
  upstream code reuse requires retaining MIT notices; independent implementation
  from the recorded interaction patterns is preferred.

## Artifact Status

- Research and product-direction discovery are complete. This PRD has passed
  the lossless convergence rewrite; no blocking open question remains.
- `design.md` defines technical boundaries and trade-offs; `implement.md` defines
  execution and verification. Curated JSONL files contain spec/research context.
- Final planning review is approved. Implementation and current-source quality
  checks follow `implement.md`; no product test verdict, device acceptance,
  commit or deployment is claimed merely by these planning artifacts.
