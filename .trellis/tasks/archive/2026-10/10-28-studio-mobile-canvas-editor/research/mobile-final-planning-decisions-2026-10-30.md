# Research: Final mobile planning choices and context authority

- Query: Resolve the remaining product choices under explicit user delegation
  and map the converged phone design to current code and honest test boundaries.
- Scope: internal planning/source audit, no product execution
- Date: 2026-10-30

## Decision Authority

- The user separately approved D1 (unscaled selected-node bottom editor) and D2
  (panel connection selection/modification/order, retain old connection on error).
- After the Move proposal, the user explicitly delegated subsequent choices to
  main and requested starting once prepared. Main therefore selected D3-D6 below.
  These are delegated selections, not fabricated individual confirmations.
- Existing task is reused. Current PRD, design.md and implement.md supersede
  alternatives/pending-choice language in earlier dated research. The user
  subsequently approved the latest final summary with "可以" on 2026-10-30;
  the fresh implementation authorization is recorded in the task's checks.
- Concurrent homepage UI work is user-approved and outside mobile ownership;
  planning targets this explicit path, not the foreign session-fallback task.

## Selected Choices And Trade-offs

| Decision | Selection | Evidence / Trade-off |
| --- | --- | --- |
| D1 | Explicit selected-node unscaled bottom editor; one authoritative input path. | Existing inspector outside Flow is reusable, scaled inputs are not touch-sized; extra open step is accepted. |
| D2 | Panel source selection, atomic replacement, disconnect and visible up/down order; desktop ports retained. | Existing controller connect/disconnect/reorder and shared validation are reusable; replacement needs one validated candidate, not destructive two-step publication. |
| D3 | iOS18+ Safari, Android12+ Chrome current/preceding stable major, >=360 CSS width; portrait/landscape/keyboard/safe areas. | Next16.2.4 installed modern compilation target includes Safari16.4/Chrome111, a lower build baseline, not physical proof. Versions/hardware must be recorded. In-app/older/sub360 is best-effort. |
| D4 | Core document actions, captured confirmed node/canvas deletion/reload, current node/provider/CAPTCHA settings; no advanced graph suite. | Reuse existing commands/dialogs and keep phone self-contained without new backend or undo/auto-layout scope. |
| D5 | Current-canvas references/results, including restored account-saved originals; no account-wide library. | Current scene IDs and READY/upload mappings suffice. There is no completed imported-assets discovery/general canonical-insertion UI; a library would broaden scope. |
| D6 | Browse pan/pinch, explicit selected-node Move/Done, whole-card drag with renderer-only unfinished preview. | Extra mode step avoids miniature headers and accidental browsing edits; real Flow two-finger/cancellation needs fresh browser/native verification. |

- Preserve exact M1-M4 and MA1-MA4 mappings and accepted account/document/run/
  reference/retention contracts. No mode copying, automatic execution, new scene
  grammar, provider/Worker/billing or production activation is selected.
- The primary representative test scene is 24 nodes/up to32 valid edges; add a
  200-node bounded smoke. Domain maximum remains 200 nodes/400 edges. Record
  actual timing observations; no FPS/latency or measured-capacity claim is made.
- Physical Safari/Android touch/native Chinese candidate UI, keyboard/chooser/
  download checks remain required for full target-device MA1/MA3/MA4 acceptance.
  Code and automated checks can finish with those portions explicitly pending,
  but that is not all-MA acceptance, archive or rollout permission.

## Design Contracts Tied To Current Source

- `src/components/create/hooks/use-studio-mode.ts:30` must separate presentation
  from mutation authorization. Existing owner controller lifetime at
  `src/components/create/hooks/use-canvas-documents.ts:27` and runtime manager at
  `src/components/create/hooks/use-canvas-runtime-lease.ts:185` remain mounted.
- `src/components/create/parts/canvas-stage.tsx:146` currently applies position
  changes directly to domain. Touch preview must be renderer-only until a valid
  completed drop, retaining actual measurement semantics, selected origin and
  existing desktop behavior. Cancelled preview is not a previously accepted edit.
- `src/components/create/canvas/commands.ts:70` already validates copied scenes
  through shared graph/schema after edits. Atomic replacement belongs here and
  in a captured controller method; don't fork validation or alter public wire.
- `src/components/create/parts/canvas-node-inspector.tsx:46` keeps unfinished
  field strings locally; lift only nonsecret UI draft ownership above the lazy
  renderer, reusing current fields/normalization. Stable responsive DOM plus
  source/compose guards preserve input; runtime credentials stay in their manager.
- `src/components/create/canvas/controller.ts:551` and
  `src/components/create/canvas/run-commands.ts:97` stay the Save/Run authority.
  Apply/validate pending UI parameters before those captures; never rewrite an
  accepted/frozen run, claim newer edits saved or trigger a request from layout.
- `src/components/create/hooks/use-canvas-image-viewer.ts:93` remains the
  captured-original download lease; share preview/input behavior rather than
  reuploading generated images or adding chat's Use For Edit action to canvas.

## Validation Tooling Inspection

- Planning confirmed existence of the pinned Node24.22.1 executable and existing
  `react-flow-spike/safe-run.mjs`, `safe-environment.mjs`, `deny-local-env.cjs`
  under the predecessor's named temporary root. This was file/source inspection,
  not a test/build/browser or service run.
- Inspected safe-run accepts `label mode timeoutMs cwd executable args...` and
  calls the repository command runner with independent deadlines and receipt
  logs. safeEnvironment allows OS variables, blanks service credentials, uses
  dummy localhost port1 for ordinary DB coordinates, denies repository dotenv,
  and distinguishes build APP_URL from ordinary tests.
- Reverify helper/runtime identities before execution. Copy original fresh
  command/source/browser receipts to this task's checks. If missing, prepare an
  equivalently isolated owned helper rather than using real dotenv/endpoints.
- No Docker/start/pull, actual DB/S3/provider, application/browser, physical
  phone, native IME or actual CI was executed during planning. Context validation
  and preservation hashes must never be reported as application acceptance.

## Related Specs And Context Priority

- Current PRD/design/implement are automatically loaded artifacts, not JSONL
  replacement content. Context manifests contain real spec/research entries only.
- Canvas frontend/operations contracts remain central; the intentional phone
  read-only replacement is explicit in PRD/design. Initial unsafe/phone-read-only
  fixtures need deliberate test revision, not removal of true disabled guards.
- Component/hook/state/type/quality/directory guides govern new feature files;
  cross-layer/reuse guides prevent another scene/job store and copied field lists.
- Independent check must review all changed responsibilities and evidence
  labels/source applicability. Main owns spec sync and no-commit handoff, not a
  blind acceptance inheritance from archived predecessor receipts.

## Caveats / Not Found

- Native phone event ordering, visualViewport/candidate layout, downloader and
  actual device performance are not established by source or jsdom/CDP tests.
  Pending physical acceptance stays visible and cannot be waived silently.
- No blocking product question remains under delegation. Failure to meet chosen
  behavior or new backend/library/dependency scope requires review, not an
  undocumented smaller MVP. Final activation approval is now recorded; physical
  acceptance remains pending and is not implied by implementation permission.
