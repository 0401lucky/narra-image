# Research: AI infinite-canvas application references

- Query: Which real GitHub AI-creation applications offer useful patterns for a switchable conversation/canvas image studio?
- Scope: external application references, with internal product/spec context
- Date: 2026-10-28
- Method: live GitHub repository/commit/tree API queries and commit-pinned raw source inspection; no application was installed or executed.

## Findings

### Decision-useful result

1. `basketikun/infinite-canvas` is a particularly close image-creation reference, but it is a complete application with a custom canvas, not an embeddable canvas SDK.
2. Its linked creative nodes and contextual assistant are different from a free-placement image board. Neither requires adopting a ComfyUI-style automation graph.
3. `tigerowo/infinite-canvas` explicitly builds on basketikun and HuFakai; it is a related variant, not independent evidence for a second design approach.
4. `fancyboi999/Loomic` independently demonstrates a spatial design board with chat and generated artifacts sharing one canvas. It is a useful contrast to linked nodes.
5. `binghe1980/AI-Canvas` independently demonstrates annotation-driven iterative image versions, but its MIT application license does not clear its separately licensed tldraw dependency for a production website.
6. None of the inspected references establishes the requested behavior that narra-image's existing conversation view and a new canvas must be interchangeable views of exactly the same content. That is a user-owned product decision, not an implementation fact obtained from these repositories.

### Verified repositories and snapshots

| Reference | Inspected commit | Commit date (UTC) | Root license | Verified stack / canvas engine |
| --- | --- | --- | --- | --- |
| [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) | `9cd3deacbcc598361807afc16c059a80dd18b6f9` | 2026-10-25 | MIT | React 19.2.5, Vite 7.3, React Router 7, Zustand 5, localForage 1.10; custom DOM/CSS-transform viewport and SVG connections |
| [tigerowo/infinite-canvas](https://github.com/tigerowo/infinite-canvas) | `e13006fbaeabe14e4a6d27cba667ff1473009ebc` | 2026-10-23 | AGPL-3.0 text | Next.js 16.2.9, React 19.2.5, Go/Gin/GORM, SQLite and media storage; related custom-canvas application |
| [fancyboi999/Loomic](https://github.com/fancyboi999/Loomic) | `21206c30054572291b9df000d84568aeca97aeda` | 2026-09-30 | MIT | Next.js 15, React 19, `@excalidraw/excalidraw ^0.18.0`, Fastify/LangGraph, Supabase/PostgreSQL |
| [binghe1980/AI-Canvas](https://github.com/binghe1980/AI-Canvas) | `9feadaa55fd133fb18caef5f0197cbe37351d510` | 2026-06-24 | MIT | React 18.3, Vite 6, `tldraw ^3.14.0`, local Express/WebSocket server and Codex/MCP integration |

These are activity signals and pinned observation points, not stability guarantees. Repository/package versions shown here are the inspected applications' declarations, not the latest upstream SDK releases. Star counts were not used as an architectural criterion.

### A. Closest linked creative-node reference: basketikun

Verified behavior:

- The canvas owns image, text, generation-configuration, video, audio, and group nodes, with prompt/model/size/count/reference/status metadata. `CanvasConnection` contains `fromNodeId` and `toNodeId`, rather than a scheduler contract [B2].
- Official feature documentation describes connecting prompts and reference media to generation nodes, generating/editing from references, preserving prompts/configuration for retries, and contextual assistance [B5]. The inspected sources show creative input relationships; full automatic DAG execution was not established by this research.
- Its canvas engine is custom: `InfiniteCanvas` implements pointer capture, viewport changes, wheel zoom, and a `translate(...) scale(...)` DOM transform at source line 226 [B3]. The project page imports its own node and SVG connection components, and `web/package.json` declares no React Flow, tldraw, or Konva package [B1, B4].
- A `CanvasProject` owns `nodes`, `connections`, `chatSessions`, `activeChatId`, and `viewport` together [B6, source lines 10-21]. The project page restores those fields together after local-store hydration [B4, source lines 449-458]. This is contextual chat *inside a canvas project*.
- The standalone image page is different: it uses its own `image_generation_logs` localForage store and `useWorkbenchAgentStore` [B8, source lines 21 and 66-68]. Do not cite this application as proof of a same-data conversation/canvas mode switch.
- Projects are browser-persisted, with optional WebDAV synchronization. Canvas JSON uses persistent media `storageKey` values; transient blob URLs are reconstructed on opening the project. Cleanup checks remaining references before removing stored blobs [B5, B7].
- Providers are called directly from the browser using locally stored user-provided credentials. The project is frontend-first, without built-in cloud accounts/storage [B5, source lines 28-33 and 63-67]. This differs materially from narra-image's authenticated generation/worker architecture.

Patterns worth borrowing, not copying wholesale:

- Selected-image/reference context appears close to the user's generation action.
- Source media, prompt/settings, pending/error/result states, and retry provenance remain visible and associated.
- Layout state is distinct from media identity; a saved object URL is not treated as a durable asset identifier.
- Canvas projects encapsulate viewport and contextual conversations instead of leaking state across unrelated projects.
- Simple pan/select tools and a fit/reset control give users an escape from a lost viewport.

Patterns to avoid importing into this task:

- Its entire 3,476-line project-page orchestration, global stores, local-provider credentials, plugin/MCP runtime, separate image logs, or WebDAV synchronization subsystem.
- Its reference-based media deletion behavior: narra-image currently preserves generation images independently of conversation deletion, so a canvas-node deletion must not silently inherit another application's asset-deletion semantics.
- Its README warning that historical/local-storage formats may change incompatibly [B9]. A mature site's persistence must instead define an additive/versioned compatibility contract.

### B. Related cloud/backend variant: tigerowo

- README source line 78 explicitly says the application is based on basketikun's frontend-only project plus HuFakai image-generation enhancements [T1]. GitHub's `fork: false` metadata does not override that explicit provenance.
- It adds a Next.js/Go backend architecture, SQLite, local IndexedDB, and S3/R2 support [T1, source lines 102-107; T2].
- Its documented `CanvasProject` also contains nodes, connections, assistant sessions, and viewport; generation inputs are derived through connections [T3].
- Root LICENSE contains AGPL version 3 text [T4], unlike basketikun's MIT root license. Similar filenames/UI do not imply identical terms or safe substitution.

Use it as evidence for how a linked canvas can acquire server persistence, not as a reason to replace narra-image's Prisma/PostgreSQL and existing Go generation worker. Its own README also warns that data/storage formats may change incompatibly.

### C. Independent spatial-board/chat contrast: Loomic

Verified behavior:

- Loomic presents a conversation-driven creative board where generated images/videos are placed onto the canvas [L1]. This is a spatial composition model; drawn arrows or shapes are not, by themselves, generation-dependency edges.
- It embeds Excalidraw using a Next.js dynamic import with `ssr: false` [L3, source lines 18-20]. The canvas scene consists of `elements`, `appState`, and `files`, and can report selected elements to the surrounding application [L3].
- Canvas content is persisted as JSONB in `public.canvases.content` [L5]. Chat sessions have a `canvas_id` foreign key, and messages belong to those sessions [L6, source lines 2-11 and 20-29]. This verifies shared canvas/chat ownership, not an independently managed global history gallery.
- The canvas page composes `ChatSidebar` and `CanvasEditor`, carries canvas/project IDs, receives generated artifacts, and inserts them into the canvas [L4]. It also has explicit fallback generation-status polling rather than treating a visible canvas as the generation backend.
- Its editor comments and guards document an important failure mode: an early empty `onChange` during editor hydration can otherwise overwrite saved canvas content. Auto-save is gated until hydration [L3, source lines 95-99 and 216-220].
- Backend dependencies include Fastify, LangGraph, Supabase auth/storage, and workers/queue infrastructure [L1, L2]. They are not required merely to borrow the board interaction model.

Useful narra-image patterns:

- Let the canvas display the same generation artifacts as the chat without requiring manual image re-import, if the user chooses shared content.
- Keep reference/selection context explicit and let an optional collapsed chat/composer panel coexist with free image placement.
- Preserve authenticated ownership, durable asset references, and hydration-safe saving.

Do not add an agent runtime, drawing/brand-kit tools, subscription system, collaborative workspace model, or a Supabase backend merely because the reference includes them. Excalidraw's suitability for custom HTML prompt/status cards is a separate library-level question covered by `canvas-library-comparison.md`.

### D. Independent iterative-version/annotation contrast: AI-Canvas

- Its README describes a local canvas for generated images, annotations, selected-image editing, and side-by-side new versions; old images are retained and the new output is placed to the original's right [A1, source lines 43-52 and 87-107].
- The canvas application really imports tldraw and snapshots its editor store; it is not simply a README-only engine claim [A2, A3].
- It is designed around a local Codex plugin/MCP/image-adapter service, rather than narra-image's website authentication and generation APIs [A1, A2].
- The root application is MIT [A4], but its declared dependency is `tldraw ^3.14.0` and React 18.3 [A2]. This report has not cleared the exact locked tldraw version's production rights. Consult the independently verified current SDK restrictions in `canvas-library-comparison.md`; never infer production permission from the application's MIT badge.

Borrow the interaction idea of preserving old versions and making new outputs easy to compare. Annotation editing, masks, arbitrary drawing, local Codex integration, and business-skill workflows are separate product features, not implied by "infinite canvas."

## Product Direction Options (Engineering Judgment)

| Direction | Observable experience | Main benefit | Cost / trade-off |
| --- | --- | --- | --- |
| Spatial image board plus contextual creation | Freely move/resize images; select reference images; generate from a composer; results appear nearby; no semantic edges required | Smallest change to an image studio and easiest side-by-side comparison | Relationships are implicit unless separately shown; drawing/photo-editor tools remain separate scope |
| Linked creative-node workspace | Prompt/reference/settings/result cards can connect; upstream nodes determine a generation's inputs; each generation can still run individually | Explicit provenance and branching iterations, closer to basketikun | Requires edge/reference semantics, invalid-link/cycle handling, draft-node behavior, and chat/canvas conversion decisions |
| Automation DAG | Nodes define executable workflows with graph-wide run/queue behavior | Repeatable pipelines and complex batch automation | Adds a workflow execution engine, validation/scheduling/failure/cost semantics; much larger than a view toggle |

Small-first recommendation, pending the user's choice:

- Treat the requested canvas as a second *creation surface*, not a replacement generation backend.
- Reuse narra-image's existing authenticated submit/poll/media lifecycle and preserve the conversation view.
- Start with pan/zoom, image placement, explicit reference selection, pending/error/result visibility, fit-view, and durable layout. Add linked creative cards only if the user wants input relationships to be visible/editable; do not infer an automation DAG.
- If the user chooses shared content, one authoritative generation identity must project into both views; a view switch must not resubmit jobs, duplicate outputs, reset drafts, or cancel polling. The references supply interaction evidence, but this shared-mode contract still needs design in narra-image.
- Removing the history rail should free the creation surface, not silently remove existing images or the separate works page. Confirm the exact product boundary; current code/spec evidence is documented by the local studio researcher.

## Internal Context / Related Specs

- `docs/superpowers/specs/2026-06-01-video-workspace-design.md:13` mentions an owner-unspecified `infinite-canvas`; source line 33 excludes canvas from that earlier *video-workspace* scope. It neither identifies basketikun nor forbids the user's new image-studio request.
- `src/components/create/generator-studio.tsx` already composes conversation, composer, history, session, and polling responsibilities. Use `research/current-studio.md` as the authoritative local integration map.
- `.trellis/spec/frontend/state-management.md:78` requires active-conversation scoping, forbids global history fallback, and documents hydration-safe initialization.
- `.trellis/spec/frontend/directory-structure.md` defines feature container/parts/hooks boundaries.
- `.trellis/spec/operations/media-storage.md` governs generated-media persistence; external browser-blob cleanup is not a replacement for those contracts.
- `research/canvas-library-comparison.md` owns SDK selection, React/Next compatibility, and separately verified infrastructure-license restrictions.

## Primary Source Register

Source references are commit-pinned so subsequent repository changes cannot silently alter the evidence.

### Basketikun

- B1: [web/package.json](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/package.json)
- B2: [Canvas node/connection/session types](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/types/canvas.ts)
- B3: [Custom viewport engine](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/components/canvas/infinite-canvas.tsx)
- B4: [Canvas project orchestration](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/pages/canvas/project.tsx)
- B5: [Official feature documentation](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/docs/content/docs/overview/features.mdx)
- B6: [Canvas project persistence store](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/stores/canvas/use-canvas-store.ts)
- B7: [Storage/media/session data structure](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/docs/content/docs/development/canvas-data-structure.mdx)
- B8: [Separate image workbench/log storage](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/pages/image/index.tsx)
- B9: [README and compatibility warning](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/README.md)
- B10: [MIT LICENSE](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/LICENSE)

### Tigerowo Variant

- T1: [README: origin and stack](https://github.com/tigerowo/infinite-canvas/blob/e13006fbaeabe14e4a6d27cba667ff1473009ebc/README.md)
- T2: [Web package declarations](https://github.com/tigerowo/infinite-canvas/blob/e13006fbaeabe14e4a6d27cba667ff1473009ebc/web/package.json)
- T3: [Documented canvas data model](https://github.com/tigerowo/infinite-canvas/blob/e13006fbaeabe14e4a6d27cba667ff1473009ebc/docs/backend/canvas-data-structure.md)
- T4: [AGPL LICENSE](https://github.com/tigerowo/infinite-canvas/blob/e13006fbaeabe14e4a6d27cba667ff1473009ebc/LICENSE)

### Loomic

- L1: [README: product and architecture](https://github.com/fancyboi999/Loomic/blob/21206c30054572291b9df000d84568aeca97aeda/README.md)
- L2: [Web package declarations](https://github.com/fancyboi999/Loomic/blob/21206c30054572291b9df000d84568aeca97aeda/apps/web/package.json)
- L3: [Canvas editor: dynamic import, files, save/hydration guards](https://github.com/fancyboi999/Loomic/blob/21206c30054572291b9df000d84568aeca97aeda/apps/web/src/components/canvas-editor.tsx)
- L4: [Canvas page: contextual chat and artifact insertion](https://github.com/fancyboi999/Loomic/blob/21206c30054572291b9df000d84568aeca97aeda/apps/web/src/app/canvas/page.tsx)
- L5: [Canvas content JSONB migration](https://github.com/fancyboi999/Loomic/blob/21206c30054572291b9df000d84568aeca97aeda/supabase/migrations/20260323000004_canvas_content.sql)
- L6: [Canvas-owned chat sessions migration](https://github.com/fancyboi999/Loomic/blob/21206c30054572291b9df000d84568aeca97aeda/supabase/migrations/20260323000006_chat_sessions.sql)
- L7: [MIT LICENSE](https://github.com/fancyboi999/Loomic/blob/21206c30054572291b9df000d84568aeca97aeda/LICENSE)

### AI-Canvas

- A1: [README: annotation and iterative-version interaction](https://github.com/binghe1980/AI-Canvas/blob/9feadaa55fd133fb18caef5f0197cbe37351d510/README.md)
- A2: [Canvas application package: React 18 / tldraw 3.14](https://github.com/binghe1980/AI-Canvas/blob/9feadaa55fd133fb18caef5f0197cbe37351d510/ai-canvas-codex-plugin/packages/canvas-app/package.json)
- A3: [Canvas application: editor and snapshot implementation](https://github.com/binghe1980/AI-Canvas/blob/9feadaa55fd133fb18caef5f0197cbe37351d510/ai-canvas-codex-plugin/packages/canvas-app/src/App.tsx)
- A4: [MIT LICENSE](https://github.com/binghe1980/AI-Canvas/blob/9feadaa55fd133fb18caef5f0197cbe37351d510/LICENSE)

## Caveats / Not Found

- No browser, mobile, accessibility, image-provider, performance, or end-to-end behavior was tested. Described behavior is source/documentation evidence, not a hands-on claim.
- Initial GitHub search also surfaced Toonflow and older demos. They were not expanded into implementation candidates because the close reference and two independent contrasts already answer the scoped question; broad popularity is not proof of fit.
- Some raw GitHub fetches initially failed with transient TLS EOF errors; the cited core sources were successfully retrieved on retry. Search/core GitHub API access worked during this research.
- The historical video document names no repository owner. No claim is made that it referred to any specific repository listed here.
- Root-license observations are not legal advice or a full dependency/asset/source audit. MIT requires preservation of copyright/permission notices; basketikun's README separately asks forks/PRs to preserve author information and frontend identification. Third-party prompts, fonts, assets, plugins, and SDKs require their own checks before any code reuse.
- SDK version compatibility and production licensing cannot be inferred from an application README or a public GitHub repository. In particular, the inspected AI-Canvas application uses older tldraw/React versions; this does not waive current or version-specific SDK restrictions.
- User intent remains unresolved: free-placement board versus semantic creative nodes, shared versus independent workspace contents, history-removal boundary, and first-version canvas/persistence actions. No product code or existing data was changed.
