# Implementation Plan: Warm Editorial Homepage

- Status: User approved the complete plan on 2026-10-31; implementation is in progress.
- Current continuation: the user approved the gallery-only long-URL fallback and delivery of this plus prior tasks to GitHub `main`. Fresh pinned-runtime gates pass; final browser/sign-off and Git delivery remain. Earlier image/native-hit/reveal continuations below are historical input revisions, not substitutes for these gates.
- Earlier asset recovery: the original session's transport HTTP 413 interrupted delivery after successful generation. Three selected original PNGs and actual dimensions are published; see `checks/resume-20261031.md`.
- Asset follow-up: user now explicitly authorizes the named external API/model with required request headers for three fixed illustrations. No site provider changes, live product data access, unrelated model fallback or long-URL scope approval is implied. Key-free API evidence: `checks/assets/provider-contract.json`.
- Authority: `prd.md` + `design.md`; this checklist is ordered and repeatable where checks uncover defects.
- Context: `implement.jsonl` / `check.jsonl` list only real spec/research files. They do not replace this plan.

## Approved Follow-Up: Long URL And Git Delivery

The user replies `可以增加` to the bounded complete-copy/manual-paste proposal,
then explicitly requests committing this and previous uncommitted tasks and
pushing GitHub `main`. This supersedes historical no-commit/no-push notes;
it does not authorize force push, production deployment or service access.

- [x] Capture `checks/long-url-20261101-source-baseline.json`: all 807 inputs
  still match the 1633-test/88-browser revision. Preserve prior task records.
- [x] Persist the approved R4/AC10 amendment and concrete 8192-byte entry
  contract in PRD/design before editing source.
- [x] Implement only gallery-local URL budget/manual instructions and tests.
  Prove new semantic failures before the fix; preserve ordinary/guest/permission
  and full-copy behavior, no create/auth/draft changes.
- [x] Independently review source/contracts, update browser fixture/controls
  for the approved fallback, and run focused then full browser validation.
- [x] Freeze source and rerun full non-DB tests, lint, types, offline Prisma
  and unmodified production build. Pinned Node 24.22.1, 809 inputs, 140 files /
  1704 tests; metadata-inclusive lint has zero errors and nine baseline warnings.
  Evidence: `checks/validation-evidence/long-url-final-bounded/result.json`.
  Parallel-worker OOM attempts remain failed; no tests are skipped or changed.
- [x] Independently audit earlier uncommitted task scopes and retained evidence:
  `checks/git-delivery-prior-tasks.md`; no unrecognized source family remains.
- [x] Finish staged credential/temp/large-file/whitespace checks and recheck
  remote `main` divergence. The delivery plan preserves original evidence bytes.
- [x] Update specs/acceptance/handoff; group coherent work commits followed by
  Trellis bookkeeping, then push normal fast-forward commits to `origin main`.
  Stop and report conflicts/push protection rather than forcing or overwriting.

The implementer owns gallery-card/constants and focused source tests. The
checker owns browser helpers/evidence and an independent final report. The
coordinator owns plans/specs, production gates, commit selection and Git writes.
All production commands retain the sanitized isolated-lane safety contract.

## Final Delivery Normalization

The pre-staging audit found one extra final LF in each of
`THIRD_PARTY_NOTICES.md` and
`src/components/create/canvas/controller-types.ts`. After the unfiltered
103/103 browser run completed, the implementer removed exactly those two
bytes; `checks/validation-evidence/git-delivery-whitespace/` proves all other
bytes unchanged. Original OFLs and `.before` evidence remain byte-exact,
with narrowly scoped Git whitespace attributes rather than source exemptions.
Downloaded third-party HTML stays local and is excluded from delivery.

This creates a new exact source revision despite having no semantic change.
Fresh five-stage gates pass in
`checks/validation-evidence/git-delivery-final/`; the checker has rebound,
built and rerun the unfiltered browser matrix on these final 809 inputs.
Neither the previous 1704-test run nor the completed 103-check run is silently
relabelled as verification of the normalized bytes.

Final rebind/build and unfiltered browser are now complete:
`checks/browser/evidence/full-1793502794542/result.json`, 103/103,
wrapper `20261101T031314-script-5cadc5`, exit 0, 326.492s / 900s.
Final independent delivery report: `checks/git-delivery-independent-review.md`.

## Historical Pre-Fallback Verdict: 2026-11-01

This section records the previous reveal revision. The approved follow-up
above supersedes its pending approval and no-commit/no-push statements. These
receipts remain historical evidence, not acceptance of the fallback revision.

- [x] Publish/inspect the three accepted original images and verify all-scene
  decode, 639/640px composition and native mouse/touch/keyboard full-prompt copy.
- [x] Calibrate/fix the keyboard modifier and exact-fraction hover helpers,
  retaining ordinary-control positive/negative cases and old red receipts.
- [x] Prove the separate reveal-cleanup race with native mutation evidence and
  five real-Motion regression failures; apply guarded scalar progress, keeping
  original timing and one-shot behavior. All seven new regressions pass.
- [x] Freeze all 807 inputs and freshly pass 138 files / 1633 non-DB tests,
  lint (0 errors / 9 baseline warnings), types, offline installed Prisma and
  an unmodified production Next build. `checks/validation-evidence/reveal-final/`.
- [x] Run the unfiltered actual-Next/synthetic-DB browser matrix: 88/88 pass,
  including 43 privacy checks and new native interruption/cascade coverage.
  `checks/browser/evidence/full-1793496819932/`.
- [x] Coordinator verifies final source/helper/fixture/build hashes, wrapper
  exit 0, no owned processes/locks and actual desktop/phone/reference images;
  updates executable specs and acceptance/handoff records.
- [ ] Complete the independent final report/sign-off. Reviewers confirmed the
  new source/helper patch, but provider quota interrupted final reporting;
  coordinator verification does not substitute an independent signature.
- [ ] Obtain the user's decision on oversized Unicode URL manual-copy fallback.
  The two HTTP 431 cases remain separate from the 88 executable passes.

No staging, commit, push, archive or deployment is authorized. G0-G5 and
executable G6 pass within the documented local/synthetic scope; AC3/AC10,
independent final sign-off and runtime/live-service limits remain open. Use
`checks/final-continuation-review.md` and `checks/acceptance-status.md` for the
current evidence rather than restarting completed historical steps.

## 0. Approval And Workspace Gate

- [x] Present the final planning summary, then wait for a subsequent explicit user approval. The user explicitly approved the complete proposal on 2026-10-31.
- [x] Recheck the existing task directory, `task.json`, scoped git status and relevant source. Preserve the mobile-canvas work and all other uncommitted edits; source baseline is in `checks/implementation-baseline.json`.
- [x] Validate the context manifests, then activate this existing task with `task.py start` in this session only. Both manifests passed; only this session's pointer was set.
- [x] Load Phase 2.1 and dispatch `trellis-implement` with the active task first line, explicit non-overlapping ownership and no-revert/no-live-credentials boundaries.
- [x] Implementers read `trellis-before-dev` / applicable specs after activation, before editing.

Current planning validation uses:

```powershell
python ./.trellis/scripts/task.py validate .trellis/tasks/10-30-homepage-warm-editorial-redesign
```

The activation command completed after explicit user approval in the implementation session:

```powershell
python ./.trellis/scripts/task.py start .trellis/tasks/10-30-homepage-warm-editorial-redesign
```

## 1. Baseline And Safe Check Environment

Owner: implementer for task-owned check utilities; coordinator for permissions and scope. No production runner/config ownership is granted.

- [x] Record source identities and scoped baselines, including the existing dirty worktree and lint warnings.
- [x] Probe installed Node and Chrome/Edge only; no live credentials, personal browser profiles or another task's server used.
- [x] Prepare owner-marked, credential-free source snapshots under this task's `checks/.runtime/`, including only the verified public `.env.example`.
- [x] Sanitize the initial Node environment and children; keep build-only `APP_URL` out of tests and use distinct lane outputs.
- [x] Physically copy installed dependencies and retarget/audit 2,342 internal junctions; isolate generated Prisma, `.next` and incremental outputs.
- [x] Add a task-owned launcher/preload and seven passing safety tests for the public-example exception, sync/async/child handling, deadlines/exit codes and cleanup. No production guards changed.

Gate G0: passed on 2026-10-31. Eight final safety self-tests pass; source, copied dependencies and generated outputs are isolated. A custom-promisification defect exposed by actual Prisma generate was fixed in the task preload, with red/green receipts and no relaxed dotenv rules. Details: `checks/validation-environment.md`, `checks/validation-evidence/prisma-runner/`. Available Node is 24.11.1, not pinned 24.22.1; runtime parity remains unverified.

## 2. Public DTO And Detail Privacy First

Primary files: `src/lib/prisma-mappers.ts`, `src/app/works/[id]/page.tsx`, `src/components/works/work-detail-panel.tsx`, and focused tests. `src/lib/validators.ts` may gain narrow response schemas later. Existing `src/lib/server/works.ts` query/policy behavior is preserved.

- [x] Write failing coverage with prompt/review sentinels and the actual async page/client props. Pre-fix snapshot: 16 expected failures, 33 passes.
- [x] Add the allowlisted non-owner projection and discriminated owner/public props; redaction occurs before the client boundary.
- [x] Preserve author management, access gates, admin and video fallback; prove non-mutating public projection.
- [x] Add and test explicit featured `showPromptPublic`, including a genuinely public prompt equal to the old placeholder.
- [x] Test Home initial and API public contracts. Client fail-closed handling for old cached flags is verified in the gallery slice, not claimed by server-only coverage.

Gate G1: passed on 2026-10-31, 10 suites / 99 tests, exit 0 and no stderr; lint/types also pass. See `checks/privacy-contract.md` and separate red/green receipts. AC12-AC13 raw HTML/RSC checks remain in G6; these unit tests do not complete browser acceptance.

## 3. Final Assets And Isolated Visual Foundation

Primary files: `public/marketing/home/**`, `src/components/marketing/homepage/**`, relevant notice additions. Coordinator owns built-in image-tool execution if it cannot be delegated safely.

- [x] Generate three separate fixed bitmap scenes through the user-authorized external image API after the built-in tool failed: bookshop shafts of light, lantern-carrying fox and rainy Jiangnan lane. The successful requests were recovered from the interrupted source session; no new request is needed.
- [x] Inspect each actual output and copy the selected original files with versioned names. `checks/assets/image-manifest.json` records source, prompt, actual 1448x1086 dimensions, hashes and illustrative status. Rain candidate v1 is rejected; v2 is published without pixel edits.
- [x] Fetch and publish all 115 official font files, preserving CSS weight/style/Unicode ranges, unmodified binaries and three licenses with unique homepage-only aliases.
- [x] Add scoped tokens/background/typography and semantic section geometry; root/global CSS stays unchanged, underline/grain/framing use code-native assets.
- [x] Bind local production asset URLs and actual 1448x1086 image dimensions; real-file contract and all three rendered DOM dimension assertions pass. Font delivery and supported optimizer configuration remain unchanged. Browser layout/image-success checks are tracked separately in G6.

Gate G2 / AC1, AC7: IMAGE INPUTS RECOVERED; final delivery checks pending. After the two historical 503 attempts, the user repaired the external account-pool proxy and the same authorized model generated bookshop, fox and two rain candidates successfully. The continuation selected and published bookshop v1, fox v1 and rain v2. Exact prompts, key-free receipts and publication hashes: `checks/assets/`. The 115 official WOFF2 binaries and licenses remain unchanged. Constants, actual asset tests and fresh browser acceptance must pass before this gate is complete.

## 4. Header, Hero, Capabilities And Footer

Primary files: home entry, existing marketing header components and new homepage components/hooks. Do not edit the create workspace to support these visuals.

- [x] Add explicit `default` / `home` variants while preserving real account operations and default route rendering; narrower screens use a complete drawer.
- [x] Implement the home portal, focus trap/return, Escape, resize and scroll/inert restoration; default-route browser baselines remain unchanged.
- [x] Implement semantic title, embedded counters and independent fixed-scene constants/component. Actual locally served bitmaps are still blocked in G2.
- [x] Implement bounded tilt/dust, atomic latest-request scene/typewriter/copy logic, retry and coherent image failures. Controlled success tests are not final-image acceptance.
- [x] Implement four distinct capability miniatures and spotlight; the API example uses the actual endpoint and no real mutation.
- [x] Implement reveals/cascade, pause/reduced/hidden/offscreen/unmount cleanup with no new animation/store dependency.
- [x] Add real-route/footer/section anchors and remove annotations, banner and unsupported destinations.

Gate G3: targeted hero/header/footer/motion tests and executable browser controls pass; actual successful-image effects and final reference fidelity remain blocked by G2. Four capability demos do not issue fake business mutations. Details: `checks/homepage-visual.md`, `checks/browser-acceptance.md`.

## 5. Live Gallery Presentation And Actions

Primary files: existing `featured-gallery.tsx`, feature-local card/paging/copy hooks, optional narrow validators and gallery tests.

- [x] Keep the actual featured type/API, 16-page size, server cursor ordering and 72 unique-record cap; desktop four-column centered 4:5 thumbnails.
- [x] Separate entrance/tilt/clip/glare/depth layers; retain original fallback and complete detail view.
- [x] Implement shared guarded paging command; cover same-tick/deferred commits, duplicates/cursors/errors/retry/stale/unmount/cap versus exhaustion.
- [x] Implement empty/bootstrap-error/first-page retry and preserve existing items after later errors, with no automatic retry loop.
- [x] Implement independent controls, per-work like lock, actual 401 navigation and truthful errors.
- [x] Require explicit public permission, expose/select full text and support Clipboard failure; never infer permission from placeholder text.
- [x] Preserve positive-only query route, explicit guest return/reselect and saved canvas mode without auto mutation. Oversized Unicode URL transport remains the separately documented unresolved acceptance boundary.

Gate G4: paging, permission, copy and action tests/browser checks pass, including appended cards and viewer permutations. AC10's existing maximum-length Unicode URL transport problem is explicitly unresolved pending user approval of a bounded entry fallback; no create/auth/draft workaround is implemented.

## 6. Required Automated Gates

Run these real command interfaces only inside G0's isolated environment; they are not safe merely because they exist:

```powershell
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vitest run --testTimeout=30000
pnpm build
```

On Windows the task-owned runner may call the equivalent existing Node entry files directly to avoid shell argument mangling:

```powershell
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --testTimeout=30000
node node_modules/prisma/build/index.js generate
node node_modules/next/dist/bin/next build
```

- [x] Focused and full non-DB suites pass on post-review code: 136 files / 1610 tests, receipt `20261031T022525-test-acab99`; DB exclusions unchanged and no required test removed.
- [x] Final corrected-guard lint/types and unmodified production-source Prisma generation/Next build pass, separate from the browser DB adapter. All receipts have finite deadlines, exit 0 and no source/snapshot drift.
- [x] Record focused/full commands, counts, nine existing lint warnings and the fixed task-runner failure. No required tests removed/skipped, no `only`, and raw RSC privacy verified separately.
- [x] Check task-owned tracked and untracked code for whitespace, plus full `git diff --check`; no staging used.

Gate G5: passed for the current implementation on available Node 24.11.1. Final corrected-guard receipts: 136 files / 1610 non-DB tests (`20261031T023640-test-2944bb`), lint 0 errors / 9 baseline warnings (`20261031T023831-lint-c1133d`), types (`20261031T023902-types-b5ae9e`), installed Prisma generation with diagnostic no-network guard (`20261031T023444-prisma-no-network-cee3c7`), unmodified Next production build (`20261031T023558-build-e9709f`). Durable receipts: `checks/validation-evidence/final-automated/`. This does not complete excluded DB tests, fixed-runtime parity, missing assets or G6.

G5 asset-revision revalidation: 137 files / 1624 non-DB tests pass
(`20261031T040517-test-53473d`), lint 0 errors / 9 baseline warnings
(`20261031T040701-lint-66dc10`), types (`20261031T040737-types-da0801`),
installed Prisma with diagnostic network denial
(`20261031T040901-prisma-no-network-caa916`) and the unmodified production
Next build (`20261031T040922-build-dd79ad`) pass. All 806 source/test/static
inputs match the manifest; no fixture adapters or source drift. Current
durable evidence: `checks/validation-evidence/asset-delivery-final/`. Runtime
is still Node 24.11.1, not pinned 24.22.1; G6 and the unapproved long-URL
fallback remain separate.

## 7. Real-Next Browser And Raw Transfer Checks

Use the precise matrix in `research/homepage-validation-plan.md`. The primary browser lane is a new task-owned fixture, not the unrelated mobile harness or production data.

- [x] Create separate credential-free Next snapshots with actual pages/auth/benefits/serializers/policies. Only `db.ts` is replaced by synthetic rows, plus finite snapshot-only fixture routes; all replacements recorded.
- [x] Serve finite loopback routes with bounded owned processes/empty profiles, actual local fonts and varied full-size gallery test media. Missing hero assets remain missing, never replaced by success surrogates.
- [x] Verify actual SSR data and reset/isolate fixture cache for guest/data/empty/error scenarios.
- [x] Capture actual client props plus raw HTML/RSC R6 matrix and navigation/refresh: 43/43 real-Next/synthetic-DB checks pass in `checks/browser/evidence/privacy-1793411779202/`. Owner/admin data remains intact. Existing streamed notFound transport behavior is separately captured before and after; it is not mislabeled as universal HTTP 404.
- [ ] Compare clean reference and implementation at 1440x1000 and 390x844; smoke 320/768/1024. Verify actual loaded fonts/image decoding and document approved content differences; do not mutate original reference snapshots to hide drift.
- [ ] Exercise each of six motion groups under normal motion, then reduced motion/pause. Check active transforms, rapid scene switching, pointer/touch/keyboard access and post-unmount cleanup; static screenshots alone do not prove animations.
- [x] Exercise 16->32->48->64->72, races, retries, permissions, copy refusal, guest login/reselect, footer/default-route links and real navigation; final combined browser pass covers these executable paths.
- [ ] Verify actual positive-prompt navigation, successive selections, Unicode/URL encoding, the existing 8000-unit boundary and saved-canvas/manual-chat behavior. Do not resolve failures by overwriting mounted drafts or adding hidden auth continuation.

Gate G6: NOT complete. Final executable actual-Next/synthetic-DB browser matrix passes 71/71 (`checks/browser/evidence/full-1793413804860/`), with all source/helper/build identities unchanged and owned processes stopped. Eight unresolved records remain separate: missing assets at five widths, successful scene/dust effects, and two multibyte URL failures. No real-account/DB/Worker/provider E2E, physical-device IME, fixed-runtime parity or release readiness is claimed.

Optional broader release checks remain separate:

```powershell
pnpm verify:ci
pnpm verify:e2e
```

Neither is automatically credential-isolated from its caller; the E2E wrapper also needs its documented authorized local Docker/images/build prerequisites. No homepage-only flags or browser relay exist today. Do not expand production wrappers/Compose/allowlists, use a real DB or claim these optional checks ran without separate evidence and authorization.

## 8. Independent Review And Handoff

- [x] Independent `trellis-check` completed full source review, added five missing regressions and confirmed 173 focused tests / lint / types pass; no new production defect found. See `checks/independent-review.md`.
- [x] Walk all 14 AC against exact unit/raw/browser/source evidence in `checks/acceptance-status.md`; repeat full non-DB/build and final 71-check browser after source review. Unresolved AC stay unchecked rather than using mock success to fill gaps.
- [x] Main session captured proven contracts in `frontend/public-work-data.md` and `frontend/homepage-interactions.md`, with additive index entries; existing canvas/operations changes preserved.
- [x] Record changed files, actual results, pending external/product decisions and real-service limits in `checks/acceptance-status.md` and `checks/session-handoff.md`; report them to the user without automatic staging, commit, push, deployment or archive. Task remains `in_progress`.

## Stop And Rollback Rules

- Missing asset/tool/fixture prerequisite: stop the affected gate, report it and request only the needed access. Do not substitute fake completion or fetch real credentials.
- Unexpected changes to owned files: stop and coordinate before editing; use current source instead of reverting to a saved baseline.
- Material navigation, permission, art-direction or scope change: revise PRD/design and obtain a fresh final review before implementing the new behavior.
- Visual rollback: undo only this task's cosmetic hunks/assets, keep compatible additive DTOs and the independently verified privacy fix where possible. No hard reset, checkout restore, destructive cleanup of shared output, DB migration rollback or global font/theme replacement.
- Windows cleanup: resolve and verify every absolute scratch path beneath its owner-marked root, then use native literal-path operations. Background helpers use hidden windows and owned process tracking.

## Git Delivery Progress

Source/spec work commit: `d1960ecc53ceadcda70e3bf9616cc8020c70b570` (`feat: deliver studio canvas and warm editorial homepage`). Exact staged source audit passes for 401 blobs plus the intended history-rail deletion. Task records, archive/journal and normal push follow; no deployment or live migration is performed.

Final Git delivery: normal `origin main` push exited 0; remote head verified as `34d4297d0d57b56353378e4b9d2d19befcfc8338`. Source, earlier task work, evidence, archive and journal are delivered. `checks/git-delivery-result.json` records the observed push; subsequent receipt edits are bookkeeping only.
