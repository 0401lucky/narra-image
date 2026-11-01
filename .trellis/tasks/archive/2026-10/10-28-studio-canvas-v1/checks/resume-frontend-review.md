# Resume Frontend Review - 2026-10-30

Active task: `.trellis/tasks/10-28-studio-canvas-v1`.

Independent `trellis-check` review of the existing task, not a new plan or a
release-acceptance claim. The saved hook, PRD/design/implementation plan,
frontend specs, parent frontend/persistence contracts, and checked history
handoff were read. Existing dirty changes and the archived history patch were
preserved; no staging, commit, deployment, database/provider operation, or
mobile-editor activation was performed.

## Reviewed Scope

Traced `/create` scoped bootstrap through the mounted studio, account/source
epochs, conversation pagination, canonical cache/poller, captured Save/Run,
IndexedDB envelopes/blobs/CAS, reference upload/preview leases, terminal output
suppression, and the real controlled React Flow adapter/cards/inspector.
Reviewed the late lazy-failure behavior without changing it: renderer retry is
available, while cached chunk rejection has honest manual-refresh guidance and
return-to-chat without automatic reload or submission.

This covers the frontend paths for CA1-CA10 and CA12. Server/domain/SQL/Worker
review belongs to the backend peer; final build/browser/infrastructure evidence
belongs to the coordinator. Shared graph/DTO/API boundaries were read to verify
the frontend's actual contract, not independently reimplemented.

Production edits in this review are limited to:

- `src/components/create/canvas/controller.ts`
- `src/components/create/canvas/commands.ts`
- `src/components/create/canvas/client-api.ts`
- `src/components/create/constants.ts`
- `src/components/create/hooks/use-conversation-generations.ts`

Added 15 regressions across `canvas-controller-runs.test.ts` (+10),
`canvas-controller-documents.test.ts` (+2), and
`use-conversation-generations.test.tsx` (+3), all under `src/tests/unit/`.
Production edits were announced before writing, then frozen before the final
cross-layer checks. The subsequent TS2367 correction changes only a test's
equivalent expected-count expression.

## Findings (fixed)

### 1. Deleted Local Draft Could Reappear And Materialize Results

- File: `src/components/create/canvas/controller.ts:471`.
- Issue: After an acknowledged account Delete and failed local tombstone write,
  reload restored the old local scene. An owned `CANVAS_DELETED` read was merely
  displayed as an error; the still-live entry then recovered its terminal outbox
  and recreated result organization. An uncertain shell had no account read at
  all. This violated the deletion/reload/source-attachment boundary.
- Fix: Reuse `acknowledgeDeletion` for explicit Delete and the owner's exact
  tombstone response. Close attachment before recovery, clear only that local
  organization, and attempt the native-store tombstone under the existing CAS.
  Do not force a newer writer's stamp, cancel jobs, refund, or delete media.
  Registered and uncertain shells are checked; unknown/404/5xx/transport failures
  preserve the draft/outbox. A late old-canvas response cannot clear a newer
  selection. Reconciliation also works in phone read-only mode.
- Evidence: `resume-front-regressions-red-01` reproduces both quota and conflict
  resurrection cases. Final coverage also checks unavailable-read negatives,
  continued CAS failure, uncertain shell recovery, and selection isolation.

### 2. Multi-Run Cloud Hydration Could Omit Earlier Terminal Batches

- Files: `src/components/create/canvas/controller.ts:380`,
  `src/components/create/canvas/commands.ts:164`.
- Issue: A new device with two accepted, unhandled run bindings has no local
  outbox counts. When terminal A was processed before B entered the canonical
  cache, capacity checks rejected A. B then materialized, but A was not
  retried after the count became known. A saved count-2/count-1 scene restored
  only the latter image. The same capacity check also blocked closing a failed
  zero-addition run when an unrelated sibling count was unknown.
- Fix: After bounded hydration, reconcile only current scene-bound canonical
  bindings, using the same helper as outbox recovery. Clear a previous run error
  after successful reconciliation. Capacity checks still guard actual output
  additions, but a failed/already-present zero-addition batch can durably mark
  `outputsHandled`. Unknown counts remain conservative; pending siblings retain
  their original reservation. No graph execution, all-runs enumeration, status
  regression, or generation POST is introduced.
- Evidence: `resume-front-hydration-red-01` reproduces the missing two-image
  batch; `resume-front-capacity-red-01` reproduces blocked failed-run handling.
  Green tests cover all three outputs, once-only refresh, pending/missing
  siblings, and continued rejection of capacity-consuming edits when unknown.

### 3. Scoped Conversation Reads Could Stay Loading Forever

- Files: `src/components/create/hooks/use-conversation-generations.ts:179`,
  `src/components/create/constants.ts:55`,
  `src/components/create/canvas/client-api.ts:38`.
- Issue: A stalled fetch or body parser retained the request/loading guard
  indefinitely. Ignoring abort also left the abandoned command unresolved.
  Older-page users had no error/retry state even though the page never arrived.
- Fix: Reuse a shared 30-second studio request deadline and the existing
  abort-plus-Promise-race convention. Bound fetch and JSON together, settle
  obsolete requests, and guard all late continuations by request/selection/
  mount identity plus abort state. Timeout preserves loaded content and retries
  the captured older cursor rather than rewinding to page one. Timers/listeners
  are released in all outcomes. Canvas upload/submit deadlines are unchanged.
- Evidence: `resume-front-regressions-red-01` reproduces stalled fetch, stalled
  JSON, and ignored-abort settlement failures; all three pass after the fix.

## Findings (not fixed)

No remaining reproduced code defect in the assigned frontend scope.

CA11 and the infrastructure portion of CA13 are not established by frontend
unit tests or fake-HTTP browser fixtures. The coordinator owns final isolated
DB/migration/GC/topology/readiness/build receipts. Real authenticated account,
provider/storage, physical-phone touch, and OS-native IME acceptance remain
separate verification boundaries. This report does not mark the whole task
complete or authorize enabling/deploying it.

## Verification

Final checks run after both frontend and backend source freezes:

| Check | Command | Result | Receipt |
| --- | --- | --- | --- |
| TypeCheck | `pnpm exec tsc --noEmit --incremental false` | Pass, exit 0, 30.561s | `resume-front-final-types-02` |
| Lint | `pnpm lint` | Pass, exit 0, 0 errors / 9 existing unrelated warnings, 32.294s | `resume-front-final-lint-02` |
| Full non-DB tests | `pnpm exec vitest run --testTimeout=30000 --exclude '**/worker-contracts-db.test.ts' --exclude '**/canvas-contracts-db.test.ts'` | Pass, 118 files / 1339 tests; Vitest 32.52s, wrapper 33.482s | `resume-front-final-full-02` |
| Focused frontend tests | Exact 12-suite command below | Pass, 12 files / 262 tests; Vitest 12.01s, wrapper 13.096s | `resume-front-regressions-green-02` |
| Whitespace | `git diff --check -- src/components/create src/tests/unit src/app/create/page.tsx src/app/globals.css` | Pass | reviewer command transcript |

The 9 lint warnings are in unchanged migration helpers, marketing mobile nav,
and `my-works-board.test.tsx`; none is in this review's production/test edits.

```powershell
pnpm exec vitest run src/tests/unit/canvas-controller-runs.test.ts src/tests/unit/canvas-controller-documents.test.ts src/tests/unit/canvas-client-api.test.ts src/tests/unit/canvas-terminal-placement.test.ts src/tests/unit/canvas-stage.test.tsx src/tests/unit/generator-studio-canvas.test.tsx src/tests/unit/generator-studio-origins.test.tsx src/tests/unit/generator-studio-conversations.test.tsx src/tests/unit/use-conversation-generations.test.tsx src/tests/unit/use-canvas-documents.test.tsx src/tests/unit/use-image-poller.test.tsx src/tests/unit/use-studio-jobs.test.tsx --testTimeout=30000
```

All commands use the coordinator's verified Node 24.22.1 and isolated wrapper:

```powershell
& 'C:/Users/Administrator/AppData/Local/Temp/narra-history-cleanup-20261029/node-v24.22.1-win-x64/node.exe' 'C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea/react-flow-spike/safe-run.mjs' LABEL test TIMEOUT_MS 'E:/code/narra-image' pnpm ...
```

Deadlines: focused tests 90000ms, types 120000ms, lint 180000ms, full suite
300000ms. Test mode isolates PATH/config, blocks repository `.env`, supplies only
dummy localhost-port-1 DB coordinates, and does not inherit build-only APP_URL.
No DB sentinel suite, browser/build process, real generation, or storage request
was run by this reviewer.

Exact argv, exit code, timing, and raw stdout/stderr for each label are retained
as `LABEL.json`, `LABEL.stdout.log`, and `LABEL.stderr.log` under:

`C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea/react-flow-spike/logs/`

### Red/Green History

| Receipt | Actual Outcome |
| --- | --- |
| `resume-front-initial-types-01` / `resume-front-initial-lint-01` | Baseline types pass; lint 0 errors / 9 warnings. |
| `resume-front-initial-full-01` | Baseline 117 files / 1307 tests pass. |
| `resume-front-regressions-red-01` | 2 files: 5 intended failures / 55 pass (deleted organization x2; fetch/JSON/abort x3). |
| `resume-front-regressions-green-01` | 6 files / 130 tests pass after deletion/deadline fixes. |
| `resume-front-hydration-red-01` | 2 files: 1 intended failure / 67 pass (earlier terminal batch omitted). |
| `resume-front-capacity-red-01` | 1 file: 1 intended failure / 36 pass (zero-addition failed binding blocked). |
| `resume-front-regressions-green-02` | 12 files / 262 tests pass after all production fixes. |
| `resume-front-final-types-01` | Failed on the new test's redundant narrowed-status comparison and backend-owned env/test annotations; no production type failure. Both owners corrected their own files without disabling checks. |
| `resume-front-final-lint-01` / `resume-front-final-full-01` | Lint pass; 118 files / 1339 tests pass before the annotation-only corrections. |
| `resume-front-final-types-02` / `resume-front-final-lint-02` / `resume-front-final-full-02` | Final frozen-source checks all pass; authoritative receipts in the table above. |

## Spec And Integration Handoff

The coordinator owns spec/task documents. Sent exact sync notes for owned
tombstone recovery versus unavailable reads, post-hydration scene-only terminal
reconciliation, zero-addition handling, and scoped conversation deadlines.
Do not reset suppression, infer missing-job failure, force a writer stamp, or
remove the existing lazy chunk warning in subsequent integration.

The coordinator's pre-fix `resume-browser-01` was reported as 12 passing real
Next/Chrome fixture groups, including cached chunk failure/manual F5 recovery.
It is a checkpoint, not proof of these new fixes. The refreshed 14-group fixture
and production build remain coordinator-owned gates at this report's handoff;
the planned fixture includes native stale draft/tombstone, exact-byte download,
and new-device 2+1 terminal-batch cases.
