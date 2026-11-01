# Dual-mode studio execution and integration plan

## Activation Gate

- Current phase: final integration accepted and parent archived on 2026-10-30;
  archive and journal used `--no-commit`. Final preservation is recorded separately.
  Both v1 children are completed and archived; their uncommitted code is the
  baseline. The user explicitly approved the latest final summary in the next
  message; no scope or product contract changed after that approval.
- Read the existing parent artifacts, both archived verification/handoff pairs,
  canvas final infrastructure review/receipts, and current canvas/quality specs.
  Product decisions are unchanged; do not recreate a task or repeat requirements
  discovery. The dated records below preserve historical child checkpoints.
- Review of `research/final-integration-closeout-2026-10-30.md`, this plan and
  curated implement/check contexts is complete (27 implement / 21 check entries).
  The planning phase made only task-artifact and read-only inspection changes.
- The subsequent explicit approval authorizes `task.py start` for this parent's
  direct acceptance work. Neither archived child nor mobile is started.
- `checks/final-integration-2026-10-30/source-baseline.json` preserves HEAD/index,
  192 unchanged source identities and all 277 archived-child artifact hashes
  before the approved work. Main owns planning, evidence and final handoff;
  the implementer initially owns only the existing canvas DB regression file.

## Ordered Final Integration

1. After approval, record HEAD/index and a source-hash baseline without reading
   real dotenv files; recheck the prior evidence against the current tree.
   Preserve all existing code, archived tasks and unrelated changes. Stop on
   unexpected concurrent edits. Activate only the existing integration parent.
2. Build parent `verification.md` with one row per AC1-AC17: exact source/test
   anchors, child criteria/receipts, environment, current applicability,
   remaining gap and eventual verdict. Do not equate earlier checked research
   ACs or child archival with final parent acceptance.
3. Dispatch `trellis-implement` for the missing cross-child DB regression only:
   old conversation pagination amid newer canvas/orphan jobs; real conversation
   deletion and canvas-organization deletion followed by owner works retrieval,
   with retained canonical jobs/images and unchanged cancellation/refund/credits.
   Prefer extending the existing sentinelled canvas DB target; no new pipeline,
   schema or provider calls. Assign exact test-file ownership. If it identifies
   a product defect, record evidence and the minimal affected files before a
   scoped fix; re-review any material contract/scope change with the user.
4. Run fresh focused studio regressions, the augmented isolated canvas DB wrapper,
   lint, types, whitespace and task-context checks. Preserve actual command
   receipts and cleanup results. Reuse unchanged full-suite/build/Worker DB/
   migration/runtime/browser gates under the impact rules below.
5. Dispatch a separate `trellis-check` for the entire parent contract surface,
   not only the new tests. Verify AC6-AC9, AC11-AC15 and AC17 across child
   boundaries, including old chat compatibility, account/local isolation,
   reference recovery, deleted organization, phone read-only and seven-day GC.
   Any fixes require relevant retesting and an independent final re-review.
6. Main reconciles every AC verdict and manual residual, performs the spec-sync
   judgment, and writes final `verification.md`/`handoff.md`. Update the mobile
   PRD/task dependency notes with verified contract/evidence and parent archive
   pointers, keeping its planning/deferred status and future review gate.
7. Only if every in-scope AC and required gate is satisfied, perform parent-only
   `task.py archive <parent> --no-commit`. Check resolved source/destination stay
   under the task root, destination is absent, and hooks cannot commit/deploy.
   Update live context/archive references and verify moved artifact hashes plus
   unchanged HEAD/index/product patch. Journal only with `--no-commit`; never
   stage, commit, push, deploy, enable canvas, archive mobile, or clean user work.

## Cross-Child Acceptance Checklist

- [x] History child HA1-HA4 and frontend quality gate pass before canvas implementation.
- [x] Parent AC1-AC5/AC10: original research, decisions, planning boundary and
  cost evidence remain accurate as historical records; latest approval recorded.
- [x] Parent AC6-AC9: connected actual inputs, stable results, manual node runs,
  no implicit execution/copying or global-history fallback.
- [x] Parent AC11/AC13: local draft durability, honest save/conflict states,
  account isolation, cross-device reference restore/reuse without new generation.
- [x] Parent AC12/AC14: no desktop/phone history, retained works/jobs/images,
  no deletion-induced cancel/refund/resurrection, existing chat actions preserved.
- [x] Parent AC15: desktop core editor and usable phone read-only canvas/chat.
- [x] Parent AC17: seven-day new-import-only cleanup, immutable roots/fencing,
  expiry recovery, bounded scheduling, no generated/legacy or real-object sweep.
- [x] Node/Go/runtime/schema rollout compatibility and safe rollback are verified.
- [x] Parent AC16: mobile remains independent/deferred with verified v1 and
  completed parent-integration prerequisites; no phone editing is started.

## Current Closeout Progress

- [x] Fresh final-summary approval recorded; existing parent activated only.
- [x] Pre-execution HEAD/index/source/archived-child baseline preserved.
- [x] Parent `verification.md` maps every AC to current source and layered
  evidence; final verdicts now reconcile the positive SQL and independent review.
- [x] Main focused studio/chat check: 7 files / 124 tests, exit 0;
  `parent-integration-studio-01` receipt and logs copied into parent checks.
- [x] Implementer adds five narrow SQL cases in the existing sentinelled file;
  its fresh lint/types pass without product/config edits.
- [x] Execute the full/additive SQL seams: recovered `parent-db-contracts-04`
  passes 37 full + 37 additive cases with exact owned cleanup in 26.780s.
  The three earlier Docker preflight failures are retained, not current blockers.
- [x] Independent fresh lint/types and focused studio 7-file/124-test checks pass
  on the same frozen source (`parent-review-*-01`).
- [x] Continuation reviewer repeats isolated lint/types/studio successfully:
  `parent-final-review-*-01`, same frozen source, 7 files / 124 tests and
  0 lint errors / 9 existing warnings; final full-AC reconciliation passes.
- [x] Independent whole-parent final review and required SQL/affected rechecks:
  `checks/integration-sql-final-review.md`, no unresolved required finding.
- [x] Final AC verdicts, spec-sync judgment, handoff and mobile dependency notes.
- [x] Parent-only no-commit archive/journal and exact preservation audit
  (`checks/final-integration-2026-10-30/archive-audit.json`).

The completed acceptance uses the recorded local/emulated-device evidence and
source-matching child infrastructure/browser results. It is not physical-phone,
native-OS-IME, paid-provider/real-S3, actual-CI or production-rollout acceptance.
The two canvas specs now name the real pagination/deletion-to-works regressions;
no product contract, source, dependency or schema changes were needed here.

## Validation Scope

All application commands below are payloads for the audited isolated wrapper,
not permission to inherit the user's environment. Reuse the verified Node
24.22.1/pnpm 10.32.1/Go 1.25.14 setup when still valid; tests block real `.env`,
use dummy localhost port 1 outside the DB runner, blank real provider/storage
credentials, and set build-only APP_URL only for build. Every stage has its own
deadline. Any new resource must have verified local owner/sentinel and exact
bounded cleanup; never auto-pull, use real services or widen Docker networking.

Fresh checks for the planned test/document-only change:

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vitest run src/tests/unit/generator-studio-session-history.test.tsx src/tests/unit/generator-studio-conversations.test.tsx src/tests/unit/generator-studio-origins.test.tsx src/tests/unit/generator-studio-canvas.test.tsx src/tests/unit/conversation-generations-api.test.ts src/tests/unit/create-page-conversations.test.tsx src/tests/unit/use-conversation-generations.test.tsx --testTimeout=30000
pnpm verify:canvas-contracts:db
git diff --check
python .trellis/scripts/task.py validate .trellis/tasks/archive/2026-10/10-28-studio-dual-mode-canvas
```

Evidence-reuse and invalidation rules:

- Source-matching final 120-file/1386-test ordinary suite, build, Worker TS/Go/DB,
  five migration groups, nine runtime scenarios and fourteen browser groups
  remain candidate evidence. Record each gate's receipt and applicability; do
  not mechanically rerun all wrappers or turn a missing prerequisite into green.
- Only tests/docs changed: run the fresh checks above and reuse unaffected
  production gates. The changed DB test must run through its wrapper for both
  full and additive histories; previous 64-case evidence alone cannot cover it.
- Any product-code/dependency change: rerun relevant tests plus full ordinary
  suite, lint/types and production build on the final tree. Renderer/controller
  changes also require affected real browser groups, not jsdom-only acceptance.
- SQL/schema/retention/Worker changes invalidate corresponding real DB/Worker/
  migration/GC checks. Runtime/readiness/storage/harness changes require affected
  enabled/off/mismatch topology scenarios and exact resource cleanup. Run the
  entire existing wrapper if it has no supported narrower safe entry.
- A final independent full-scope review is mandatory even when execution receipts
  are reused. Any required failure or unverified changed surface blocks archive;
  physical phone/OS IME/real service/deployment residuals remain labelled instead
  of being executed without authorization or silently marked passed.

## Before Any Implementation Dispatch

- Recheck current git/workspace state and activated parent's artifacts/context.
  Stop immediately on unexpected changes; preserve existing/other-agent edits.
- Use `Active task: <parent path from task.py current>` first in every dispatch.
  Main owns planning/spec/integration/closeout; implement/check agents own their
  explicit files/review scope. State that they are not alone, must preserve other
  edits, and must not spawn nested implement/check agents, start mobile, commit,
  read real dotenv, contact real services or clean unrelated resources.
- Research reports are losslessly split below the per-file injection limit.
  Total-budget index fallbacks still require explicit relevant source reads;
  do not confuse a registered context path with fully inlined evidence.
- Re-review material contract/scope changes with the user before executing them.
- Do not install a canvas library, run a spike/build/test, alter schema/storage,
  or dispatch implementation while the final planning approval is pending.

## Planning-Only Record

During planning, only task artifact/path/JSONL validation was performed.
Application quality and disposable DB/Go/browser tests were future checks at
that checkpoint, not work already performed in that phase. Deployment and real
storage probes remain unauthorized throughout the approved closeout.

Pre-execution read-only evidence applicability and concrete gaps are in
`research/final-integration-closeout-2026-10-30.md` and its audit JSON. Parent
acceptance and archive now depend on the approved execution and final checks,
not another product-planning round. Preserve this dated planning-only record
separately from new command receipts.

## Historical Child Execution Records

The dated checkpoints below describe the original delivery sequence. Earlier
unmet infrastructure entries are superseded by the final verified handoff, not
new blockers or instructions to restart an archived child.

## History-Only Execution Record: 2026-10-29

- The user confirmed the preceding final plan/order and authorized only the
  first history child. This integration parent was not activated; canvas/mobile
  remain planning and need explicit next-stage authorization.
- History implementation and independent `trellis-check` pass, including
  targeted tests, lint/types, 79-file/411-test non-DB suite, production build,
  scope/diff checks, and isolated client-fixture layout/interaction checks.
- `.trellis/tasks/archive/2026-10/10-28-studio-history-cleanup/verification.md` separates those
  actual results from unperformed authenticated/hydration/live DB/storage checks.
  `handoff.md` gives the unchanged shared-query/drop/action boundaries.
- The user subsequently requested the completed history child's archive only;
  `task.py archive --no-commit` moved its artifacts under `archive/2026-10`.
  History code remains uncommitted. No canvas activation, commit, deployment,
  feature, or dependency was authorized or added in this session.

## Canvas Continuation Checkpoint: 2026-10-30

- Subsequent user approval activated only `10-28-studio-canvas-v1`, and the user
  now explicitly resumes that same child. This parent remains planning and is
  not a concurrent implementation target; full mobile editing remains deferred.
- Canvas code and fresh independent frontend/backend source checks pass after
  recovery/SQLSTATE/runner-safety fixes. Final non-DB suite: 118 files/1339 tests;
  types/lint/build and Node/Go ordinary checks pass. Actual production Next/
  native-IDB/fake-HTTP browser fixture passes 14 groups; five Compose dry configs
  pass. These give bounded evidence for AC6-AC9 and AC11-AC15, not live release
  acceptance.
- AC17 and infrastructure-sensitive parts of AC11/AC13 remain open: real
  PostgreSQL migrations/catalogue/locks/GC concurrency and enabled app/Worker
  topologies did not run because guarded local preflights timed out or found
  missing images. No image pull, real database/storage operation or deployment.
- Current source contracts, exact evidence and safe next steps are in the
  child's `verification.md`, `checks/resume-2026-10-30/` and `handoff.md`.
  Do not mark the parent checklist complete, archive either task or start mobile
  implementation from a passing fake-HTTP browser check.

## Canvas Verified Handoff: 2026-10-30

- The user then explicitly requested completing all missing tests before
  archiving the canvas child. Positive DB/worker/migration and all nine actual
  runtime cases now pass, including both enabled authenticated API/SSR and
  managedGC failure/retry/retention checks. Final120files1386tests/types/lint/
  build and independent full-scope review pass; required child CA1-CA13 are met.
- Child evidence and verified contract handoff move to
  `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/verification.md` and
  `.trellis/tasks/archive/2026-10/10-28-studio-canvas-v1/handoff.md`.
  Physical phone/OSIME and paid-provider/realS3/deployment remain explicitly
  unperformed; actual backend API/runtime and browser fixture evidence are
  separate, not relabeled as one login-to-provider E2E test.
- Archive is child-only and `--no-commit`. Parent integration remains planning;
  its source acceptance checklist awaits separate final integration/closure,
  not automatic activation or a deployment. Mobile stays independent/deferred.
