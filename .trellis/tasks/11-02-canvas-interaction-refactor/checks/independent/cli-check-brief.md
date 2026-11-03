Active task: .trellis/tasks/11-02-canvas-interaction-refactor

You are the dispatched trellis-check sub-agent. Review and self-fix directly;
never spawn another implement/check agent. Native sub-agent responses repeatedly
errored before executing tools; this bounded CLI worker is the same authorized
independent check step, not a new user feature or model/configuration migration.

Read task check.jsonl and its specs, prd.md, design.md and implement.md. Planning
and implementation are fully approved. You are not alone: preserve authorized
edits from others and never revert foreign changes. No staging, commits, pushes,
archive/deploy, real dotenv/secrets, live DB/S3/provider/billing tests, package or
shared schema/API/environment changes. Main owns task plans, specs and browser
tooling; you own scoped product/test fixes and checks/independent evidence only.

Concrete B8 native repro is in checks/browser/evidence/native-1793611765492,
including B8-legacy-visible-anchor-state.json and failure screenshot. The fixture
loads a 24-node/32-edge legacy scene with reference/prompt/generation rows and the
last prompt at x=50000,y=20000, then wheel zooms and clicks New image. The stage
captures a visible preferred world point, but canvasInsertionPosition then scans
one occupied column downward and moves the new generation node offscreen. The
controller performs another collision pass. All 25 original nodes/edges must
stay intact (24 old nodes plus the newly-created pair gives 26; do not infer a
format migration). No automatic camera adjustment merely for opening a composer.

Fix primary creation/import with a bounded nearby visible placement search or
safe visible fallback, while preserving manual graph insertion, explicit drop,
terminal output placement, old positions/IDs/edges, atomic creation/import,
original maps, capacity reservations and scene v1. Inspect the actual code:
src/components/create/parts/canvas-stage.tsx,
src/components/create/canvas/commands.ts and controller.ts,
src/tests/unit/canvas-image-first-stage.test.tsx and canvas-quick-creation.test.ts.
Add realistic dense-legacy/camera regressions for creation and captured import.
Avoid duplicate insertion algorithms or bypassing refined graph validation.

The other nine native cases now pass: calibrated trusted keyboard, direct Run,
single-click select/explicit viewer, whole-image drag, physical release outside
viewport cancels, chooser import/exact original download, continuation/order,
360/390/430 short-height focus, Save/native IndexedDB reload, 200-node capacity.
B5 initially failed only because the harness wheeled onto an overscroll-contained
textarea; the calibrated native scroller now reaches it. Do not change that UI
based on the obsolete harness failure.

Main owns heavy execution lanes. Do not launch lint/types/test/build/browser from
the real workspace. You may implement now, then freeze source and persist a
concise finding/fix/test handoff under checks/independent/native-placement-fix.md.
Main will refresh the isolated source copy and run pinned Node24.22.1 gates.
Prior post-anchor baseline gates passed 143 files/1734 tests, lint(9 existing
warnings), strict types and production build; they are superseded by your fix.
If you see an actual additional issue, record and self-fix within scope, and
describe precise changed paths. Stop product edits after your final handoff.
