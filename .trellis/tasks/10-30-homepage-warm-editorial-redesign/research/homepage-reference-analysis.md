# Research: Homepage Reference Fidelity And Integration Boundaries

- Query: How can the supplied HTML be reproduced faithfully without replacing working homepage behavior with prototype-only behavior?
- Scope: Local source, supplied reference files, project specs, and repository task/journal search.
- Date: 2026-10-30
- Status: Planning evidence, not an approved design or implementation instruction.

## Reference Provenance

The user approved task creation and explicitly requested close reproduction of the reference HTML. After the initial research, the user also approved using the reference's three fixed hero scenes/prompts while retaining live works in the community gallery. Implementation has not been approved.

Continuation evidence recovered on 2026-10-30 from local session `01a18c10-0be8-7e62-bbf8-528a27cca2c9`: the assistant proposed a fixed 4:5 gallery grid with four desktop columns at `2026-10-30T10:05:28.903Z`, including centered thumbnail cropping, unchanged originals/detail views, and live works/likes/pagination. The user approved at `2026-10-30T13:27:07.358Z`, repeated approval at `2026-10-30T13:43:47.191Z`, and requested continuation at `2026-10-30T13:50:35.835Z`. Those later turns produced no substantive assistant result or task edits; the recovered layout decision is now recorded in PRD R4 and AC8. These responses do not approve implementation or the remaining scope choices.

During resumed planning, the user also approved keeping new style-category filtering and a public gallery out of scope. The bottom gallery CTA becomes a real Load More action on existing featured pagination, rather than promising a public browse-all destination. PRD R4 and AC9 record this approved reference deviation.

The user subsequently approved public-positive-prompt-only Remix, login followed by returning/reselecting rather than automatic authentication continuation, and preservation of the saved canvas mode with manual switching to conversation. No generation, charging, parameter cloning or canvas-node import is automatic. PRD R4 and AC10-AC11 record this boundary; see `research/prompt-reuse-contracts.md`.

The user also approved including the minimum image-detail privacy fix: exclude unauthorized prompts and internal review fields before non-owner data reaches the client, while preserving authorized public prompts, author/admin behavior and existing visibility rules. PRD R6 and AC12-AC13 define this bounded addition; implementation has not begun.

The footer-scope answer approves retaining the reference-like composition while replacing unsupported labels with existing real routes, homepage sections and the known GitHub repository. No new model/policy/status pages are included. PRD R4 and AC14 record that decision; technical design and final implementation approval are still pending.

Subsequent asset research found that the original second hero URL returns 404, while the first and third resolve to a castle and a game controller rather than the declared scenes. The user then explicitly approved three replacement fixed visuals matching the bookshop light, lantern-carrying fox and rainy eastern lane, while keeping scene names, prompts, layout and all interactions. See `research/homepage-asset-delivery.md` and PRD R3. The old fixed-reference-image approval is superseded; the original snapshots remain historical evidence.

| Original | Task-local snapshot | Size | SHA-256 |
| --- | --- | --- | --- |
| `E:/code/narra_image.html` | `references/narra_image.html` | 68792 bytes | `61407551CE76ABEE52F1025BADD1A125CEFD70823000F04AA64AF0E0F4A00F69` |
| `E:/code/narra_ai.md` | `references/narra_ai.md` | 7562 bytes | `D40267ECB81B87A7B7B79FDA501FC89FA5A3CCB9047C9FB0B42FEFB4FAEDD800` |

Paths beginning `references/` in this document are relative to the owning task. Both snapshots are byte-for-byte copies, including prototype annotations. Production must omit the preview banner, annotation badges, and annotation controls. Keep the originals unchanged for comparison.

The HTML defines the visual/interaction reference, while the Markdown explicitly requires preserving real application state and removing review-only elements. Its instruction to output complete component code does not override the user's current planning-only request.

## Current Architecture

- `package.json`: Next.js 16.2.4, React 19.2.4, Tailwind CSS 4, `motion` 12.38, TypeScript, Vitest and Testing Library. The reference instead uses Tailwind's CDN and imperative DOM scripting; importing its script/config wholesale is not compatible with the production architecture.
- `src/app/page.tsx:11`: Homepage first page is 16 featured works. The page remains a dynamic server component with separately loaded user and gallery data.
- `src/app/page.tsx:27`: Anonymous first-page caching uses a 60-second TTL and the `featured-works` tag. Logged-in results include viewer-specific state. User/works failures have existing fallbacks.
- `src/components/marketing/site-header.tsx:32`: Navigation includes real routes and conditional API/admin entries, not the prototype's anchor-only menu.
- `src/components/marketing/site-header.tsx:43`: Check-in summary, credits, avatar, logout, pet state, and mobile navigation are real business integrations.
- `src/components/pet/pet-state.ts:8`: Pet state is shared through localStorage, custom events, and `useSyncExternalStore`; a local demo toggle must not replace it.

## Visual And Behavior Mapping

| Area | Reference evidence | Current source evidence | Planning consequence |
| --- | --- | --- | --- |
| Paper palette and fonts | `references/narra_image.html:10`, `references/narra_image.html:14`, `references/narra_image.html:40` | `src/app/globals.css:3` defines different shared colors and fallback-only font families; `src/app/layout.tsx:18` applies the shared body theme | Load the requested font families and paper treatment, but isolate homepage styling rather than silently recoloring all routes. No bundled font files were found. |
| Navigation | `references/narra_image.html:228` uses a 64px sticky warm-glass header inside `max-w-7xl` | `src/components/marketing/header-shell.tsx:9` hides on desktop downward scroll; `src/components/marketing/site-header.tsx:50` is shared by many pages | A homepage-only visual/scroll variant can preserve other routes. Keep all real route visibility and account actions even where the prototype omits them. |
| Hero composition | `references/narra_image.html:274`, `references/narra_image.html:296` use a 12-column desktop layout, two semantic title lines, and a maximum 44px heading | `src/app/page.tsx:83` begins the current homepage; current hero uses a larger title and a mock macOS toolbar | Reproduce proportions, typography, underline, warm frame, prompt overlay, and embedded counters, not merely colors. Check narrow screens separately instead of forcing desktop text sizing. |
| Hero content | `references/narra_image.html:760` contains three fixed Unsplash URLs and demo labels/prompts; later image inspection found mismatches and a 404 | `src/app/page.tsx:73` derives the image, title and prompt from the first featured work | The user approved fixed hero scenes independent of live works, and subsequently approved replacing the broken/mismatched original images with matching bookshop/fox/rainy-lane visuals. Preserve the reference composition and interactions. The community gallery stays live. See PRD R3 and AC7. |
| Counters | `references/narra_image.html:329`, `references/narra_image.html:910` place three counters beneath hero actions | `src/app/page.tsx:272`, `src/app/page.tsx:281`, `src/app/page.tsx:290` already hardcode the same three numeric claims in a separate section | Moving existing display values does not require a new statistics service. Their accuracy/provenance is not established by this research; do not describe them as live telemetry. |
| Capabilities | `references/narra_image.html:448`, `references/narra_image.html:477` contain four miniature demonstrations inside a linen container | Current homepage has four text/icon cards only | Reproduce all four demonstrations. Distinguish demonstration state from real account settings, generation activity or service-health results. |
| API miniature | `references/narra_image.html:577` displays a prototype-only `/v2/narra/render` request | `src/components/api/api-key-console.tsx:59` documents `POST /v1/images/generations`; public routes are under `src/app/v1/` | Use real endpoint terminology in production; do not create a new API just to match decorative text. |
| Gallery layout | `references/narra_image.html:635`, `references/narra_image.html:1153` use an eight-item, fixed 4:5 grid | `src/components/marketing/featured-gallery.tsx:238` uses columns and `src/components/marketing/featured-gallery.tsx:262` preserves each work's aspect ratio | The user approved a fixed 4:5 thumbnail grid with four desktop columns and centered cropping of landscape/square previews. Preserve originals, complete detail views, live works, likes, and existing pagination. See PRD R4 and AC8. |
| Gallery loading | Prototype renders a static array | `src/components/marketing/featured-gallery.tsx:33` uses pages of 16, a 72-item cap, cursor loading, and deduplication | Do not replace real pagination with the prototype array or remove its existing cap without a product decision. |
| Gallery metadata/actions | `references/narra_image.html:1218` only simulates likes and remix feedback | `src/components/marketing/featured-gallery.tsx:168` calls the real like API and redirects 401 to login; `src/components/marketing/featured-gallery.tsx:246` opens the real detail route | Keep real actions. Add copy/remix through existing contracts and respect prompt visibility; see the separate prompt-contract research. |
| Gallery style filters | `references/narra_image.html:622` uses local `portrait`, `cinema`, and `still` categories | `src/app/api/works/featured/route.ts:28` accepts cursor, limit and video media type; `src/lib/server/works.ts:234` has no style-category query | The user approved omitting new style filtering in this task. Do not invent categories, ship fake filter controls, or filter only loaded items while implying a complete gallery search. |
| Browse-all CTA | `references/narra_image.html:649` renders a button with a hardcoded total, without a bound handler | `src/app/works/page.tsx:16` requires login and `src/app/works/page.tsx:20` queries personal works | The user approved an in-page Load More action using existing featured pagination, preserving page size and the display cap with honest loading/error/end states. Keep the reference-like CTA composition but omit its fictitious total. A new public gallery is out of scope; `/works` must not be presented as one. |
| Footer | `references/narra_image.html:659` supplies a dark footer and placeholder anchors | Current homepage has no footer; several named destination pages do not exist | Reproduce the footer composition but map navigation to actual destinations. New policy/status/model pages are not implicit UI scope. |

## Six Required Animation Groups

All groups are requested; reducing the work to a static redesign would miss the brief. The following values are reference observations, not mandatory internal implementation details.

| Group | Reference evidence and observable effect | Integration caution |
| --- | --- | --- |
| Hero depth and dust | `references/narra_image.html:844`: approximately +/-4.5 degree pointer tilt; `references/narra_image.html:863`: 32 warm dust particles | Avoid React state updates on every pointer frame; stop rendering offscreen/hidden/unmounted and handle unavailable canvas contexts. |
| Scene transition and typewriter | `references/narra_image.html:793`: 28ms character cadence; `references/narra_image.html:809`: image fades before replacement | Cancel stale image/timer work when users switch rapidly. The first scene should also receive the requested typewriter treatment, even though the prototype initially leaves it static. |
| Count-up | `references/narra_image.html:910`: 1500ms cubic ease-out, distinct integer/comma/decimal formats | Stable server content and final values under reduced motion; no hydration-dependent layout shift. |
| Capability spotlight and micro demos | `references/narra_image.html:939`: pointer coordinates; `references/narra_image.html:955`: 2200ms pill/version cycle; `references/narra_image.html:977`: clickable pet inspiration | Preserve all four miniature visuals. Do not let the pet inspiration button secretly change global pet preferences. |
| Gallery 3D/glare/depth | `references/narra_image.html:1089`: 950px perspective, approximately +/-7.5 degrees, 1.02 scale; image reverse movement and information forward movement | Separate entry-animation transforms from pointer transforms. The prototype explicitly removes its forwards animation class after entry. Limit active compositing work to relevant cards. |
| Section reveal and card cascade | `references/narra_image.html:138`: 24px/750ms section reveal; `references/narra_image.html:154`: 550ms card entrance; `references/narra_image.html:1155`: 70ms staggering | Ensure content remains visible if observation fails or motion is reduced; appended pages must not replay every earlier card's entrance. |

## Confirmed Scope Boundaries

Confirmed scope decisions are recorded in PRD R1-R6 and AC1-AC14, including the latest matching-image replacement. Actual footer-route evidence is recorded next. No product-scope question remains; scope approval is not final approval to start implementation.

Resolved after the initial research: the user approved fixed, illustrative reference hero scenes and prompts while retaining live community works, a fixed 4:5 gallery grid with four desktop columns and centered thumbnail cropping, and existing pagination via Load More instead of new style filters/public gallery capabilities. The PRD records these decisions; hero asset provenance/delivery still needs technical validation.

Homepage-only theming, existing navigation/authorization rules, and use of the real likes/pagination services are already implied by the stated homepage migration scope. They do not require rediscovering repository facts through user questions.

## Footer Route Evidence And Approved Adaptation

Continuation source inspection found no existing shared footer component and no app pages for the prototype's named model series, community policy, creator-copyright policy or service-status destination. The reference uses placeholder section/footer anchors for those labels (`references/narra_image.html:659`); reproducing the labels with the same inert behavior would not satisfy real navigation.

- Real creation routes are `/create`, `/prompts` and `/video`. The prompt library supports anonymous browsing (`src/app/prompts/page.tsx:17`); create and video retain their login gates (`src/app/create/page.tsx:23`, `src/app/video/page.tsx:15`).
- Existing account/tool routes are `/works`, `/settings` and `/api-keys`; each requires login (`src/app/works/page.tsx:16`, `src/app/settings/page.tsx:17`, `src/app/api-keys/page.tsx:19`). `/works` remains personal work management, never a public browse-all destination.
- `SiteHeader` already renders API navigation only for signed-in users and admin navigation only for admins (`src/components/marketing/site-header.tsx:32`). A footer must not treat route links as authorization or change those visibility rules.
- The existing GitHub destination is `https://github.com/0401lucky/narra-image`, already linked by the header (`src/components/marketing/site-header.tsx:68`) and `README.md:5`. Reuse that known destination rather than inventing a company, status or policy URL. External reachability was not tested here.

Mapping within the approved existing-route footer adaptation:

| Reference-like group | Actual destinations |
| --- | --- |
| Creation space | Create studio `/create`, prompt library `/prompts`, video studio `/video` |
| Tools and account | Personal works `/works`, account settings `/settings`, API console `/api-keys` for signed-in users; an explicit login entry for anonymous users |
| Explore Narra | Actual homepage capability/gallery sections and the existing GitHub repository |

Keep the dark warm-coffee background, brand narrative and three-column composition. Replace unsupported model/policy/status labels with truthful labels matching these destinations; do not create new pages or fake status/legal information solely for footer fidelity. The user approved this content adaptation; the homepage section anchors must actually exist.

## Testing And Performance Evidence

- `src/tests/unit/featured-gallery.test.tsx:33` covers next-page loading and duplicate removal.
- `src/tests/unit/featured-gallery.test.tsx:91` covers optimized-image failure falling back to the original image.
- These are not sufficient coverage for the new scene controls, clipboard, remix, hidden prompts, login handling, hover/focus/touch drawer, cleanup, reduced motion or empty/error states.
- `src/app/globals.css:130` intentionally keeps gallery cards free of per-card backdrop filters to avoid costly scrolling; preserve that intent while limiting reference-style blur to small interaction overlays.
- `src/app/globals.css:742` provides CSS reduced-motion fallback; `src/components/layout/page-transition.tsx:40` supplies MotionConfig. Neither automatically stops custom canvas/rAF/timer loops.
- Prototype scripts do not provide cleanup, reduced-motion or touch-specific gallery access. Match intended effects, not those omissions.
- Later visual review should compare a clean reference with the production page at equal desktop/mobile viewports, include idle and active interaction states, and explicitly record approved data/content differences. Do not claim a screenshot similarity percentage without a defined comparison method.

## Related Specs

- `.trellis/spec/frontend/directory-structure.md`: preserve server/client boundaries and feature-local parts/hooks/constants.
- `.trellis/spec/frontend/component-guidelines.md`: named exports, typed variants, `cn`, accessibility, `motion/react` and component composition.
- `.trellis/spec/frontend/hook-guidelines.md`: named hooks, refs, timer/listener cleanup.
- `.trellis/spec/frontend/state-management.md`: existing server-props/client-state patterns and response handling.
- `.trellis/spec/frontend/type-safety.md`: serialized boundary types and server-only modules.
- `.trellis/spec/frontend/quality-guidelines.md`: lint, type checks, unit tests, build and isolated verification rules.
- `.trellis/spec/guides/code-reuse-thinking-guide.md`: inspect existing helpers before creating another animation/clipboard/state abstraction.

## Caveats / Not Found

- This document's initial source inspection was not a browser-rendered visual assessment. Subsequent public asset downloads and image inspection are documented separately in `research/homepage-asset-delivery.md`; no product tests, production build or database query was performed.
- Font source/license checks and image availability/content checks are complete at research-sample level. Replacement of the original hero images is now an explicitly approved visual deviation; final image creation, browser/font rendering and asset delivery remain implementation verification work.
- `trellis` is not on PATH, so `trellis mem` could not be used. Initial repository task/journal text search did not reveal a prior homepage planning decision that settled the open choices. During continuation, the explicitly supplied session ID was located in local Codex JSONL storage and read directly without changing the history; its gallery approval is recorded in Reference Provenance.
- The worktree already contains extensive unrelated changes, including `src/app/globals.css` and the create page. Only this task's planning artifacts/reference snapshots are owned by this work.
