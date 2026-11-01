# Research: Phone keyboard, IME and verification boundaries

- Query: Which existing phone input/layout/viewer safeguards must survive the
  editor change, and which target-device/acceptance decisions remain open?
- Scope: bounded internal source/spec/test-inventory audit by main; no execution
- Date: 2026-10-30
- Status: historical planning-only evidence before final decision convergence.
  Current PRD and `mobile-final-planning-decisions-2026-10-30.md` supersede
  pending/unapproved-choice language below; no execution or device pass occurred.

## Findings

### 1. Existing frame and chat lifecycle

- `src/app/create/page.tsx:71` uses a `100dvh`, overflow-hidden flex page.
  `src/components/create/generator-studio.tsx:1183` uses a full-height mounted
  studio and `min-h-0` pane. Preserve a nonzero renderer area and usable header,
  mode switch, editor scrolling and actions at short landscape/keyboard heights.
- `src/components/create/parts/chat-pane.tsx:28` owns only mounted DOM behavior;
  prompt, references, settings and jobs belong above it. Its textarea autosizes
  up to 144px at `chat-pane.tsx:46`; shell measurement uses ResizeObserver and
  window resize at `chat-pane.tsx:52`. Explicit focus requests use
  `preventScroll` at `chat-pane.tsx:69` and observers/listeners are cleaned up.
- Composer composition tracking is attached on each mounted ChatPane at
  `src/components/create/parts/chat-pane.tsx:103`. Returning from canvas must
  reattach these behaviors without resetting the unsent chat draft or reusing
  refs to removed DOM.
- `src/components/create/parts/composer.tsx:193` already has bottom safe-area
  padding and a bounded scrollable composer. The textarea at `composer.tsx:319`
  uses `text-base`; the Enter handler at `composer.tsx:306` checks both the
  composition ref and native `isComposing`. Preserve Shift+Enter and existing
  intentional chat submission; do not replace chat with canvas input behavior.
- No explicit `visualViewport` listener was found in `src/components/create/`
  or `src/app/create/` during this audit. Existing window resize and dvh are
  source facts, not proof that a soft keyboard/candidate bar cannot cover an
  action or trigger browser viewport panning on an actual phone.

### 2. D1 editor lifecycle and IME risks

- The touch audit establishes an existing nontransformed inspector and tiny
  scaled node inputs. A selected-node bottom sheet can reuse the former, but
  opening from every selection update would interfere with drag selection.
  Keep explicit edit-open intent separate from selection/movement/image actions.
- `src/components/create/parts/canvas-node-inspector.tsx:46` stores parameter
  editing strings locally. It commits on blur/Enter or before the account-Save
  shortcut; rejected values remain visible and `aria-invalid`. Its key guard at
  `canvas-node-inspector.tsx:63` checks `isComposing` and keyCode229.
- Prompt text must retain the native-event synchronous value update from
  `src/components/create/parts/canvas-nodes/prompt-node.tsx:18`, not wait for
  compositionend or the sheet to close. The accepted input still goes through
  the captured canvas/node controller command.
- Do not conditionally re-key/remount fields simply because orientation,
  available viewport height, pointer classification or keyboard state changed.
  That can lose unfinished parameter strings, focus/caret/selection and native
  composition even when the final saved scene looks correct.
- Keep incomplete parameter strings and validation as runtime UI state, not a
  new persisted scene schema. Define explicit close/selection behavior without
  silently replacing invalid text, marking it account-saved, or generating.
  Prompt/parameter Enter must not become Run; explicit keyboard activation of a
  Run/confirmation control can remain accessible.
- Consider measured visual viewport bounds/offsets for the phone sheet and
  transient dialogs in the final design, with a CSS fallback and cleaned-up
  listeners. Measurements must change presentation only, not controller
  mutability, document identity or camera/run state. This is a researched need,
  not an implemented or phone-validated algorithm.
- iOS focus zoom, native candidate-bar height, selection handles and event-order
  quirks are unverified. Readable unscaled text and adequate touch targets are
  recommendations; no numeric font/viewport threshold is selected as a proven
  device fix by this source audit.

### 3. Dialogs, transient run state and image paths

- `src/components/create/parts/canvas-dialog.tsx:26` moves focus on opening and
  restores a connected previous element; its form and Tab handling are scoped
  at `canvas-dialog.tsx:33`. Rename is metadata-only; delete/reload explicitly
  describe their organization/local-draft consequences.
- `src/components/create/parts/canvas-runtime-dialog.tsx:22` captures/restores
  focus. At `canvas-runtime-dialog.tsx:31` it uses a fixed backdrop, and at
  `canvas-runtime-dialog.tsx:43` a scrollable `85dvh` container. Channel inputs
  use a `text-sm` presentation and its form at `canvas-runtime-dialog.tsx:54`
  has intentional confirmation semantics. Native IME/implicit form-submission
  and keyboard-safe action placement need explicit validation; source alone
  does not prove candidate selection cannot confirm/dismiss a dialog.
- Multiple overlays must not compete for focus or Escape: one image tap must
  not open the editor and viewer together, and runtime confirmation must remain
  bound to the captured node rather than current selection. Preserve the lease
  manager's real owner/disabled/disposed cancellation while layout changes do
  not revoke availability or create an extra POST.
- `src/components/create/hooks/use-canvas-image-viewer.ts:93` captures/retains
  a reference-original lease independently until download ends. Closing the
  editor/card/viewer must not release an in-flight download's captured original.
- `src/components/create/parts/image-zoom-modal.tsx:18` scopes Escape and image
  display; the fixed fullscreen overlay, 90vh image and positioned controls need
  safe-area/short-landscape checks. Canvas wiring does not supply chat's
  "use for edit" action (`src/components/create/generator-studio.tsx:1195`).
- `src/components/create/generator-studio.tsx:547` downloads a Blob via the
  existing image proxy or local URL, triggers an anchor and falls back to a
  separate-window open. Keep this pipeline and original-byte semantics; mocked
  anchor clicks do not validate iOS/Android native download/file UI, fallback
  popup behavior or chooser return/cancel.

### 4. Concrete future tests, not executed results

| Layer | Required additions / retained behavior | Evidence boundary |
| --- | --- | --- |
| Pure layout/interaction state | Resize/offset/orientation/keyboard changes preserve selected/editor identity and do not change permission; stale observations cleaned up. | Deterministic state tests, not native keyboard proof. |
| Prompt/parameter DOM | Native setter never restores stale text during composition; Enter229, caret/selection, unfinished/invalid numeric text, explicit Save/Run/close and deliberate external updates. | jsdom events do not render a native candidate UI. |
| Real studio/controller | Phone edit/run is enabled only after initialization; layout changes keep transient target/lease; owner/feature loss still invalidates; captured file chooser/Save/Run callbacks ignore obsolete contexts. | Fixture transport, not paid-provider acceptance. |
| Chat regression | Return to chat reattaches measurement/composition/focus; unsent prompt/references/settings and conversation scope survive; intentional chat Enter remains usable. | Native OS IME needs a separate manual receipt. |
| Images | Viewer/download holds, reference replacement/card removal, chooser cancel/return and result navigation; original bytes preserved. | Link mocks do not establish native download UX. |
| Real browser fixture | Actual Next/lazy/React Flow/native IndexedDB; portrait/landscape/short viewport, input scroll vs canvas pan, Save while editing, distinct profile account restore and no unexpected POST on layout/mode changes. | Label browser engine and emulated device; fixture identity/HTTP explicitly. |
| Physical targets | Actual phone touch, native Chinese candidate selection, keyboard show/hide/back, caret/selection, portrait/landscape/safe areas, file picker and download. | Required only according to the user-reviewed target/gate; unperformed stays unverified. |

Reuse existing assertion patterns in `src/tests/unit/canvas-stage.test.tsx:64`,
`canvas-stage.test.tsx:89`, `canvas-stage.test.tsx:488`,
`src/tests/unit/chat-pane.test.tsx`,
`src/tests/unit/use-canvas-runtime-lease.test.tsx:73`,
`src/tests/unit/generator-studio-canvas.test.tsx:507` and
`src/tests/unit/generator-studio-feedback.test.tsx:412`. Their presence is not a
fresh run or full mobile coverage. Add tests for the changed actual components,
not only detached layout helpers or settled text assertions.

### 5. D3 device and acceptance decisions

- A reasonable proposal is iOS Safari plus Android Chrome as primary engines,
  with minimum/representative narrow portrait viewports and actual corresponding
  landscape/keyboard heights. Exact OS/browser versions, minimum width and any
  in-app browsers/WebViews are user-owned compatibility scope, not inferred from
  a media query. Record actual tested versions rather than "all phones".
- Decide whether native phone/IME acceptance is a blocking MA gate or remains
  an explicit follow-up limitation. Do not silently waive it because desktop
  Chrome can emulate a viewport. Real Safari, desktop WebKit and CDP mobile
  emulation must have distinct labels; none is an implicit substitute.
- Select a representative graph for usability/performance verification after
  scope is agreed. Shared 200-node/400-edge limits are protective domain bounds,
  not measured mobile performance. No framerate, latency, capacity or device
  benchmark is established by this report.
- Phone ownership/upload/save/run behavior can be tested with existing isolated
  fixture identities and fake services without paid generation or user data.
  A future physical fixture/network setup and real-service checks require their
  own safe setup/authorization; no server was started during planning.

### 6. Quality and provenance rules for implement.md

- `vitest.config.ts:11` excludes both sentinelled DB suites from ordinary tests.
  Ordinary green results do not establish SQL/GC/runtime acceptance.
- After mobile component/hook/CSS changes, rerun targeted and full ordinary
  Vitest, lint, nonincremental tsc and production build in the documented
  isolated/deny-dotenv environment; then fresh real-component/browser tests.
  Test/build APP_URL rules differ. Do not invoke a bare command that may load
  real dotenv merely because it is listed in package.json.
- Use the accepted repository wrappers for relevant contracts and, only when
  separately required/authorized, sentinel-owned disposable DB/runtime stages.
  Existing temporary safe/browser helpers are historical tooling references;
  their continued availability/identity was not checked in this audit.
- UI changes invalidate affected predecessor browser/source/build receipts.
  Unchanged backend/Worker/SQL receipts remain dated prerequisite evidence only;
  if their source/harness/schema changes, reverify the affected real gate. Do not
  replay paid jobs, enable production, start Docker or rewrite old red receipts
  just to produce more green counts for planning.
- Preserve raw command exit codes, versions, source hashes, assertions and
  explicit skipped/unperformed entries in a new mobile verification record.
  Local wrapper execution is not actual GitHub Actions; signed-session API
  replay is not browser login-to-provider E2E.

## Related Specs

- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/hook-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/spec/frontend/canvas-studio.md`
- `.trellis/spec/operations/canvas-contracts.md`
- `.trellis/spec/operations/release-hardening.md`

## Caveats / Not Found

- This is a bounded main-session audit. No product edit, application test/build,
  browser launch, real phone/native IME/Safari, service or actual CI run occurred.
- D1 editor behavior, D2 connection UX, D3 targets/gates, D4 management and D5
  reuse scope remain unapproved. Final design/implement/context convergence
  waits for those answers and fresh subsequent final-summary approval.
- Current UI risks are mobile adaptation/test needs, not newly demonstrated
  violations of the accepted desktop-first v1 contract.
