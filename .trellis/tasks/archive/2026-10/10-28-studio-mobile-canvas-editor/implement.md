# Phone canvas editor implementation and verification plan

## Gate And Work Target

- Work ONLY on `.trellis/tasks/10-28-studio-mobile-canvas-editor`. The user
  explicitly approved the latest final summary with "可以" on 2026-10-30.
  This fresh approval, not earlier delegation alone, opens the activation gate.
- No new/duplicate task or archived-task activation. Main alone runs task start
  after approval; confirm the current task is this mobile task before dispatch.
  Do not follow/clear the unrelated UI session-fallback pointer during planning.
- No staging/commit/push/deployment/production feature activation, real dotenv,
  DB/S3/paid service operation, automatic Docker startup/pull or archive.
- Main owns task/context/spec/evidence records. Main dispatches one
  trellis-implement for the ordered source work, then a separate trellis-check
  for full-scope review/self-fix. No product code is written by main during this
  execution, and sub-agents do not recursively spawn implement/check agents.

## 1. Ownership And Allowed Files

The implement agent owns these mobile product responsibilities and their tests;
the independent check agent may self-fix within the same declared scope.

| Responsibility | Planned Product Files |
| --- | --- |
| Capability and mounted editor state | `src/components/create/hooks/use-studio-mode.ts`, `src/components/create/hooks/use-canvas-editor.ts`, `src/components/create/canvas/editor-state.ts`, `src/components/create/generator-studio.tsx` |
| Atomic connection edit and renderer policy | `src/components/create/canvas/commands.ts`, `src/components/create/canvas/controller.ts`, `src/components/create/canvas/controller-types.ts`, `src/components/create/canvas/renderer-types.ts`, `src/components/create/canvas/renderer-adapter.ts`, `src/components/create/canvas/renderer-constants.ts` |
| Gesture/visible bounds | `src/components/create/canvas/mobile-interaction.ts`, `src/components/create/hooks/use-canvas-mobile-viewport.ts` |
| Shared fields/editor/node chooser | `src/components/create/parts/canvas-node-editor.tsx`, `src/components/create/parts/canvas-node-picker.tsx`, `src/components/create/parts/canvas-prompt-field.tsx`, `src/components/create/parts/canvas-node-inspector.tsx`, `src/components/create/parts/canvas-nodes/node-shell.tsx`, `src/components/create/parts/canvas-nodes/prompt-node.tsx`, `src/components/create/parts/canvas-nodes/reference-node.tsx`, `src/components/create/parts/canvas-nodes/generation-node.tsx`, `src/components/create/parts/canvas-nodes/result-node.tsx` |
| Stage/management/presentation | `src/components/create/parts/canvas-stage.tsx`, `src/components/create/parts/canvas-toolbar.tsx`, `src/components/create/parts/canvas-sidebar.tsx`, `src/components/create/parts/canvas-dialog.tsx`, `src/components/create/parts/canvas-stage.module.css` |
| Keyboard-safe transient dialogs/viewer | `src/components/create/parts/canvas-runtime-dialog.tsx`, `src/components/create/parts/image-zoom-modal.tsx` |

- New filenames may be consolidated along design boundaries if that reduces
  duplication; don't create a new package/global store or spread options/types.
- Existing `use-canvas-documents`, `use-canvas-runtime-lease`, viewer/job/draft
  hooks remain authority. Changes there require an identified lifecycle defect,
  main coordination and retained regression tests, not a second transport/store.
- `parts/chat-pane.tsx` and `parts/composer.tsx` may receive only evidenced M4
  keyboard/IME/focus compatibility corrections with retained chat regressions;
  do not redesign chat or reinterpret its intentional Enter submission.
- Tests may be added/updated only for these responsibilities under
  `src/tests/unit/` and existing `src/tests/unit/helpers/` as necessary. Do not
  edit DB suites, published SQL, schema, server routes, Worker, package/lock/env,
  global stylesheet or unrelated homepage/UI files without re-review of scope.
- You are not alone in this codebase. Read latest files, preserve every existing
  patch, and accommodate authorized UI concurrency. Never reset/check out/stash
  other changes or include them in commits. If an owned/shared canvas file changes
  unexpectedly, stop and ask main to coordinate before writing over it.

## 2. Ordered Execution Checklist

### A. Main pre-execution checkpoint

- [x] Present/review final PRD/design/plan, get fresh explicit approval, then
  activate this existing mobile task. Record user approval separately from D1/D2
  and delegated D3-D6 choices; no automatic start from artifact presence.
- [x] `task.py current --source` must match this target before native injection.
  If session identity/current-task resolution is wrong, fix only this session's
  context after coordination; never overwrite another session's pointer.
- [x] Recheck HEAD/index/owned source and archive identities against the planning
  baseline. Record allowed concurrent UI deltas separately; don't overwrite the
  original baseline or attribute those changes to mobile.
- [x] Validate real context entries, helper/runtime identities, safe environment
  and prerequisites. Record a fresh pre-edit source snapshot and test baseline
  under this task's `checks/`; application checks begin only after approval.

### B. Implement foundation and shared state

- [x] Split layout selection from permission: mount-safe phone capability,
  unchanged feature/not-ready/owner/deleting rejection, no runtime lease loss on
  orientation/keyboard/pointer changes. Keep SSR chat and mount-only preferences.
- [x] Add typed owner/canvas/node editor port and nonsecret field registry above
  lazy renderer. Preserve raw parameter/custom-size drafts through panel/mode/
  node/layout changes, and invalidate exact owner/deleted targets only.
- [x] Extract shared native prompt input behavior and reuse current generation
  field constants/normalization. Preserve synchronous accepted text and focused/
  composing external-value guards; mark unapplied parameter input honestly.
- [x] Add pure and controller atomic replaceConnection: validate copied candidate,
  same edge/order on rejection, no intermediate publication or run/reservation
  changes. Preserve provenance, canonical duplicates and completed-result feedback.
- [x] Add foundation tests and run scoped tests/lint/types. This checkpoint is
  not mobile acceptance or rollout; do not enable production to demonstrate it.

### C. Implement coherent phone creation loop

- [x] Add unscaled selected-node actions/editor and current-scene node chooser.
  No automatic opening on drag/keyboard selection; one image tap opens one view.
- [x] Reuse generation inspector fields/source list with large connect/replace/
  disconnect/up/down controls. Give sources labels/previews/readiness without
  exposing a new account-wide library. Keep desktop port/drag/keyboard behavior.
- [x] Implement browse/edit/explicit Move modes, whole-card captured drag and
  renderer-only preview. Commit once on valid drop; cancellation/second finger
  cancels preview, not prior edits. Keep controlled measurements and camera.
- [x] Wire New/import/replace/Save/rename/confirmed node/canvas delete/reload to
  captured existing commands. Chooser cancel does nothing; late callback cannot
  redirect to current selection. Keep original Blob/upload reuse and status.
- [x] Gate Run/Save through pending field validation before captured commands;
  invalid text blocks/focuses its field. No Close/Move/input/resize auto Run/Save.
- [x] Preserve provider/CAPTCHA confirmation, read-only uncertain recovery and
  original transport retry, canonical terminal attachment/suppression, old results
  and existing original viewer/download holds. Don't borrow chat settings.
- [x] Clamp readable fields/actions to scoped visualViewport/element bounds,
  native panel scroll and safe areas without remounting focused field DOM or
  changing authorization. Preserve chat observers/IME on returning to chat.

### D. Verify, independently review, and hand off honestly

- [x] Run all new/retained targeted regressions, full ordinary suite, lint,
  nonincremental tsc and full production build through isolated wrappers.
- [x] Build/run a fresh actual-component browser fixture with exact copied source
  hashes, fake identity/HTTP and network allowlist. Do not reuse predecessor
  renderer/browser results after these source changes.
- [x] Run independent trellis-check over every declared responsibility and
  retained boundary, not only the last patch. Self-fix in scope, then repeat
  affected gates until green; record preexisting versus new warnings honestly.
- [x] Main reviews frontend/operations spec-sync needs; update the old phone
  read-only policy and new UI-state/gesture/test contracts after implementation.
  Do not change backend contract semantics or falsely certify a physical phone.
- [x] Write verification matrix and handoff: automated verdicts, source/versions/
  raw receipts, pending physical/native/service/CI entries and untouched patches.
  Without required physical checks, do not check all MA boxes or archive.
- [x] Keep code/evidence uncommitted; no automatic commit/archive/deploy. Finish
  bookkeeping only if separately requested and always respect no-commit policy.

## 3. Automated Acceptance Matrix

| Gate / MA | Concrete Assertions | Existing / New Test Surfaces |
| --- | --- | --- |
| T1 / MA1,MA4 | Atomic prompt/image replacement, unchanged edge/ordinal on error, invalid/provenance/duplicate source rejection, capacity reservation unchanged, no submit. | New `canvas-controller-connections.test.ts`; existing `canvas-graph.test.ts`, `canvas-controller-runs.test.ts`, `canvas-renderer-adapter.test.ts`. |
| T2 / MA3,MA4 | Mount-safe capability, phone ready edits, feature-off/owner/deleting rejection, layout does not revoke leases; owner/disabled/unmount still cancels correctly. | New `use-canvas-editor.test.tsx`; existing `generator-studio-canvas.test.tsx`, `use-canvas-runtime-lease.test.tsx`, controller tests; revise only obsolete width=read-only expectations. |
| T3 / MA1,MA3,MA4 | Native text setter never restores stale value during composition; Enter229/caret/selection/local scroll; pending model/size/seed survives node/mode/layout; invalid draft blocks Run/Save and retains focus; no secret field registry. | New `canvas-node-editor.test.tsx`; existing `canvas-stage.test.tsx:64`, `canvas-stage.test.tsx:89`, `canvas-stage.test.tsx:488`, studio/edit tests. |
| T4 / MA1,MA4 | Browse pan versus Move, scoped whole-card preview, valid drop commits once; cancel/second finger/stale origin commits nothing; measured nodes stay visible without fabricated resize. | New `canvas-mobile-interaction.test.ts`; existing `canvas-stage.test.tsx:271`, adapter and terminal-placement tests. |
| T5 / MA1,MA2,MA3 | Captured chooser target/cancel, local import/no upload on selection, original replace/reuse, Save capture while newer edits occur; same IDs/CAS and no lost blob. | Existing `canvas-stage.test.tsx:308`, `canvas-controller-documents.test.ts`, `canvas-reference-runtime.test.ts`, `canvas-draft-store.test.ts`, new editor tests. |
| T6 / MA1,MA3 | Frozen ordered Run input, count/capacity/readiness, double tap admission, node/canvas/mode switching, original uncertain lookup/retry, no background POST or rematerialized deleted result. | Existing `canvas-controller-runs.test.ts:41`, `use-studio-jobs.test.tsx`, `generator-studio-origins.test.tsx`, `generator-studio-canvas.test.tsx`, parser/route regressions. |
| T7 / MA2,MA3 | Captured delete/reload confirmation, no jobs/works/credits cancel/refund; failed delete recovery and exact tombstone; viewer/download survives card/editor removal. | Existing controller document/run tests and `generator-studio-canvas.test.tsx:507`; new editor/dialog assertions. |
| T8 / MA3,MA4 | Finite/clamped visible bounds, keyboard/resize affects CSS only, stable focused DOM, observer cleanup, ordinary chat reattachment/IME/Enter/reference/settings retained. | New `canvas-mobile-viewport.test.tsx`; existing `chat-pane.test.tsx`, `generator-studio-feedback.test.tsx`, conversation/history tests. |

Test names identify coverage surfaces, not proof that every browser/device gate
passed. Fresh ordinary suites and independent regressions are recorded below.
Use real controllers,
encoders and actual components where relevant, not only detached state tests or
button mocks. Keep ordinary Vitest's sentinelled DB exclusions; no DB fallback.

## 4. Isolated Validation Commands

Prepared tools inspected during planning (existence/source only, no test run):

```powershell
$repo = 'E:/code/narra-image'
$node = 'C:/Users/Administrator/AppData/Local/Temp/narra-history-cleanup-20261029/node-v24.22.1-win-x64/node.exe'
$safe = 'C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea/react-flow-spike/safe-run.mjs'

# AFTER final approval/start, distinct labels for each run/checker.
& $node $safe mobile-impl-types-01 test 120000 $repo pnpm exec tsc --noEmit --incremental false
& $node $safe mobile-impl-lint-01 test 180000 $repo pnpm lint
& $node $safe mobile-impl-full-01 test 300000 $repo pnpm exec vitest run --testTimeout=30000
& $node $safe mobile-impl-build-01 build 600000 $repo pnpm build
& $node $safe mobile-impl-worker-ts-01 test 120000 $repo pnpm verify:worker-contracts:ts

# Narrow regression batch after the planned new files exist.
& $node $safe mobile-impl-focused-01 test 180000 $repo pnpm exec vitest run --testTimeout=30000 src/tests/unit/canvas-controller-connections.test.ts src/tests/unit/use-canvas-editor.test.tsx src/tests/unit/canvas-node-editor.test.tsx src/tests/unit/canvas-mobile-interaction.test.ts src/tests/unit/canvas-mobile-viewport.test.tsx src/tests/unit/canvas-stage.test.tsx src/tests/unit/generator-studio-canvas.test.tsx src/tests/unit/use-canvas-runtime-lease.test.tsx

# Planning/context/whitespace only; these do not activate the task.
python ./.trellis/scripts/task.py validate .trellis/tasks/10-28-studio-mobile-canvas-editor
git diff --check
```

- safe-run syntax is `label mode deadline cwd executable args...`. It calls the
  repository command runner and captures independent exit/deadline/duration and
  stdout/stderr. Copy original receipts into this task's checks, using new labels.
- Reverify safe helper/pinned Node identities before execution. Its safeEnvironment
  allowlists OS vars, sets dummy localhost-port-1 DB for ordinary tests, blanks
  real service secrets, denies repository dotenv reads and distinguishes build
  APP_URL from tests. Don't replace this with bare pnpm/Prisma commands.
- If existing tooling is missing/invalid, recreate an equivalently isolated
  helper in a uniquely owned temporary directory after approval; never read real
  dotenv or use real endpoints to get green checks. Don't change dependencies,
  bypass guards or run JavaScript arrows/redirection via `pnpm exec node -e`.
- Actual Worker/SQL/runtime source is unchanged in the approved scope. Keep the
  dated accepted prerequisite receipts; if code/harness/schema there changes,
  obtain scope review and rerun affected sentinel-only disposable wrappers.
  `verify:canvas-contracts:db` needs its own 360s+cleanup deadline; E2E has its
  own longer cap. No unrequested Docker startup, image pull or real-resource test.
- On Windows use headless/hidden helpers, exact owned process cleanup and native
  LiteralPath operations after resolved-path/owner checks. No broad taskkill,
  prune, volumes, user Temp cleanup or deletion/move composed across shells.

## 5. Fresh Browser And Physical Matrix

### Real-component fixture (after implementation)

- Reuse the audited predecessor browser approach, but create a uniquely owned
  mobile fixture and copy/hash actual current production components/lib/contract/
  CSS/build inputs. Recheck hashes after build and before browser verdict; changed
  parallel inputs invalidate that receipt and require rebuild, not stale reuse.
- Actual Next/React Flow/native IndexedDB, dummy owner/catalog and loopback fake
  HTTP only. Enabled fixture props are not production flag activation. Deny
  unexpected external requests and preserve exact original image bytes.
- Browser groups: mount/lazy/feature-off; 360/390/430 portrait and landscape;
  edit/IME native-setter instrumentation; pan/pinch/Move/cancel; source picker/
  atomic replacement/order; file import/replace/reuse; explicit Run/double tap/
  delayed ACK/recovery; Save while editing/second-profile restore; owner/deletion/
  download holds; keyboard/short viewport/dialogs/chat return; 24-node and
  200-node smoke; real lazy network-error/manual-refresh recovery.
- Capture actual engine version, source hashes, request counts, JSON receipts,
  original-byte downloads and phone/landscape screenshots. Main visually checks
  readable controls/safe bounds; screenshots do not prove physical IME behavior.
- Add browser tests to this task's owned fixture/evidence or reuse the checked
  harness if available. Do not install a new product dependency/editor or convert
  fixture identity into an authentication/paid-provider claim.

### Physical/manual records (currently NOT PERFORMED)

| Target / MA | Required Manual Checks | If Unavailable |
| --- | --- | --- |
| Minimum-supported/current iOS Safari / MA1,MA3,MA4 | Native Chinese candidate Enter229/selection, caret, keyboard show/hide, real tap/pan/pinch/Move, portrait/landscape/notch, chooser return/cancel, original view/download. | Record missing actual OS/device/version receipts; no Safari/device pass from Chrome or desktop WebKit. |
| Android 12+ Chrome current/preceding engine / MA1,MA3,MA4 | Native Chinese IME, Android Back/keyboard, pointer cancellation/two fingers, file chooser/download and short landscape actions. | Record tested engine/device exactly; desktop mobile emulation remains separate. |
| Account/device recovery / MA2 | Same-profile local versus separate-profile captured account Save, existing reference without reupload, ownership/conflict/deletion. | Use labelled fixture/browser/unchanged API evidence; do not invent a physical-account/service run. |

- A physical fixture/LAN setup, real login/service or actual CI requires separate
  safe authorization; no server/device was started during planning. A user can
  supply manual receipts later. Pending physical gates don't prevent code/auto
  work, but do prevent full MA/device acceptance and automatic archive/rollout.

## 6. Independent Review, Evidence And Stop Points

- Implement/check prompts start `Active task: <this task path from current>`.
  State the agent is already its Trellis role, must act directly, not spawn
  recursive roles, read native saved output if truncated or pull its jsonl plus
  PRD/design/plan. Reject injected foreign UI-task context rather than follow it.
- Give explicit ownership from section 1 and read-only concurrent UI boundary;
  enforce no real dotenv/services/staging/commits and honest physical limits.
- Check the whole M1-M4/MA1-MA4 scope, reused code/DOM lifetimes, shared layers,
  skipped gates and stale-source applicability. Fix in scope, retain red receipts,
  rerun affected checks, and report exact existing warnings versus new issues.
- Main updates `.trellis/spec/frontend/canvas-studio.md` and any genuinely changed
  state/hook/quality convention; operations review may conclude no contract delta.
  Archive predecessor receipts remain untouched; no false metadata acceptance.
- Stop/re-review on new backend/wire/library/dependency scope, inability to meet
  chosen touch/IME behavior, unsafe test coordinates, unexpected overlapping
  edits or missing required verification. Never silently remove sources, shrink
  browser targets, enable production, auto-run or reset a user's patch.
- Final mobile verification maps every criterion to fresh evidence and pending
  manual/service/CI portions. Keep task active/unaccepted where a required gate
  is pending, preserve all uncommitted code, and obtain separate closeout consent.

## 7. Execution Checkpoint: 2026-10-30 / 2026-10-31

- Activation and original source preservation completed after final approval;
  `task.json` remains `P3 / in_progress`. Main does not implement product code.
- Native implement/check roles completed all B/C responsibilities. Independent
  review fixed outside pointer completion, focused parameter composition,
  automatic-size canonical display and saved-provider label target. A narrowly
  reopened review then corrected editor accessibility pinch CSS and added two
  actual-component regressions. No backend/wire/lifecycle/dependency expansion.
- Final product/test scope remains 35 paths: 23 existing byte-relative edits,
  12 additions. All 1337 planning identities and 167 byte-exact `.before` copies
  were audited, with no non-owned source change and empty staging. Concurrent
  homepage task artifacts are separately authorized and remain untouched.
- `checks/source-freeze-after-zoom-2026-10-30.json` owns final source identities.
  `mobile-zoom-full-01`: 125 files / 1442 ordinary tests; types pass; lint zero
  errors / nine existing warnings. `mobile-final-build-02` passes on this source.
  `mobile-final-worker-ts-01`: 6 files / 32 tests; underlying contracts unchanged.
- Fresh actual-source fixture-04 uses copied installed packages and direct
  pinned Node/Next build. `mobile-browser-07` passes all 27 groups; pre/post source
  and package-link audits pass. Red tooling attempts are retained and explained
  in `checks/browser-tooling-correction.md`.
  Earlier source builds/browser attempts are not inherited as final passes.
- The visible Close -> toolbar Save sequence is intentional when the bottom
  editor covers background controls. Close emits no request and retains pending
  fields; toolbar Save applies/validates those same mounted fields before capture.
- Physical target devices/native IME/OS chooser/download/accessibility zoom,
  real services and actual CI remain unperformed. No MA boxes, archive, commit,
  production enablement or rollout readiness are authorized or claimed.
- Main's post-artifact lint/types pass with zero errors/nine baseline warnings;
  frontend canvas/state/quality/index synchronization is complete. Full MA1-MA4
  acceptance and phase 3.4/closeout remain withheld under the user boundaries,
  not falsely checked off by completing this code/automated checklist.

## 8. Resumed Verification And Ownership: 2026-10-31

- Continue the existing task in a new session after recovering the original
  approval/history. Only the new session pointer was restored; no duplicate
  task, repeated activation or product source change was made.
- Preserve the exact 35-path mobile freeze. Fresh actual-source fixture-05/
  browser-08 has 256 copied inputs and 27 passing groups; scoped mobile lint
  covers 34 TS/TSX paths with zero errors/warnings, without changing rules.
- The fresh ordinary full test/type/production-build runs are dated snapshot
  receipts, not coverage for subsequent homepage edits. Full-root lint fails
  on the other task's generated/vendor evidence; retain it and never substitute
  the scoped lint verdict as a full-worktree pass.
- The final 1514-identity preservation comparison found new homepage tests/specs
  and was retained as failed. Main stopped, then the user explicitly approved
  preserving those ongoing changes and completing only mobile responsibility;
  see `checks/resume-user-approval-2026-10-31.md`.
- Native independent review, the new 22-file retained-boundary regression batch,
  raw evidence/integrity and current continuation verdict are recorded in
  `checks/mobile-resume-verification-2026-10-31.md` and its independent report.
- Do not modify homepage/shared lint configuration, delete foreign outputs,
  broaden this task or infer new commit/archive/service/device permission.
  The original MA/device gates remain pending; the historical checked execution
  checklist is not current full-repository acceptance or closeout approval.

## 9. Explicit Administrative Archive: 2026-10-31

- The user subsequently requested archive of this existing code/scoped-check
  task. Use only `task.py archive ... --no-commit`; do not stage, commit, journal,
  deploy, run services or create another task as part of this request.
- `closure.md` preserves the unaccepted physical/native/real-service/CI and
  full-root lint gates. `completed` archive metadata is administrative closure,
  not a new test pass, full MA acceptance or rollout readiness.
- Keep original receipts and pre-closeout artifacts byte-exact; update only
  local context/structured metadata references to the archive destination.
  Recheck exact move preservation, unchanged product source/HEAD/index, empty
  staging and unrelated session/task isolation after the move.
