# Hero Hit Testing And Phone Composition

- Implementer: `hero_hit_impl`, dispatched `trellis-implement`, 2026-10-31.
- Continuation: approved task, source session `01a19012-4c1c-78c3-a256-c449e820adcb`.
- Status: two-file product/test candidate is frozen; own focused tests, full-source lint and types pass. Independent native-browser verification is owned by `hero_hit_check` and is not implied by these unit results.
- Ownership: homepage CSS, the existing hero unit suite, this report and newly prepared private validation lanes only. Hero markup, hooks, assets, gallery, create/canvas, shared styles/configuration and all other baseline changes are preserved.

## Defect And Correction

The retained pre-fix native receipt is `browser/evidence/diagnostic-1793420516503/hero-native-hit-diagnostic.json`. With a decoded image and tilted frame, `elementFromPoint` and actual pointerdown/up/click events hit `IMG` at the visible copy button; the clipboard receives nothing. `elementsFromPoint` listing the button first is not proof that native input reaches it. The independently captured pre-fix snapshot was complete before this implementation changed product CSS.

`src/components/marketing/homepage/homepage.module.css` now gives the existing `sceneStage` an explicit flat composition boundary:

- `translateZ(0)` establishes an identity-transformed scene plane inside the unchanged outer tilt; it does not animate or displace the content.
- `transform-style: flat` composes image/blur descendants into that plane rather than extending the frame's 3D rendering context.
- `isolation: isolate` keeps the scene's stacking order local; viewport `z-index: 0` and prompt `z-index: 1` order the image animation's stacking context below its controls.
- The outer frame still has its original perspective, preserve-3d transform and pointer hook. Image zoom/fade, backdrop blur, dust, scanning ring and the separate gallery depth layers are unchanged. No pointer-event bypass or invisible surrogate control is introduced.

For phone widths through 639px, the existing sub-360px composition is reused: an independent relative 4:3 image viewport, then the complete prompt panel in normal flow with its existing 10px gap and dark backing. The stage itself is auto-sized, so the prompt cannot consume or crop the image's 4:3 area. The existing narrow-screen fallback position is reused at these phone widths. At 640px and above the original overlaid desktop composition remains. Tabs, complete accessible prompt/typewriter, copy, failure and retry use unchanged markup and state.

The implementer also opened the retained pre-fix `home-1793420304347/hero-storybook-390-full-frame.png`: its overlaid prompt visibly covers the lantern. Final decoded-image screenshots and native geometry, not CSS source assertions, determine the responsive verdict.

## Regression Coverage And Evidence Boundary

`src/tests/unit/homepage-hero.test.tsx` expands the existing first-scene copy test across all three committed scenes. Every case checks incomplete typewriter text, the matching image source, active pointer-depth variables in both axes, exactly one full-prompt clipboard write, truthful copied feedback and preservation of pointer/typewriter state during copying. The hero suite grows from 10 to 12 cases; no existing suite, permission or failure regression is removed.

These tests exercise real component/hook/clipboard wiring with controlled images and mocked geometry. They do **not** reproduce browser compositing or prove native pointer targeting. No artificial CSS-only red is offered as browser evidence. The retained native-IMG diagnostic is the product red; the independent checker owns new native center/corner, typing, keyboard/touch, motion-mode and responsive-layout assertions against real decoded assets.

## Frozen Source Identities

| File | Before SHA-256 | Frozen SHA-256 |
| --- | --- | --- |
| `src/components/marketing/homepage/homepage.module.css` | `ec7be31b074f036be8b0396692091fc8185b8d4922675b8f1e3bc0b9bf101786` | `7ea47efd76599b4e4a9ed92f78aff3533b0445db436ffb5c307bb2f4ee990fb0` |
| `src/tests/unit/homepage-hero.test.tsx` | `2842f2b7d1f7749029a4e0417be31ac41364234927251c5ed4a83e292ccc7e2e` | `72323da97e95d01809908c26aafb734fef4a5aea24fc9a895468aa82e60c5902` |

`hero-scene.tsx` remains `ae39dec877127642b7ea13c3b56b497689c25d7714db431ddec4cfcba0aad60d`. A read-only comparison at `2026-10-31T04:55:46Z` verifies 824 of the coordinator's 826 baseline inputs are byte-identical, with only the two expected files changed. Receipt: `.runtime/hhi-d6837226/implementation-source-comparison.json`. This comparison includes project specs; it predates any coordinator-owned documentation/spec follow-up.

## Implementer-Run Checks

Fresh lane: `checks/.runtime/hhi-d6837226/app`, prepared by the existing credential-free Python launcher. It contains 806 current source inputs, 46,664 physically copied installed dependency files (856,682,032 bytes), and 2,342 audited internal junctions. The copied corrected guard matches `bd9ec3da5da5787ffc8378f8ed97835428d4b5a9c80a21a099ccca2c4d077e55`.

Commands ran from the repository root:

```powershell
$runner = '.trellis/tasks/10-30-homepage-warm-editorial-redesign/checks/isolated_check.py'
$workspace = 'E:\code\narra-image\.trellis\tasks\10-30-homepage-warm-editorial-redesign\checks\.runtime\hhi-d6837226\app'
python $runner prepare --label hhi
python $runner run --workspace $workspace --stage test src/tests/unit/homepage-hero.test.tsx src/tests/unit/homepage-motion.test.tsx src/tests/contracts/homepage-assets.test.ts
python $runner run --workspace $workspace --stage lint
python $runner run --workspace $workspace --stage types
```

| Gate | Receipt under `.runtime/hhi-d6837226/receipts/` | Result | Duration / deadline |
| --- | --- | --- | --- |
| Focused Vitest | `20261031T045510-test-c826aa` | Exit 0; 3 files / 38 tests pass: hero 12, motion 12, assets 14 | 4.363s / 300s |
| Full-source ESLint | `20261031T045535-lint-d41c4e` | Exit 0; 0 errors and 9 existing warnings | 19.427s / 180s |
| Full-source TypeScript | `20261031T045614-types-11ca7e` | Exit 0; no diagnostics | 12.688s / 180s |

All three checks have empty stderr, no timeouts, no modified snapshot inputs and no before/after source drift. Tests receive no `APP_URL`, live dotenv or inherited caller configuration. Node and child processes run hidden with finite launcher deadlines. The lint warnings are unchanged unused variables in migration helpers/repair and the works-board test mocks, plus the existing default mobile-nav image warning.

`git diff --check` exits 0; Git only prints existing LF/CRLF conversion notices. That command alone does not inspect untracked source, so the two task-owned source files are also inspected directly for whitespace.

### Retained Preparation Failure

The earlier `prepare --label hero-hit-implementation` did not complete. It copied source into `.runtime/hero-hit-implementation-1c1d851b/`, then reported `WinError 3` during dependency preparation. Read-only diagnosis finds the first uncreated junction target at exactly 260 ordinary path characters (`jsdom`'s `css-syntax-patches-for-csstree` dependency), although the extended-path target exists. There are 1,337 created and 1,005 missing junctions; the source manifest is complete, but no dependency report, preparation success or Node probe exists. The shorter `hhi` label succeeds without changing the launcher, guard or installed dependencies. The failed owner-marked lane remains intact; no recursive removal or broad cleanup was used.

## Other Owners And Remaining Limits

- Coordinator-run broader validation is separate: `validation-evidence/hero-hit-final/result.json` records 137 files / 1,626 non-DB tests, lint/types, offline installed Prisma generation and an unmodified Next production build. Those are not implementer-run gates.
- Independent native-browser acceptance and final responsive image inspection belong to `hero_hit_check`; consult its report for actual evidence rather than treating controlled-image tests as real-asset acceptance.
- All local checks use installed Node 24.11.1, not the pinned 24.22.1 runtime. No download/install, live account/database/Worker/provider/storage, personal profile, physical mobile device, CI or deployment validation occurred.
- The unapproved oversized-Unicode remix-link fallback remains unchanged. No draft, saved-mode, privacy or authentication contract changes are included; no staging, commit, push or archive is performed.
