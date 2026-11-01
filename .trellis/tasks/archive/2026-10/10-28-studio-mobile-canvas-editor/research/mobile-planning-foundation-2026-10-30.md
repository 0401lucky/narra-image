# Research: Mobile planning foundation and preservation boundaries

- Query: Continue the existing mobile task without reopening accepted work,
  losing uncommitted changes or treating planning as execution approval.
- Scope: internal, read-only source and accepted artifact inspection
- Date: 2026-10-30

Final authority update: the user subsequently approved D1/D2 and delegated
D3-D6 to main. Current PRD/design/implement and
`mobile-final-planning-decisions-2026-10-30.md` own those converged choices;
earlier alternative/question text here records the research chronology only.
No code/start/test or physical acceptance follows from this note.

## Findings

### 1. Authority and current state

- The user explicitly authorized planning continuation of
  `.trellis/tasks/10-28-studio-mobile-canvas-editor`, not creation/start,
  implementation, staging, commits, deployment or real-service access.
- `task.json` is independent `P3 / planning`; MA1-MA4 remain unchecked. There is
  no current session task pointer. Do not run start merely to establish context;
  planning research uses the user's explicitly named task path.
- Trellis Phase 1.1 and brainstorm require repository evidence before questions,
  one highest-value product question per turn, a lossless converged PRD and
  complex design/implementation artifacts before final review. Fresh subsequent
  approval of the latest final summary is required before execution.

### 2. Predecessor acceptance and evidence provenance

Read in full before planning:

- `../../archive/2026-10/10-28-studio-dual-mode-canvas/verification.md` and
  `handoff.md`: AC1-AC17 accepted, five added SQL cases preserved, 37 full and
  37 additive executions, independent final review without required findings.
- `../../archive/2026-10/10-28-studio-canvas-v1/design.md`, `verification.md`
  and `handoff.md`: CA1-CA13 accepted within recorded local/automated limits;
  actual authenticated runtime paths and separate fixture-browser evidence.
- Both final archives/journals used `--no-commit`. Historical red/preflight
  receipts remain history; they are not instructions to restart Docker or redo
  accepted gates during mobile planning.
- Fourteen predecessor browser groups ran actual Next/components/React Flow/
  native IndexedDB with fixture identity and HTTP. Runtime tests separately
  used signed-session authentication, disposable SQL and fake storage. Neither
  is physical-phone/native-IME or paid-provider browser E2E evidence.
- Real phones, OS-native candidate UI, real provider/S3/deployment, measured
  capacity and actual GitHub Actions execution were not validated. Mobile
  source changes will invalidate affected renderer/browser/build receipts;
  predecessor results cannot be re-labelled as new MA passes.

### 3. Preservation baseline

- `planning-source-baseline-2026-10-30.json`: HEAD
  `1f7948e334c589dc6db38ac045b584f0f5381481`, branch `main`, 154 porcelain status
  entries, empty staging area, exact index SHA-256, 1337 tracked/untracked
  file/absence identities outside the owned mobile task directory.
- Only Git inventories are used to enumerate baseline files. Real dotenv files
  are excluded from content reads; no ignored secrets are enumerated or loaded.
  The permitted `.env.example` is a template, not a service credential source.
- Main owns PRD/design/implementation/context updates, this foundation and the
  bounded keyboard/verification audit. The touch research agent owns only its
  explicitly named report in this task's `research/`. The longer keyboard-agent
  audit was stopped and its write ownership revoked before main took over;
  it did not produce a report. Authorized task-research writes are expected.
- At each stopping point, compare HEAD/index and all baseline identities;
  report and stop for an unexpected out-of-scope change. This preservation
  comparison is not a product test or evidence of MA acceptance.

#### Authorized concurrent UI work

- A later checkpoint found eight new task/context/reference/research files
  under `.trellis/tasks/10-30-homepage-warm-editorial-redesign/` and the effective
  current task resolving to that directory by session fallback. Main stopped
  and asked before continuing; it did not read those files or change the pointer.
- The user confirmed that this is unrelated UI work and explicitly authorized
  preserving/ignoring it while continuing mobile planning. The follow-up
  checkpoint has unchanged HEAD/index and all 1337 baseline identities, only
  those eight authorized additions, and mobile `P3 / planning`.
- Keep the original baseline immutable. Treat known concurrent UI artifacts as
  outside mobile ownership, not as mobile changes to stage/revert or a task to
  follow. Newly conflicting edits to shared canvas/input files need coordination;
  do not overwrite another session. Planning always targets the explicit mobile
  path. Before future implement/check dispatch, activation/context must resolve
  this mobile task, not silently inject the unrelated session-fallback task.

### 4. Reuse existing business boundaries

- `src/components/create/hooks/use-canvas-documents.ts:27`: controller lifetime
  is owner/feature/jobs, not renderer or mode; read-only updates are separate at
  `src/components/create/hooks/use-canvas-documents.ts:49`.
- `src/components/create/canvas/controller.ts:101`: centralized mutation
  capability rejection; `controller-types.ts:79` currently explains phone
  viewing-only. Phone implementation must revise this deliberately, retaining
  real inactive/loading/deletion safeguards rather than removing all guards.
- The touch audit identifies
  `src/components/create/hooks/use-studio-mode.ts:30` as the current width-based
  edit gate (768 CSS pixels). Separate phone edit authorization from responsive
  layout; orientation/keyboard-induced presentation changes must not mutate
  business capability, remount the owner controller or cancel a waiting lease.
- `src/components/create/parts/canvas-stage.tsx:74` currently chooses an
  inspector only for generation nodes; the inspector at `canvas-stage.tsx:190`
  is already outside the transformed flow. Prompts still use scaled inline
  inputs. Extending that nontransformed boundary is evidence for a phone-editor
  recommendation, not approval of its UX or gesture choices.
- `src/components/create/canvas/controller.ts:551`: Save captures save ID,
  revision, scene, originals and deletion epoch; newer edits do not share its
  acknowledgement. Save resolves all originals, including disconnected ones;
  account Save is not a generation action.
- `src/components/create/canvas/controller.ts:623`: explicit New creates a
  local immutable UUID/shell. `controller.ts:642` and `controller.ts:676` hold
  explicit rename/delete. Deletion is organization-only; delayed terminal
  activity reconciles retained captured bindings without a generation POST.
- `src/components/create/canvas/controller.ts:881`: imported files retain the
  existing local Blob/upload identity; replacement and reuse stay on that
  boundary. Generated inputs stay canonical result IDs, not uploaded copies.
- `src/components/create/canvas/run-commands.ts:45`: only Run and explicit
  original-transport retry reach submit. `run-commands.ts:97` freezes origin,
  scene/direct inputs and count before asynchronous preparation; the nonsecret
  outbox must be durable before any potentially billable POST. Recovery is read-
  only, repeated transport uses the same intent/run and manual rerun is new.
- `src/components/create/canvas/studio-bridge.ts:5`: owner/canvas/node/run origin
  and transient lease contracts remain shared. Credentials/CAPTCHA cannot enter
  document or local outbox, be borrowed from chat, or survive owner invalidation.
- Domain scene v1, account identity/CAS, native drafts, roots/retention,
  `/api/generate`, Worker/credits/cancel/refund and single canonical studio
  poller are unchanged scope. No new schema, backend, provider, graph scheduler,
  mode-copy or cleanup authority is needed for a phone presentation layer.

### 5. Product decision status

- D1: approved primary editor direction; see the dated record below and current
  PRD. Exact movement affordances are a separate remaining D6 decision.
- D2: approved panel connection/input selection, failed-replacement preservation
  and explicit reference ordering; see the dated record below and current PRD.
- D3: device/browser/viewport and native-IME/accessibility/performance targets,
  including which unperformed physical checks must block acceptance.
- D4: phone management/advanced controls beyond New/selection/manual account
  Save and the confirmed node/reference/single-run loop.
- D5: whether reference reuse means current-canvas sources or an account-wide
  works/imported-asset library. The touch report establishes the current-canvas
  command path and incomplete library discovery/insertion; it does not settle
  the user's intended scope. This is separate from management controls.
- D6: dedicated header dragging versus deliberate selected-node movement, and
  predictable pan/pinch versus input scrolling within the approved D1 structure.

The code establishes present behavior and technical constraints, not approval
of a recommended phone UX or narrower supported-device scope. Do not select
recommendations on the user's behalf.

#### D1 primary editor direction approved

- On 2026-10-30 the user accepted the proposed primary interaction direction:
  select a node and edit through an independent unscaled
  bottom panel for prompt/reference/generation settings and explicit single-node
  Run. Keep canvas movement/pan/zoom and panel/input scrolling distinguishable;
  drag selection or image actions must not implicitly open competing overlays.
- Trade-off: an extra select/open step compared with inline editing, in return
  for readable controls independent of canvas zoom and reduced accidental
  movement/input competition. Exact movement gestures, connections, targets,
  management and library scope remain unapproved. D1 approval is not approval
  of the final implementation plan or `task.py start`.

#### D2 primary connection direction approved

- On 2026-10-30 the user accepted target-node panel input selection as the
  primary phone connection path: choose prompt/reference/completed-result
  sources with identifiable
  labels/previews/status; replace or disconnect a source and adjust explicit
  reference order with large controls. Do not require finger-precise port dragging
  or two visible endpoints. Desktop direct-port behavior remains unchanged.
- Accepted replacement behavior: reject an invalid/unavailable/duplicate source
  without losing the old connection, and preserve a reference's ordinal when
  deliberately replacing its source. Connection edits never Run automatically.
- Current connect/disconnect/reorder commands support explicit operations.
  Replacement as one action needs validated atomic scene editing rather than
  publishing disconnect before a possibly rejected connect; this is a technical
  design need, not permission to change product code now.
- Trade-off: less direct visual wiring than port dragging, but usable offscreen
  sources and explicit reference order. Source-library scope remains D5; a panel
  connection choice does not silently authorize an account-wide library.

#### D6 movement proposal prepared, not answered

- Recommend a deliberate selected-node Move mode rather than requiring a tiny
  transformed header: normally one-finger canvas pan and two-finger pinch zoom;
  select a node, activate Move, drag that card and explicitly finish movement.
  Scrolling the editor/input only scrolls its content, not the scene.
- The extra Move/Done steps trade speed for fewer accidental layout changes
  during browsing. Default direct header dragging is the alternative, with more
  zoom-dependent precision and pan/move arbitration to validate on phones.
- The renderer already separates control/input events and node/camera changes;
  movement can reuse moveNode and controlled viewport commands. Do not use
  controller readOnly as a gesture-mode switch or create another scene/store.
- Final design must specify pointer cancellation, a second finger joining a
  gesture, returning to browse/edit and selection/focus without unintended node
  movement or automatic Save/Run. No long-press/drag convention is approved yet.

## Related Specs

- `.trellis/spec/frontend/canvas-studio.md`
- `.trellis/spec/operations/canvas-contracts.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/hook-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/frontend/type-safety.md`
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/spec/operations/release-hardening.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`

## Caveats / Not Found

- No application tests/builds, browser launches, device or service operations
  were performed in this planning inspection. Baseline hashes prove preservation
  only. Live mobile acceptance remains pending.
- The archived task artifacts already record the necessary historical intent;
  no broader conversation-log search was needed to establish these boundaries.
- Touch/connection and keyboard/verification findings belong in the separate
  named audit files, not in unapproved product code or a rewritten predecessor.
