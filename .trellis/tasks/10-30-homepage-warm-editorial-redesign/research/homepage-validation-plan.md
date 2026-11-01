# Research: Homepage validation and image-detail privacy boundary

- Query: Concrete, credential-safe verification for R1-R6 / AC1-AC14, including actual client-bound data, SSR, motion, paging, reuse, and route isolation.
- Scope: Internal source inspection; external documentation links are orientation only, not fetched.
- Date: 2026-10-30
- Task: `.trellis/tasks/10-30-homepage-warm-editorial-redesign`; supplied explicitly by the parent. Planning only; no task activation or implementation approval.
- Evidence: Read workflow, researcher role, brainstorm skill, PRD, specs, implementation, tests, and verification fixtures. Only this research artifact is written. No git, test, lint, type-check, build, browser, network, installation, service, real dotenv, database, storage, or provider operation ran.
- Citation convention: `prd.md` and `references/*` below are relative to this task; other paths are repository-relative.

## Findings

### 1. Existing commands versus missing safe orchestration

These command interfaces exist now; they are NOT authorization to execute them in the ordinary working shell. The checked-in repo has no complete, independently credential-isolated non-DB/frontend wrapper. The isolation work below must precede execution after approval.

| Gate | Current supported command | Relevant evidence / bound |
| --- | --- | --- |
| Lint | `pnpm lint` | `package.json:12`: `eslint .`; CI stage limit 180s, `scripts/verify-ci.mjs:48`. |
| Types | `pnpm exec tsc --noEmit` | `scripts/verify-ci.mjs:44`: 120s. Incremental output is still enabled, `tsconfig.json:16`. |
| Non-DB suite | `pnpm exec vitest run --testTimeout=30000` | `vitest.config.ts:9` includes unit/contracts/non-DB integration; line 10 excludes worker/canvas DB suites. CI process limit 300s, `scripts/verify-ci.mjs:54`. |
| Production build | `pnpm build` | `package.json:9`: `prisma generate && next build`; CI limit 600s, `scripts/verify-ci.mjs:96`. This is not a runtime/SSR success assertion. |
| Broader CI | `pnpm verify:ci` | Also runs Node release tests, Worker contracts and Go tests/build; global 20-minute deadline, `scripts/verify-ci.mjs:16`. No frontend-only/stage-selection flags exist. |

Direct Node entry files were checked for existence, not executed. Under the same isolated environment, these avoid the Windows package-manager shell and are the concrete stage commands for a new task-only runner:

```powershell
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --testTimeout=30000
node node_modules/prisma/build/index.js generate
node node_modules/next/dist/bin/next build
```

- Dependency prerequisites: already-installed packages and generated Prisma client, Node 24 matching CI, pnpm 10.32.1 if using package scripts (`.github/workflows/verify.yml:17`, `package.json:6`). Do not install/download automatically; the direct-entry existence check does not prove toolchain health.
- Raw `pnpm build` reads root Prisma config, which calls `loadLocalEnv()` before export (`prisma.config.ts:5`, `prisma.config.ts:18`). Setting a fake `DATABASE_URL` alone does not stop other real dotenv fields being read. Next also needs isolation from local env loading.
- `verify:ci` spreads the caller environment (`scripts/verify-ci.mjs:114`) and cannot independently give only its build stage a non-loopback `APP_URL`. Do not claim the wrapper is safe merely because the default Vitest run excludes DB suites.
- `disposableTestEnvironment()` is specifically DB-runner-bound: it validates a generated localhost URL, sets both DB URLs, and deletes `APP_URL` (`scripts/lib/disposable-test-environment.mjs:32`). Do not repurpose it with an invented fake runner database.
- Its preload denies ALL `.env.*`, including `.env.example` (`scripts/lib/deny-disposable-env.cjs:12`); the full suite intentionally reads that public file (`src/tests/contracts/runtime-environment-contract.test.ts:138`). Blind reuse breaks legitimate non-DB coverage; do not skip that test to manufacture a green run.
- Windows `pnpm` stages go through `cmd.exe` (`scripts/lib/command-runner.mjs:48`). Use script files and direct Node argv, not `pnpm exec node -e` with shell metacharacters; keep real exit codes/timeouts and hidden windows (`scripts/lib/command-runner.mjs:90`).

### 2. Required test-only preparation after approval

Implement a small task-owned launcher/preload, not a production configuration change. The commands above remain the actual stage commands; no such homepage launcher currently exists.

1. Create an owner-marked temporary source snapshot with recorded hashes of the current source, not a reset/checkout of another revision. Exclude actual `.env`/`.env.*`, package credentials, assistant metadata and existing build outputs; copy the verified regular public `.env.example` needed by contracts. Do not move, rename or read live dotenv files.
2. Use already-installed dependencies only. Prisma generation, `.next`, caches and `tsconfig.tsbuildinfo` must write inside owned scratch, not through a junction into the live workspace or another task's generated client. No concurrent build may share those outputs.
3. Sanitize the initial Node process environment BEFORE launch, including removal of inherited `NODE_OPTIONS`; do not wait until an inherited preload has executed. Start from OS essentials, use owned empty home/config directories, and discard caller DB/provider/S3/AWS/proxy/credential configuration. Apply the same policy to every child.
4. Keep manifest-consistent safe defaults, a synthetic >=32-character `AUTH_SECRET`, no real provider/storage credentials, and a deliberately unusable synthetic DB endpoint; DB-dependent unit boundaries must be mocked. No DB sentinels are enabled. Use the existing manifest, not a new application env contract (`contracts/runtime/v1/environment.json`).
5. Add a narrow deny-env preload that allows only the exact verified public `.env.example`, not arbitrary similarly named files; test its sync/async behavior and inheritance. The credential-free snapshot remains the primary protection, including against native loaders; a JS filesystem shim alone is not a security sandbox.
6. Tests use `NODE_ENV=test` and NO inherited `APP_URL`; only generation/build stages use production-safe synthetic configuration such as `APP_URL=https://homepage-validation.invalid`, with `NODE_ENV=production`, and telemetry disabled. Production URL/secret checks are in `src/lib/env.ts:235`; never supply this build-only URL to missing/default-env tests.
7. Run bounded stages using `runCommand`/`runStages`, fail on errors, record exit codes and source identities, then clean up only the exact verified owner-marked scratch. Never use shared `.next` deletion as a retry strategy. A full isolated build must compile unmodified product source, separate from the synthetic browser fixture below.

### 3. Existing relevant coverage and missing R6 tests

| Inspected file | Current coverage; important limitation |
| --- | --- |
| `src/tests/unit/featured-gallery.test.tsx:33` | Observer paging/deduplication plus optimizer-error fallback at line 91; no button race, cap, 4:5, permission/copy/remix, error-state, or motion coverage. Existing fixture starts with 24 items, not the home bootstrap's 16. |
| `src/tests/unit/featured-works.test.ts:55` | SQL limit+1, composite cursor and `hasMore`; mocked Prisma. `src/tests/unit/featured-route.test.ts:23` tests anonymous response/cache only. |
| `src/tests/unit/prisma-mappers.test.ts:40` | Featured public prompt versus hidden placeholder; not detail serialization or explicit reuse permission. `src/lib/prisma-mappers.ts:143` currently has no featured permission flag. |
| `src/tests/unit/work-showcase.test.ts:230` | Pure access/prompt policy, not the actual page's outgoing props. `src/tests/unit/my-works-board.test.tsx:73` preserves an author's full prompt. |
| `src/tests/unit/prompt-modal-copy.test.tsx:15` | Existing full prompt/negative-prompt clipboard format. It does not prove gallery remix is positive-only. |
| `src/tests/unit/work-like-route.test.ts:57` | Guest rejection, like and unlike. `src/tests/unit/work-share-button.test.tsx:23` covers native share/copy fallback; pet and check-in also have existing unit suites. |
| `src/tests/unit/create-page-conversations.test.tsx:42` | Concrete pattern: await real async page, render with a spy client child, inspect its actual props; line 54 checks chat `initialPrompt`. |
| `src/tests/unit/generator-studio-canvas.test.tsx:199` | Independent drafts/no import; line 235 covers saved canvas preference after SSR. `src/tests/unit/generator-studio-origins.test.tsx:251` forbids same-owner fresh props overwriting local drafts. |

No actual Home-page, SiteHeader-variant, WorkDetailPage or WorkDetailPanel test was found in `src/tests`. New R6 coverage must not substitute CSS/DOM hiding for data protection:

1. Add a real async image-detail page boundary suite. Mock `db`, current-user lookup, environment, `notFound`, and unrelated header rendering; keep `getWorkById`, serialization and access policy real. Capture `WorkDetailPanel` props as in the create-page test, rather than mocking the detail loader to return an already-sanitized DTO.
2. Fixtures need distinctive non-null raw positive/negative prompts, reviewer email/id, `reviewedById`, `reviewNote`, and review timestamp. Assert the exact allowed client `work` keys and absence of internal fields (`reviewer`, `reviewedById`, `reviewNote`, `reviewedAt`); recursively check serialized values for fixture secret sentinels.
3. Matrix: anonymous and authenticated non-author x `FEATURED` x prompt public/hidden. Hidden: no raw positive OR negative prompt reaches props. Public: allowed full prompts survive, but all internal management fields remain absent. Include admin-as-non-author on the public route: no new public-route exception.
4. Matrix: non-author x `PRIVATE`, `PENDING`, `TAKEDOWN_PENDING`, regardless of prompt flag => `notFound`, no client detail props. Missing image follows existing missing/video fallback; do not broaden video behavior. Current exact policy: `src/lib/work-showcase.ts:189`.
5. Owner x all four statuses retains full prompts and existing management data; test the same fixture object used first for a public request and then an owner request to detect destructive sanitization/cache contamination. Preserve admin list/get serializers and authorization, not a globally stripped `serializeWork` (`src/lib/server/works.ts:333`, `src/lib/server/works.ts:371`).
6. Add owner submission/takedown and admin-view regression checks if DTO types touch their consumers. Owner controls use review notes/timestamps (`src/components/works/work-showcase-controls.tsx:34`); they are intentionally not public data.
7. Supplement props assertions with raw Next HTML/RSC response checks using the same sentinels, on initial loads and browser navigation/refresh when a browser fixture is available. Search actual response bytes/decoded payloads, not just visible text. Current leak path: `src/lib/prisma-mappers.ts:228` -> `src/lib/server/works.ts:362` -> `src/app/works/[id]/page.tsx:70`; client visibility logic occurs later (`src/components/works/work-detail-panel.tsx:50`).

### 4. Safe browser/SSR strategy and existing fixture reuse

- Home is force-dynamic and obtains current user and featured data on the server (`src/app/page.tsx:14`, `src/app/page.tsx:37`, `src/app/page.tsx:48`). The initial 16 records arrive as props, not a browser `/api/works/featured` request; anonymous data uses a 60-second server cache (`src/app/page.tsx:27`). Browser request interception cannot intercept Prisma sockets/server imports. Authenticated SiteHeader additionally reads check-in data server-side (`src/components/marketing/site-header.tsx:43`).
- UI lane, NEW after approval: owner-marked Next snapshot using the real home/detail pages, layout, header, serializers and components, with explicit synthetic server DB/auth/benefits adapters plus finite loopback API fixtures. Never add a production preview bypass/env flag. Record exactly which server dependencies are replaced. Use a fresh fixture/cache per server-data scenario so anonymous caching cannot hide the intended empty/error/data case.
- Use actual locally staged hero images/fonts and varied gallery fixture images, not universal 1px replacements. Block external browser requests; validate local media/optimizer failure separately. Bind app/facade/debugging to loopback, use a fresh browser profile without personal cookies, bound run time, and tear down only owned processes/windows.
- Existing mobile harness is a pattern, not a drop-in: `.trellis/tasks/10-28-studio-mobile-canvas-editor/checks/prepare-mobile-fixture.mjs:105` replaces the route/layout, line 133 supplies dummy studio props; `mobile-browser-check.mjs:10` depends on hard-coded temporary helpers and line 31 replaces every optimized image. Do not launch or modify that task's harness/resources. A copied/adapted version remains **simulated-service UI coverage**, not real-account/DB/Worker E2E.
- Actual service lane available today: `pnpm verify:e2e`, with nine fixed release/canvas scenarios (`scripts/verify-e2e.mjs:18`), 30-minute total and 120-second cleanup reserve. It has no homepage selector/browser mode. Existing SSR smoke explicitly says HTTP-only, not hydration/login-flow coverage (`scripts/fixtures/canvas-runtime.mjs:115`).
- Prerequisites: authorized local Linux Docker daemon via verified unix/npipe endpoint, Compose plugin, installed host dependencies, and pre-existing `postgres:17-alpine`, `node:24.22.1-alpine`, `golang:1.25-alpine`, `alpine:3.22`; alternatively the supported `E2E_SKIP_BUILD=1` requires both already-built local app/worker images. Missing prerequisites return 2 before runtime creation; do not report that as success (`scripts/lib/e2e-safety.mjs:41`, `scripts/lib/e2e-safety.mjs:284`). Building app/worker images can still require dependency downloads; local base-image presence is not offline-build readiness.
- Reusable protections: generated accounts/session tokens (`scripts/fixtures/canvas-runtime.mjs:101`), owned temporary PostgreSQL, fake internal S3, empty Compose env/config, fixed loopback HTTP, internal network, no app host ports, exact cleanup (`.trellis/spec/operations/release-hardening.md:63`). No real identity/provider/S3 configuration may be used.
- Existing HTTP transport does NOT allow `/`, `/works/:id`, arbitrary queries, static assets, or arbitrary hosts (`scripts/fixtures/canvas-object-store.mjs:16`). It returns UTF-8 text/JSON, not a browser binary asset relay, and has 256KiB envelope/128KiB body/1MiB response/10-second bounds. Client API interception alone cannot retrofit homepage SSR into it.
- Bounded next step: add a test-only showcase fixture using existing ownership/session/SQL helpers, seed deterministic FEATURED-public, FEATURED-hidden, PRIVATE/PENDING/TAKEDOWN images with distinct secret sentinels and a synthetic reviewer. Add only validated GET `/` and the run's generated `/works/:id` routes to a separate narrowly tested transport (or explicit allowlist extension), retaining fixed `127.0.0.1:3000`, redirect rejection, byte/time bounds, owner checks and no new production routes. Raw HTML/RSC assertions then exercise real Next + Prisma + temporary DB; this is still HTTP E2E, not a browser.
- If true browser-on-service coverage is required, add a NEW loopback-only browser facade through checked container exec, not host-published app ports: allow only finite fixture page routes and exact built/static/media assets from a verified manifest; add bounded binary responses rather than decoding fonts/images as UTF-8. Keep existing canvas API rules unchanged; do not allow arbitrary URLs/queries or writes. Test rejected foreign IDs, encoded traversal, redirects, oversized bodies and deadlines before use. Browser driver/binary availability and this relay are not supplied by today's wrapper.

### 5. Finite regression matrix

Baseline/pixel checks: 1440x1000 desktop and 390x844 touch; responsive smoke at widths 320, 768 and 1024. Exercise normal and reduced motion, keyboard-only and coarse-pointer input. Wait for verified font loads/image decode; capture settled reference comparisons separately from normal-motion recordings. Do not disable animations and call their behavior verified.

| ID | Required checks | Source / acceptance |
| --- | --- | --- |
| S1 | Home-only warm tokens/fonts/texture/header variant. Navigate home -> create, works, settings, admin -> back; default shared header, global body styles, geometry and actions retain their baseline. Test both omitted variant and explicit home variant. | `src/app/globals.css:3`, `src/components/marketing/site-header.tsx:13`; AC1, AC6. |
| S2 | Anonymous, user and admin header/mobile nav; real avatar/credits/check-in/login/logout/pet toggle, permission-sensitive links, failure feedback. Capability demos must not issue generation, health or pet-setting mutations. | `src/components/marketing/site-header.tsx:32`; AC3-AC4. |
| M1 | Hero pointer tilt and warm-dust canvas: normal motion, pointer exit/reset, resize, no touch-only dependency; reduced motion static/readable; cancel RAF/listeners on unmount. | `references/narra_ai.md:58`; AC2, AC5. |
| M2 | All three image transitions/typewriters; rapid 1->2->3->1 during typing; final image/label/full-copy prompt match; late timer/image completion cannot restore an old scene. | `references/narra_ai.md:59`; AC2, AC5, AC7. |
| M3 | Count-up reaches existing 150,000+, 120+, <4.2s correctly; stats occur only under hero CTAs; reduced motion shows final values, no telemetry/service measurement request. | `references/narra_ai.md:60`, `src/app/page.tsx:272`; AC2. |
| M4 | Four capability spotlights plus inspiration-word cycle, version nodes, clickable pet bar and API example; keyboard/touch access and timer cleanup; API terminology matches real documentation. | `references/narra_ai.md:61`, `prd.md:40`; AC2, AC4-AC5. |
| M5 | Gallery overall tilt, moving warm glare, opposing image displacement and forward info depth; hover/focus exit resets smoothly, long prompt/like/copy controls remain clickable. | `references/narra_ai.md:62`; AC2, AC4. |
| M6 | Section reveal + staggered gallery entry, including appended records; enter/hover/exit do not fight over one transform. No observer/reduced-motion path may leave content permanently invisible. | `references/narra_ai.md:66`; AC2, AC5. |
| H1 | Three approved replacement scene images remain fixed when featured works reorder or are empty/error; full current scene prompt copied even before typewriter completes; image failure has honest fallback. | PRD R3; AC7. |
| G1 | Desktop four-column 4:5 cards using real serialized records; landscape/square/portrait crop only thumbnail center; detail/lightbox/download retain original full image; optimizer failure falls back once. | `src/components/marketing/featured-gallery.tsx:58`; AC8. |
| P1 | First 16; append 16->32->48->64->72 and stop even if server has more; unique IDs, same-date cursor ordering, 0/1/16/17 records, no fabricated total or /works-as-public-gallery link. | `src/app/page.tsx:11`, `src/components/marketing/featured-gallery.tsx:33`, `src/lib/server/works.ts:234`; AC9. |
| P2 | Deferred fetch: repeated button clicks and observer+button in same tick yield one in-flight page and no skipped/duplicated records; success/error/rejection/malformed data/retry/exhaustion; unmount/late response cannot append. Keep last successful items and retry cursor on failure. | Existing state-only gate `src/components/marketing/featured-gallery.tsx:133`; AC4, AC9. |
| C1 | Explicit permission true/false, missing permission fail-closed, public long/multiline/Unicode prompt, legitimate text matching placeholder. Copy full public text, never title/preview/placeholder; clipboard denied/unavailable feedback. Hidden raw text absent in SSR and API DTOs. | `src/lib/prisma-mappers.ts:280`; AC3, AC10. |
| C2 | Authenticated remix pre-fills only positive chat prompt; zero automatic generation/debit/conversation/canvas writes and no negative/model/reference/parameter cloning. Test actual navigation, 8000-character URL boundary, successive selections and same-owner draft preservation, not only props. | `src/app/create/page.tsx:59`, `src/components/create/generator-studio.tsx:180`; AC10. |
| C3 | Guest public copy works; remix explains login then return/reselect, with no promised automatic recovery. Saved canvas mode persists; manual chat switch reveals prefill, without creating/filling canvas nodes; disabled canvas stays chat. | `src/components/create/hooks/use-studio-mode.ts:18`; AC11. |
| D1 | R6 matrix above, including actual props/raw RSC, owner/admin retained data and non-author 404; no video detail changes. | `src/app/works/[id]/page.tsx:50`; AC12-AC13. |
| F1 | Dark-coffee brand + three columns; exact existing /create, /prompts, /video, /works, /settings, authenticated /api-keys, GitHub and real section anchors; correct login/admin guards, no empty href/new policy/model/status pages. Inspect external href without network navigation. | `src/components/marketing/site-header.tsx:32`, `src/app/api-keys/page.tsx:20`; AC14. |

Motion tests should instrument live RAF/timer/observer/listener handles, mount/unmount twice, then advance fake time and dispatch stale events; absence of a React warning alone is not cleanup evidence. Use actual geometry/browser motion for visual claims; JSDOM and mocked Motion prove only state contracts. All missing assertions above are planned work, not existing passing tests.

### Related specs

- `.trellis/spec/frontend/quality-guidelines.md:35`: command gates, non-DB exclusions, separate build env, real-versus-fake browser evidence.
- `.trellis/spec/frontend/type-safety.md:44`: serialized DTOs and server/client boundary; `.trellis/spec/frontend/state-management.md:39`: initial props must not overwrite mounted drafts.
- `.trellis/spec/frontend/component-guidelines.md:53`: variants; line 71: accessibility; line 82: Motion. `.trellis/spec/frontend/hook-guidelines.md:34`: lifecycle cleanup.
- `.trellis/spec/operations/release-hardening.md:25`: temporary infrastructure and dotenv isolation; line 63: E2E prerequisite/transport/cleanup policy.
- `.trellis/spec/guides/cross-layer-thinking-guide.md:21`: source -> transform -> boundary -> display verification, not UI-only privacy assertions.

### External references / versions

- Declared stack: Next 16.2.4, React 19.2.4, Motion ^12.38.0, Vitest ^4.1.5, TypeScript ^5, pnpm 10.32.1 (`package.json:6`, `package.json:48`, `package.json:72`). No runtime versions were executed/verified.
- Not fetched: https://nextjs.org/docs/app/getting-started/server-and-client-components ; https://nextjs.org/docs/app/guides/testing/vitest ; https://vitest.dev/guide/cli . Async-page prop tests are not full Next/RSC integration tests.

## Caveats / Not Found

- Release-blocking privacy evidence is currently missing: the R6 leak is visible in source and remains unfixed. Public DTO projection, actual page-props regression tests and their passing results must exist before completion.
- Safe full-suite orchestration is not ready: current CI inherits env, DB preload blocks public `.env.example`, and build-only env must stay out of tests. Implement/audit the task-only runner first; never claim these current commands are automatically credential-safe.
- No reusable homepage browser fixture, checked-in browser runner dependency, or approved browser-on-E2E relay was found. Docker, local base/prebuilt images, cached build dependencies and browser binaries were not probed. Infrastructure gaps must be reported as not run, not replaced by a normal dev server with live configuration.
- Long prompt URLs, Next navigation caching and already-mounted chat drafts remain a real integration risk (`prd.md:106`). A passing initial-props test does not settle fresh-selection behavior; do not fix it by globally syncing props and erasing user drafts.
- Asset finding, reported by the parent after this inspection (not independently fetched here): original scene 2 returns 404; scenes 1/3 resolve to castle/game-controller images inconsistent with their prompts. The user has since approved three fixed replacement visuals depicting bookshop light, a lantern-carrying fox and a rainy eastern lane. Use those eventual real assets and loaded fonts; do not accept placeholders as completed visual fidelity.
- Existing mobile-canvas work and its resources are unrelated and must remain untouched. All proposed runners/fixture adaptations and every product check remain unimplemented/unrun in this research turn.
