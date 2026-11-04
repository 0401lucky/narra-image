# Canvas Interaction Refactor Verification

## Active Revision 2: 2026-11-04

The user approved the unified creation-card/bottom-dock final summary. Revision
2 code and local validation are complete; revision 1 receipts below remain
historical. On 2026-11-04 the user separately approved both planned commits,
ordinary main push and observation of the resulting GitHub Actions run.
Source/spec commit `dfc09306c8a5593a9b1cacc9f240088e002c7181` is complete; the
task/evidence commit and ordinary push follow. Delivery approval and exact staged
source receipts are under `checks/unified-cards-and-dock/delivery/`.
This record does not prematurely claim a successful remote push/CI result.
Production deployment, paid/live testing and physical-device acceptance remain
unperformed. All paths in this section are under `checks/unified-cards-and-dock/`.

### Implemented And Independently Reviewed

- Creation view presents one generation card/editor, with private/shared prompt
  sources folded visually; Advanced graph exposes all canonical nodes/edges.
  Old IDs, positions, shared edits, source order, scene v1 and Run/Save are kept.
- Screen-space attached editing replaces duplicate node/side-panel controls;
  the bottom dock provides real select/pan/create/import/graph/selected actions.
  Camera controls and node lookup remain reachable. Existing cream/orange visual
  language and Chinese labels remain; MIT adaptation notices are retained.
- First native run reproduced closed-editor/same-selected-node reopen failure;
  implementer fixed both normal click and subthreshold release paths. Independent
  review then fixed an invisible Flow outer-wrapper hit/focus area and low-image
  toolbar overlap with higher-z docks. Fresh component/native regressions prove
  these corrections rather than replacing failed actions with DOM clicks.
- Independent full-suite baseline found six stale mounted-studio assumptions;
  tests now explicitly open Advanced graph or use the unified prompt. Existing
  owner, retained controller, lost-ACK, balance refresh and no-extra-Run assertions
  remain. `review/review.md` reports no remaining in-scope findings.

### Fresh Gates

| Gate | Receipt / Evidence | Result |
| --- | --- | --- |
| Pinned isolation self-tests | `isolation-selftest.log` | PASS, 8/8; harness evidence only |
| Implementer targeted suite | `20261104T070331-test-450d96` | PASS, 6 files / 109 tests |
| Reviewer regression/integration | `20261104T071801-test-8b682d` | PASS, 4 files / 71 tests |
| Independent root ESLint | `20261104T071912-lint-0ed200` | PASS, 0 errors / 9 existing warnings |
| Final metadata-inclusive root ESLint | `20261104T073400-lint-f42d9b` | PASS, current authored task tools, no product drift |
| Independent strict TypeScript | `20261104T071956-types-52fdee` | PASS |
| Independent full non-DB Vitest | `20261104T072030-test-d8958d` | PASS, 144 files / 1824 tests in one run |
| Isolated Prisma generation | `20261104T072402-prisma-a4ba92` | PASS, copied dependency output only |
| Actual application production build | `20261104T072420-build-70d24c` | PASS, complete Next build with 2 workers |
| Reviewed-source fixture build | `reviewed-fixture-build.json` | PASS, exact UI with explicit test route shell |
| Reviewed-source native browser | `20261104T072634-script-11ef10` | PASS, 15/15, no browser exceptions |

Prisma and actual build are the installed equivalents of `pnpm build`; pnpm is
absent in the shell, so the runner calls pinned installed CLIs directly. A clean
environment is constructed before Node starts, dependencies are copied and
audited, and actual dotenv/credentials are unavailable. Only build children
receive `CIRCLE_NODE_TOTAL=3` for the audited Next two-worker setting; test
environment and production settings are unchanged. Gates run serially with
finite deadlines and actual exit codes; no installs/live infrastructure occur.

### Native Browser And Acceptance Mapping

Final evidence: `browser/evidence/native-1793777195364/`, Chrome 156.0.8078.74,
Node v24.22.1. All 414 production UI/lib/contracts/style/asset files and fixture
shell/helper/package identities match before/after. The built artifact hash is
unchanged while serving. Dedicated browser profile, fake loopback identity/HTTP/
catalogue/media and native IndexedDB are used; generated gradient images are
fixture media, not live provider results.

`final-audit.json` verifies all 25 reviewed code/test/notice files still match,
all current browser source/helpers match, 43 authored source/spec/tool files have
clean whitespace, and no staged or unrecognized changes exist. Context validation
passes with 16 implement / 15 check entries. The presentation spec is linked as
a separate file so neither it nor the canvas core spec exceeds the 32KiB injection
cap. `commit-plan.md` now records the separately approved two-commit delivery;
it does not authorize automatic finish-work/archive/journal commits. Existing
task ignores keep screenshots and raw stdout/stderr local, with reports and
JSON/hash receipts committed. The repository's single `verify` workflow builds
disposable E2E images but has no GHCR/Docker Hub publication step; observation
will distinguish build/verification from registry publication.

- UAC1: B1 proves an empty New, exactly one visible creation card/no prompt edge,
  a single readable editor, native Enter newline and one explicit target Run.
- UAC2: U2/B8/B9 prove shared/standalone lookup and complete graph toggling with
  unchanged canonical data, preserved shared edits, old 24-node/32-edge layout
  plus visible creation, and atomic capacity rejection in a 200-node graph.
- UAC3: B2/B3/U3/U6/B4/B5 cover select/view/whole-image drag, outside cancel,
  hand-panning from an image without moving it, native Tab/Enter dock controls,
  bottom-edge contextual toolbar reachability, exact original import/download
  bytes and continuation with explicit reordered reference input.
- UAC4: U4/B6 check screen-sized fields at low/high zoom, inert nonfocusable
  outer replacement wrapper, one DOM textarea, trusted CDP composition across
  360/390/430px portrait/short and landscape layouts, reachable actions and
  primary 44px phone targets. Main opens and visually inspects final desktop
  composer/continuation, edge toolbar, portrait and landscape screenshots.
- UAC5: U5/B7 plus all full-suite gates cover invalid empty Custom blocking
  Run/Save, raw draft retention, explicit Auto recovery, account Save and native
  IndexedDB reload with original IDs/positions and zero implicit generation.
  Upstream notice, full code/spec review and final source audit complete local
  acceptance; no schema/provider/billing/dependency change is required.

The first native 13/14 red receipt and earlier targeted/full/regression red
receipts remain. The intermediate 14/14 browser run predates the review fixes
and is not relabeled. OS chooser is CDP-selected, IME is Chromium CDP composition,
and dimensions/touch emulation are not physical iOS/Android or OS keyboard proof.
Real authentication/database/Worker/storage/provider, paid generation, production
optimizer/deployment, physical accessibility gestures and actual remote CI are
explicitly unperformed. No FPS or rollout readiness claim is made.

## Revision 1 Delivery Verification: 2026-11-03

- User-approved continuation preserves the three newer remote commits and
  fast-forwards to `e42ff7a74fb7d1c0e4507c960720bb0dc973f1ab` before restoring
  the refactor. Byte-exact backup, retained stash and integration audit confirm
  no lost local contribution, source conflict or remote-only edit.
- Final independent full-scope review is COMPLETE, not pending service recovery.
  `checks/delivery-independent/final-review.md` finds one P2 selected-image toolbar
  late-DOM-mount/removal seam, fixes it and adds a real regression. No remaining
  in-scope product defect is reported. Its two source/test hash changes are
  recorded; other 22 historical final source hashes remain unchanged.
- Current independent lint/types/targeted/full non-DB tests/Prisma PASS. Main's
  rebuilt application and native fixture PASS against integrated source. Exact
  delivery hashes/receipts live under `checks/delivery/`; the original 2026-11-02
  receipts below remain historical, not relabeled after source integration.
- GitHub `main` grouped commits/push are explicitly approved. The real staged
  source/spec audit passes and source commit `69f3006` is created; matching
  task/evidence and journal commits plus the ordinary push follow the approved
  plan. Actual push verification is recorded in the delivery journal afterward.
  Deployment, feature enablement,
  automatic archive, physical phones and actual service/CI acceptance stay out
  of scope. The task remains active for those explicitly unperformed boundaries.

| Current Gate | Exact Receipt | Result |
| --- | --- | --- |
| Independent targeted creation/placement/stage | `20261103T024011-test-18ed81` | PASS, 3 suites / 33 tests |
| Independent root ESLint including copied task tools | `20261103T024053-lint-cca071` | PASS, 0 errors / 9 existing warnings |
| Final metadata-inclusive root ESLint | `20261103T044429-lint-12e211` | PASS, 0 errors / 9 existing warnings, no source drift |
| Independent strict TypeScript | `20261103T024145-types-65e9ed` | PASS |
| Independent full non-DB Vitest | `20261103T024223-test-0326aa` | PASS, 143 files / 1812 tests, one full receipt |
| Independent isolated Prisma generation | `20261103T024431-prisma-a08489` | PASS, no database/migration |
| Default actual app build | `20261103T024448-build-883048` | FAIL, exit 134 native allocation OOM at 15-worker page-data collection; retained |
| Installed Next two-worker environment probe | `20261103T043517-build-worker-probe-346c2d` | PASS, build-only `CIRCLE_NODE_TOTAL=3` |
| Source-unchanged actual app build retry | `20261103T043518-build-workers-2-5a7261` | PASS, no timeout/config/dependency/production-memory change |
| Current fixture prebuild input identity | `20261103T043755-fixture-prebuild-882465` | PASS, no drift |
| Current fixture production build | `20261103T043756-fixture-build-workers-2-93fc74` | PASS, recorded route shell/current UI |
| Current fixture postbuild identity | `20261103T043805-fixture-postbuild-01d233` | PASS |
| Current native browser matrix | `20261103T043805-native-browser-de83bd` | PASS, 10/10, no browser errors/external requests |

Resource-safe retries limit concurrency only in the clean validation child
environment before startup. The installed Next 16.2.4 default CPU formula is
verified; original `next build`, types and page-data/static generation all run.
Source/config hashes remain exact and the default failure is not erased or
counted as a default-concurrency pass. No actual development dotenv, provider,
database, S3/R2 or billing access occurs.

Current native evidence: `checks/browser/evidence/native-1793680686027/`.
Chrome `156.0.8078.74`, pinned Node `v24.22.1`, 412 exact UI/lib/contracts/CSS/
asset inputs match pre/post run. Build hash remains
`9d3b2d8802539d9f91fedef3dd48eb074b0f1d98640177d2886e0f6b6c7cb763`.
B0-B9 cover calibration, direct explicit creation/run, image select/view/drag,
outside cancellation, exact original import/download, continued creation and
thumbnail order, 360/390/430 short/portrait and landscape focused composition,
manual Save/native IndexedDB reload, 24-node/32-edge legacy visibility and
200-node capacity rejection. Main inspects current desktop/composer/selected
image and phone portrait/short/landscape screenshots; fixture images decode.
No physical-device/native OS chooser/IME/download or performance claim follows.

The original AC1-AC7 mapping is maintained with the integrated full tests and
rebuilt B0-B9 matrix. AC8's local automation and independent review now pass;
physical/live/actual GitHub CI remain unperformed. Task-local Git attributes
retain raw machine/upstream bytes with ordinary whitespace rules plus CRLF
recognition, verified by positive and four negative temporary-index checks.
No product/helper/authored-document whitespace exemption is introduced.

## Historical Verification: 2026-11-02

The remaining sections describe the original frozen source and permissions at
that date. Their independent-review pending state and no-commit statements are
historical; the current delivery section supersedes them without rewriting red
receipts, source identities or old authorization records.

## Delivery And Gate Status

- Image-first implementation and final local automated/browser verification are
  complete. New image -> composer -> explicit Run replaces manual first-time
  graph assembly; image selection -> Continue prepares a separate new task.
- Primary references use ordered thumbnails and captured atomic imports. Desktop
  image bodies select/drag rather than implicitly view; explicit View/Download
  retain original bytes. Phone sheets keep focused inputs across short/landscape
  layouts. Advanced graph tools, all old nodes and scene v1 remain available.
- The initial independent checker reviewed the implementation, fixed the first
  visible-anchor issue, and ran full post-anchor gates. Two later native/screenshot
  positioning corrections are main-owned: dense visible-region bounds and late
  Flow DOM mount discovery. Their final source passes the fresh gates below.
- A fresh independent review of those final corrections is PENDING: repeated
  native follow-ups and the bounded default CLI reviewer failed with the same
  `prompt_cache_key` service error before review tools executed. Do not label
  main-run evidence as a fresh independent review or formal release signoff.
- No staging/commit/push/deployment/production enablement/archive, real dotenv,
  actual database/S3/provider/billing test or dependency/schema migration occurred.
  Task remains `in_progress` for the pending review and any later explicit commit.

## Current Source And Environment

- Baseline/current HEAD: `64dad3ca8ce30c16ef1d730c6d5382b192bab9ea`, `main`.
- `checks/final/source-freeze.json` records all 24 changed/new source/test paths
  and three updated frontend specs. Product gate input hashes and copied files
  match current source; no staged files exist.
- Pinned Node `v24.22.1`, copied installed dependencies, clean environment before
  Node launch, synthetic home/temp and dummy unavailable database/credentials.
  Installed direct CLIs substitute for missing shell `pnpm`; no install fallback.
- Eight isolation self-tests also pass with pinned Node; see
  `checks/pinned-isolation-selftest.json` and its log.
- Full copied root lint includes current task tools under the existing ignore
  policy; eleven authored JS helper files additionally pass direct syntax checks.
  Prisma generation writes only the copied dependency tree, not a database.

## Fresh Local Gates

Exact receipts and stdout/stderr are retained under `checks/final/evidence/`;
`checks/final/gates.json` indexes real exits, deadlines and evidence hashes.

| Gate | Current Receipt | Verdict |
| --- | --- | --- |
| Placement/stage targeted regression | `20261102T121151-test-9d4beb` | PASS, includes delayed Flow mount without fake resize |
| Root ESLint | `20261102T121215-lint-6d889d` | PASS, 0 errors / 9 existing warnings |
| Strict TypeScript | `20261102T121246-types-05d3bb` | PASS |
| Full non-DB Vitest | `20261102T121305-test-6aa40d` | PASS, 143 files / 1739 tests, one full receipt |
| Isolated Prisma client generation | `20261102T121510-prisma-fdf446` | PASS, no migration/DB claim |
| Actual application production build | `20261102T121528-build-063e15` | PASS |
| Task helper syntax | `20261102T121600-script-9dd79c` | PASS, eleven files |
| Final fixture production build | `20261102T121821-build-20d52f` | PASS, exact production UI with recorded fixture shell |
| Final postbuild input/build identity | `20261102T121840-script-e78dc5` | PASS, no input drift |
| Final native browser matrix | `20261102T121840-script-c5b467` | PASS, 10/10, no browser exception or external request |

Final metadata-inclusive root lint `20261102T140241-lint-ca5ade` passes with
0 errors / 9 existing warnings. `checks/final/final-audit.json` records no frozen
source drift, no foreign/staged paths, a passing `git diff --check` and clean
whitespace in 58 authored product/spec/task files. Raw receipts/vendor snapshots
retain their original bytes.
The existing React `act(...)` test diagnostics remain warnings, not suppressed
or counted as test failures. DB suites are deliberately excluded from this
non-DB run and are not accepted by these numbers.

## Native Browser Evidence

Final run: `checks/browser/evidence/native-1793621920975/`.
Chrome `156.0.8078.74`, pinned Node, actual Next production SSR/lazy components,
native IndexedDB, isolated loopback identity/catalogue/API/media fixtures.
All 412 recorded production UI/lib/contracts/CSS/assets match before/after;
build hash stays `adc58273ed43195cede73a8092227c152d4995d5e5a578796589f56d52f4e644`.

| Case | Verified Behavior |
| --- | --- |
| B0 | Trusted Enter activates enabled button once, disabled negative, native Tab/Shift+Tab |
| B1 | Empty New -> atomic composer, delayed node adjacency, Enter newline/no submit, one explicit Run, unchanged viewport width |
| B2 | Image click selects, explicit decoded viewer, Escape close, whole-image drag, no incidental view/Run |
| B3 | Physically outside client-coordinate release cancels captured drag, no domain move |
| B4 | Visible import button + CDP file selection; exact original download bytes, no Run |
| B5 | Continue keeps old result, thumbnail add/reorder, captured second target and one explicit second Run |
| B6 | 360/390/430 portrait/short and 760x390 landscape, stable focused textarea/CDP composition, >=16px inputs and >=44px actions, native scroller reachability |
| B7 | Explicit account Save, originals retained, native IndexedDB reload preserves node IDs/positions and sends no extra Run |
| B8 | Dense 24-node/32-edge graph + far-off prompt, real pan/wheel zoom, visible new card, old nodes intact, opening does not move camera |
| B9 | 200 nodes render and creation rejects without partial growth/crash; no FPS/performance guarantee |

Screenshots inspected at final-source desktop composer/image selection and phone
portrait/short/landscape layouts. Image readiness is asserted with `complete &&
naturalWidth>0`; fake thumbnails intentionally serve fixture original bytes.
This verifies UI media layout, not the real Next optimizer/storage/authentication.
`network.json`, `checks.json`, `source.json`, `result.json` retain exact state,
trusted input traces, two explicit generation requests and original media hashes.

## Acceptance Mapping

| AC | Evidence | Status Within Local Scope |
| --- | --- | --- |
| AC1 | `canvas-quick-creation`, `canvas-image-first-stage`, B1/B9 | PASS: complete private group, manual Run, atomic rejection |
| AC2 | quick creation/runs/terminal placement suites, B5 | PASS: ordered continuation, immutable older results, existing materialization |
| AC3 | stage/mobile-interaction/renderer suites, B2/B3/B4 | PASS: select/view/drag separation, native outside cancellation, guarded keyboard/mobile Move regressions |
| AC4 | editor/placement/mobile viewport suites, B1/B6 | PASS: screen-space adjacency/fallback, stable native input, reachable short actions |
| AC5 | quick creation/connections/image-first stage suites, B4/B5 | PASS: atomic batches, captured chooser, source fencing, ordinal/duplicate checks |
| AC6 | shared/missing prompt/stage/renderer/terminal suites, B8 | PASS: old graph unchanged, shared source preserved, rapid repair input and delayed DOM discovery |
| AC7 | full controller/draft/original/lease/jobs/studio/chat suites, B7 | PASS: existing owner/CAS/manual Save/frozen Run/outbox/retention and conversation regressions |
| AC8 | fresh gates/source freeze/browser identities/screenshots | Local automation PASS; independent final review PENDING and external gates unperformed |

## Retained Failures And Corrections

- Initial obsolete UX and render-time prompt ref lint failures remain under the
  implementation handoff; tests were corrected without removing safety assertions.
- `20261102T080626-script-519bf2`: Next added only `.next/dev/types/**/*.ts`
  to copied fixture config. Exact fixture-only normalization/rebind/rebuild is
  recorded; production source checks were not relaxed.
- Early browser lazy-ready, 300ms native draft debounce, wrong viewer locator and
  nested textarea wheel-point failures are harness-only. Their red evidence stays
  preserved; later calibrated runs exercise actually visible native controls.
- B8 in `native-1793611765492` is the real dense occupied-column positioning
  failure. A visible preferred point alone was insufficient; final controller
  placement now honors the captured legal world bounds without old-node relayout.
- `native-1793617283579` passed interactions before screenshot inspection revealed
  fake optimizer media were broken. Fixture media routing and decode assertions
  correct that evidence gap; this run is not the final media acceptance.
- Later screenshots exposed late Flow DOM mount leaving the composer at fallback;
  final hook/first-creation adjacency tests cover that corrected integration seam.
- `20261102T102520-test-da3a3c`: one unchanged featured-gallery focus assertion
  intermittently failed (1737/1738 passed). The exact-source full rerun passed;
  no homepage test/source was weakened or edited. Red receipt is retained.
- Independent reviewer service failures and the bounded CLI receipt remain in
  `checks/independent/`; no model or global configuration was changed to hide them.

## Unperformed And Wrap-Up Boundaries

- Physical iOS/Android, OS IME/on-screen keyboard/chooser/download, physical
  safe-area/accessibility zoom and complete two-finger scene/page pinch acceptance.
  CDP dimensions/composition and native pointer/keyboard are not physical proof.
- Real account authentication, SQL/Worker/storage/GC topology, actual provider or
  paid generation, production Next optimizer and remote GitHub CI.
- Fresh independent final source review after main-native corrections.
- Commit/staging/push/deployment/enablement/archive. Finish-work survey finds
  current-task source uncommitted, so archive/journal auto-commit scripts are not
  run. Session progress is retained in this active task rather than auto-committed.
