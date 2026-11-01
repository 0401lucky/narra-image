# Homepage Visual Implementation Evidence

- Slice: implementation steps 3-4, plus the shared motion/clipboard ports consumed by the gallery worker.
- Date: 2026-10-31. Production source is stable at this handoff; independent review may supersede these results.
- Implementer: `homepage_visual`. No other agents were spawned by this implementer.
- Read before write: complete saved hook context, task PRD/design/plan, `implement.jsonl` sources, supplied HTML/Markdown, reference/asset/prompt/validation research, frontend and operations safety specs, and `trellis-before-dev`.

## Ownership And Files

Modified existing files:

- `src/app/page.tsx`: keeps dynamic SSR, the anonymous 60-second cache/tag and separate viewer-specific query; distinguishes initial feed failure from true empty, passes auth and error hints to the gallery, and keys the gallery by viewer identity only. The fixed hero never consumes community records. First-page size reuses the gallery's pure constant.
- `src/components/marketing/site-header.tsx`, `header-shell.tsx`, `mobile-nav.tsx`: explicit `default | home` presentation boundary. Default JSX/classes/business behavior remain intact; the home shell never subscribes to hide-on-scroll.

New homepage-owned components/data/styles:

- `homepage/home-hero.tsx`, `hero-scene.tsx`, `hero-stats.tsx`, `capability-section.tsx`, `home-footer.tsx`.
- `homepage/home-header.tsx`, `home-mobile-nav.tsx`, `github-mark.tsx`, `header.module.css`.
- `homepage/home-motion-provider.tsx`, `motion-context.ts`, `home-reveal.tsx`, `constants.ts`, `types.ts`, `homepage.module.css`.
- `homepage/hooks/use-hero-scene.ts`, `use-home-motion.ts`, `use-home-visibility.ts`, `use-pointer-depth.ts`, `use-prompt-clipboard.ts`, `use-home-typewriter.ts`, `use-home-count-up.ts`, `use-home-cycle.ts`, `use-home-dust.ts`, `use-home-nav-dialog.ts`.

All `homepage/` paths above are under `src/components/marketing/`. The root owns `fonts.css`, all production bitmap/font assets and notices; the gallery agent owns its component, styles, schemas, loader/like hooks and tests. This slice does not edit those owned files. It does not edit root layout, global CSS, create/canvas files, production configuration, schema, deployment, or other routes.

New focused tests:

- `src/tests/unit/homepage-hero.test.tsx` (9): exact scene prompts/paths, semantic title and routes, initial typewriter/full copy, decode-latest-wins, keyboard scene switch, coherent image failure/timeout, clipboard manual fallback, same-URL image retry remount, and stale decode/unmount.
- `src/tests/unit/homepage-motion.test.tsx` (10): pointer frame coalescing and no per-event render, coarse/reduced/hidden/pause suspension, dust particle/DPR limits and frame/resize cleanup, missing context/observer fallback, once-only reveal and stale callback, bounded shared counters, local capability pet interaction without actual pet events/storage changes, and clipboard timeout/identity/unmount cleanup.
- `src/tests/unit/homepage-header-footer.test.tsx` (10): guest/user/admin links, existing check-in/logout endpoint and pet store wiring, default versus home shell behavior, body portal/focus trap/return/inert/scroll cleanup, and actual footer routes.
- `src/tests/unit/homepage-page.test.tsx` (4): real Home bootstrap, tagged anonymous caching, uncached viewer query, feed-error versus empty, real section anchors, and guest auth-read fallback.
- `src/tests/unit/helpers/homepage-motion-fixtures.ts`: explicit controllable browser frame/media/intersection/image fixtures. These are state/lifecycle tests, not actual raster-image or browser-layout verification.

## Presentation And Truthfulness

- Exact warm-paper token values live in the `.scope` CSS Module class; no `:root` or global body overrides. Actual font aliases supplied by the root are applied only to this scope and the explicit home header/portal. Cormorant owns editorial English/numbers, Noto Serif SC owns Chinese title emphasis, Jakarta owns UI/body text.
- Header retains real route and role visibility, account balance, check-in, pet picker and logout. Full home navigation starts at 1360px; narrower widths expose all real actions in the drawer. The drawer portals directly to `body`, restores previous scroll styles/inert attributes and trigger focus, traps keyboard focus, closes on Escape and on the full-navigation breakpoint, and opens its pet selector upward rather than beyond the scrolling panel.
- Home title has two semantic spans; the trailing phrase cannot orphan its final characters. Mobile text wraps without forcing a desktop width. Counters sit beneath the hero actions and explicitly say they are existing display copy, not live statistics or a speed test. Grid rows align numeric baselines despite wrapping labels.
- Capability words/version cycles and pet ideas are local illustrations. API miniature says `POST /v1/images/generations`, `200 OK` as an example response, and explicitly says no real request occurred. No demo invokes generation, health checks, billing or pet preference changes.
- Footer has a dark warm-ink brand area and three real-link groups. It has no invented policy/model/service-status destination. API visibility follows authentication; guest account destinations say login is required.
- A narrowly local CSS selector, `:global(.page-transition-shell):has(.page) > :global(.route-transition-gate)`, hides the unrelated shared page-gate overlay only while this Home scope exists. Source/browser investigation found the globally mounted gate's offscreen edge shadows otherwise leaked persistent orange bars into Home. No global/shared layout edit or high-z-index override was used. Default routes keep their gate; this gate is not one of the six requested homepage motion groups.

## Shared Motion And Clipboard Ports

`HomeMotionProvider` owns the page visibility, reduced-motion and fine-pointer subscriptions and the optional pause state. `useHomeMotion()` returns `reducedMotion`, `paused`, `pageVisible`, `finePointer`, `enabled`, `togglePaused`. Outside a provider the conservative default disables decorative work without blocking content or controls.

`useHomeVisibility<T>()` returns `{ ref, visible }`. It disconnects on unmount and ignores stale callbacks. A missing or throwing IntersectionObserver fails open for content/optional animation; content is not initially hidden by CSS.

`usePointerDepth<T>({ enabled, maxTilt = 4.5, perspective = 1200 })` returns a DOM ref. It only schedules a single pending animation frame after a fine-pointer event, and writes:

| DOM contract | Meaning |
| --- | --- |
| `--pointer-x`, `--pointer-y` | Normalized coordinates in `[-1, 1]` for independent image/info depth layers |
| `--rotate-x`, `--rotate-y` | Rotation angles with `deg` units |
| `--mouse-x`, `--mouse-y` | Percent positions for spotlight |
| `--glare-x`, `--glare-y` | Percent positions for the gallery's warm glare |
| `--pointer-perspective` | Perspective with `px` units |
| `data-pointer-active` | `true` only after a valid active pointer frame; reset on exit/cancel/suspension |

There are no idle per-card frame loops. Gallery uses 7.5-degree/950px depth, hero uses 4.5-degree depth, capability spotlight uses zero tilt. `HomeReveal` has its own entrance wrapper, one-time Motion animation, optional seconds delay, and cleanup that restores visible styles, separate from pointer transform roots.

Hero dust owns at most one visible/decoded-image loop, 32 particles and DPR capped at 2. Typewriter/counters/capability timers pause offscreen or in hidden tabs; pause/reduced preferences keep meaningful actions available and show complete prompt/final counters. Decorative scanning is CSS and shares active/pause/reduced control.

`usePromptClipboard({ text, identity })` returns `{ copy, status, reset }`. Status is `idle | copying | copied | manual`. It copies the entire verbatim captured text, waits for actual success, and falls back after rejection/unavailability or a 5-second permission timeout. Identity/request guards prevent stale feedback; feedback timers and pending UI waits end on reset/identity/unmount. Callers render their own selectable full text on `manual`. This does not claim the underlying OS clipboard operation can be cancelled.

Hero scene selection separates pending ID from committed image/labels/prompt. A 12-second image deadline and request epochs reject stale loads/decode. Failed selection preserves a coherent committed scene. Same-URL recovery remounts the image with a revision key; old DOM image error callbacks cannot invalidate a newer decoded revision. Copy always uses the committed complete prompt, never the typewriter fragment.

## Executed Checks

All Node product checks ran exclusively through the task's Python isolated runner in:

`checks/.runtime/production-fa4bca90/app`

The source snapshot contains 802 source files captured at `2026-10-31T02:10:41.133494+00:00`. Dependencies/output/env remain isolated per `checks/validation-environment.md`. Available runtime is Node 24.11.1, not the pinned 24.22.1; no pinned-runtime parity claim is made.

| Receipt under the production lane's `receipts/` | Actual result |
| --- | --- |
| `20261031T021149-test-da0f73` | Exit 0; 11 suites, 153 tests pass; 14.518s, 300s deadline |
| `20261031T021246-lint-b64c91` | Exit 0; no errors, nine existing baseline warnings; 19.005s, 180s deadline |
| `20261031T021340-types-2497cc` | Exit 0; no diagnostics; 3.151s, 180s deadline |

All three receipts report empty `sourceChanges` and `snapshotModifications`. The focused invocation covers the four new homepage suites (33), the gallery agent's four suites (72), and `featured-public-contract`, `prisma-mappers`, `work-detail-page-privacy` (48). Exact argv/logs are in the receipts. A first attempted focused invocation named nonexistent gallery test paths and was refused by the launcher before Node; it is not counted as a run.

Earlier red/fix evidence remains available: the first combined run (`20261031T020431-test-bfde9d`) had 103 passing tests and one test query failure because both the accessible full prompt and visual typewriter contained the same text. The assertion was narrowed to require a full accessible span, not weakened to accept missing text. Early fixture types were fixed by the gallery owner; an unavailable `Github` icon export was replaced by the existing project's code-native GitHub SVG. The final lint retains only the previously documented migration helpers, default mobile avatar and unrelated my-works test warnings.

`git diff --check` passed for the four modified existing owned source files. A separate read-only whitespace audit checked 30 task-owned new source/test files (including files not tracked by Git): zero trailing-whitespace findings. No staging, commit, archive, deployment, dependency installation or destructive operation was performed.

## Limits And Handoff

- All three built-in image-generation attempts reported by the coordinator failed because the host has no image model enabled. This implementer did not call a site provider, CLI/API workaround, stock-image substitute or placeholder generator. The approved three `/marketing/home/*-v1.png` paths are intentionally not represented as delivered assets. G2/AC7 image success and final G6 visual/motion-with-raster checks remain pending.
- Both immutable reference screenshots and the browser agent's actual Home screenshots were visually inspected. The latest `checks/browser/evidence/home-1793412719005/home-1440.png` and `home-390.png` show the local gate-edge fix and aligned counters. Image fallback is visible by design while source assets are blocked. Browser matrix results, actual image/font delivery and default-route comparisons belong to the browser agent's separate evidence; no screenshot-similarity percentage or final visual approval is claimed here.
- The source-level scene/dust success tests deliberately use controlled decode/canvas fixtures. They prove atomic state, timing and disposal contracts, not the absent illustrations or real browser GPU behavior.
- Full non-DB suite, unmodified production build and post-review final gates are left to the coordinator as requested. Real services, DB/Worker/provider/S3, Docker E2E and physical-device checks were not run by this slice.
- Production snapshot lane was released after the three checks above. No additional production edits are planned by this implementer; the independent reviewer coordinates any later corrections and revalidation with the root/browser agents.
