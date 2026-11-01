# Research: Infinite-canvas infrastructure libraries

- Query: Which maintained canvas infrastructure fits a switchable conversation / image-creation canvas in this repository?
- Scope: mixed; primary external sources plus repository integration constraints.
- Date: 2026-10-28.
- Status: research only; no dependency installation, product code, database change, browser prototype, or implementation approval.

## Findings

### Short Recommendation

- For custom prompt, reference-image, processing, and result cards, `@xyflow/react` is the strongest default infrastructure candidate. Its nodes render ordinary React/DOM content, its viewport and node placement are infinite by default, and its core is MIT. It can serve an image-only board with `edges=[]`; using it does not require an automation graph or a new backend.
- For a deliberately minimal image arrangement board, `react-zoom-pan-pinch` plus custom DOM cards is a plausible lighter alternative. It supplies viewport gestures, not a complete editor; selection, card dragging/resizing, keyboard operation, undo, and connections become application responsibilities.
- If the product goal is predominantly sketching, annotating, and assembling a moodboard, Excalidraw deserves a spike. It is MIT and has a complete drawing-editor interaction model, but its public scene APIs are not a drop-in replacement for React Flow's arbitrary interactive React nodes.
- tldraw is technically a strong general canvas/custom-shape option, but the current SDK is source available, not MIT/open source. The default license prohibits production; a separate, active trial/commercial/discretionary hobby license is required. Do not make it the default dependency for this AGPL application without a deliberate licensing decision.
- Konva is appropriate for a custom raster/vector design editor or image manipulation surface, not the quickest path to reuse the studio's DOM composer/actions. Its latest React wrapper also requires a newer React minor than this app uses.

These are technical recommendations, not a decision about whether the user wants a spatial image board or linked creative cards. Neither concept necessarily means an executable DAG.

### Verified Package And License Snapshot

The versions below were read from the live npm registry on the research date, not inferred from older READMEs. A peer range being satisfied is not a completed integration test.

| Candidate | Published version checked | React / React DOM peers | Current license and immediate implication |
| --- | --- | --- | --- |
| `@xyflow/react` | `12.12.0` | `>=17`; corresponding type peers also `>=17` | MIT in npm metadata and the published `package/LICENSE`; production/commercial core use does not require Pro. |
| `tldraw` | `5.5.2` | `^18.2.0 || ^19.2.1` | `SEE LICENSE IN LICENSE.md`; package refers to tldraw's restrictive root license. Default permission is development only. Node engine is `>=22.12.0`. |
| `@excalidraw/excalidraw` | `0.18.1` | `^17.0.2 || ^18.2.0 || ^19.0.0` | MIT in npm metadata and current source root license. |
| `react-konva` latest | `19.3.2` | `^19.3.0` | MIT; **does not satisfy this app's React `19.2.4`**. Konva peer accepts 7.2.5/8/9/10 ranges. |
| `react-konva` matching candidate | `19.2.7` | `^19.2.0` | MIT in version metadata; matching minor for the app if Konva is selected. Do not install an unpinned latest wrapper or upgrade React solely by accident. |
| `react-zoom-pan-pinch` | `4.2.0` | `*` | MIT in npm metadata, source, and published `package/LICENSE`; no runtime `dependencies` entry in the checked metadata. Broad peers still require a real React 19 gesture test. |

Current app evidence: `package.json:5` declares `AGPL-3.0-only`; `package.json:47`, `package.json:49`, and `package.json:50` fix Next.js 16.2.4 / React 19.2.4 / React DOM 19.2.4.

Reproducibility anchors:

- React Flow source branch commit checked: `bb63f4cc345acf4e6c73e0371be3ea3ca01b2a18` (2026-10-26). Its npm `12.12.0` metadata does not publish `gitHead`; the exact tarball URL/integrity and published license are recorded in the source snapshot. Do not assume the branch commit is the package release commit.
- tldraw `5.5.2` npm `gitHead`: `be4d5b30cbf896c92436d634e59843a920705cef`. The root license was fetched at this exact commit as well as from the current branch.
- Excalidraw source branch commit checked: `14bb42edee3d6fee6be264e3ee78670b3b9cee79` (2026-10-27). npm `0.18.1` has no `gitHead`; this is a current-source license anchor, not an asserted release commit. The tarball was inspected but no root license file matched the inspected filenames; npm and source licensing are the positive evidence.
- React Konva `19.3.2` npm `gitHead`: `c89132f5c9ac5a47db1c7c6b6fd1012452df2e01`. The compatible `19.2.7` metadata has no `gitHead`; its exact tarball integrity is recorded.
- `react-zoom-pan-pinch` `4.2.0` npm `gitHead`: `34abc1ffbc124f2adf9c959f81ce6c6f2c2f219f`.

### License Gates That Affect This Project

#### React Flow Core Is Not React Flow Pro Example Code

The root MIT license permits use, modification, distribution, and sale subject to retaining its copyright/permission notice. The official Pro page explicitly says the library remains MIT.

The official undo/redo example is separately labelled **"License: xyflow Pro License"** and describes a snapshot-based `useUndoRedo` hook. It is a subscription example, not a built-in core hook that can be assumed freely copyable. Advanced templates, collaborative examples, or Pro samples require separate review. Node resizing, custom nodes, ordinary edges, pan/zoom, selection, and the public APIs are core infrastructure; a Pro subscription is not needed simply to build this studio.

If layout undo is in scope, write a small domain-specific implementation from requirements, or obtain the relevant Pro rights. Never copy a paid sample because the base package is MIT. Preserve third-party notices in any eventual dependency/license inventory.

Sources:

- https://github.com/xyflow/xyflow/blob/bb63f4cc345acf4e6c73e0371be3ea3ca01b2a18/LICENSE
- https://reactflow.dev/pro
- https://reactflow.dev/examples/interaction/undo-redo

#### tldraw Does Not Provide Automatic Free Production Use

The exact release-linked root license defines production as functionality offered to end users/customers/the public and explicitly requires not using the SDK there under default terms. It also prohibits interfering with license-key enforcement, relabeling the SDK under superseding terms, or distributing it as a standalone product. It permits modification and development use, but those permissions do not grant production deployment.

The official license page clarifies the available alternatives:

- A free **100-day trial**, limited to one trial per commercial unit; it expires and cannot be treated as a permanent production license.
- A separate commercial license, with pricing through the provider.
- A **discretionary** hobby license for non-commercial projects, with the "made with tldraw" watermark. It must be requested; it is not automatically granted by publishing an open-source repo.
- A valid active key is required in production. The SDK key itself is public/client-validated, not an API-provider secret.
- The page says commercial/hobby use sends no information to tldraw; trial use pings a hash of the key, not canvas contents or PII. The license text retains technical-enforcement/usage-data provisions, so confirm actual deployment terms rather than making a blanket telemetry promise.
- An open-source application may include the SDK only under its original terms; its downstream deployers need their own production licenses. The app's AGPL declaration is not a license for the SDK. Compatibility/distribution needs explicit review, not an automatic assumption from an AI-canvas app having an MIT root license.

Sources:

- https://github.com/tldraw/tldraw/blob/be4d5b30cbf896c92436d634e59843a920705cef/LICENSE.md
- https://github.com/tldraw/tldraw/blob/be4d5b30cbf896c92436d634e59843a920705cef/packages/tldraw/LICENSE.md
- https://tldraw.dev/community/license

### Infrastructure Comparison

| Concern | React Flow | tldraw | Excalidraw | React Konva | Lean DOM pan/zoom |
| --- | --- | --- | --- | --- | --- |
| Native content model | Custom React/DOM nodes plus optional edges | JSON shapes with custom `ShapeUtil`, including `HTMLContainer` rendering | Drawing elements, image files, app state and configurable editor UI | Canvas scene-graph shapes via a separate React renderer | Arbitrary HTML inside a transformed container |
| Prompt/reference/result cards | Direct fit | Technically direct with custom shapes; license gate | Usually app-controlled panels/overlays rather than arbitrary React components inside scene elements | Requires DOM overlays/portal machinery for rich input controls | Direct HTML fit, but all editor semantics are custom |
| Image-only spatial board | Strong; hide graph chrome and use no edges | Strong | Strong when annotation/sketching is intended | Strong if custom graphics are central | Good for a deliberately small scope |
| Linked creative nodes | Strong typed edges/handles; no scheduler supplied | Custom bindings/arrows and app semantics | Diagram/arrow visuals, application-owned generation semantics | Custom SVG/canvas graph and hit-testing logic | Entire connection model/rendering owned by app |
| Pan/zoom and touch | Core viewport; explicit zoom/pan props, pinch, tap-to-connect | Full editor camera/input model | Full editor UI; touch behavior must be spiked with embedded composer | Gesture logic assembled by the application | Library handles viewport gestures; card/editor gestures remain app-owned |
| Resize / selection | Core resizer and node-selection APIs | Editor/custom-shape behavior | Built-in drawing-element interactions | Transformer/shape events, application selection model | Application implementation |
| Persistence | `nodes`, `edges`, `viewport` via controlled state / `toObject`; application chooses storage | Document/session snapshots, migrations, local IndexedDB and configurable asset store | Scene/app state plus a separate files map via public APIs | Application model is persisted; do not use canvas serialization as the job database | Application layout and camera model |
| Undo / redo | Application domain history; published advanced example is Pro | Editor history is part of the SDK feature model | Editor history plus `captureUpdate` controls for app-driven changes | Application history | Application history |
| Keyboard / accessibility | Documented tab-focus, selection, arrow movement, ARIA/localization support | SDK feature surface includes accessibility; custom controls still need review | Embedded editor has its own interaction model; custom generation UX still needs review | Canvas shapes are not ordinary semantic DOM controls; equivalent accessible controls are app work | All editor-level keyboard/selection semantics are app work |
| Frontend deployment | React 19 peer satisfied; SSR is supported since v12 with explicit dimensions/handles | React 19 peer satisfied; browser editor/store isolation and licensing setup still needed | Official docs explicitly require client-only dynamic loading | Use matching wrapper minor; current README says Konva 10+ works with a Client Component without native canvas setup | Broad React peers; browser measurements and persistence must occur after mount |

The comparison describes public APIs and engineering fit, not measured bundle size, benchmark throughput, or a tested product integration.

### React Flow Details

Verified capabilities and constraints:

- Custom node components can render inputs/charts/interactive React content. The official example uses `className="nodrag"` for an input and keeps `nodeTypes` outside the component for stable identity.
- The public React Flow API says `translateExtent` defaults to an infinite viewport and `nodeExtent` permits placement on an infinite flow. Infinity is therefore not just a metaphor for a very large fixed canvas.
- `zoomOnPinch` is a public core prop, defaulting to true. `connectOnClick` allows tapping a source and a target. These are capabilities, not proof that a dense studio is usable on a phone.
- The core `NodeResizer` example is public. Display-card dimensions should remain distinct from the generated file's `actualWidth`/`actualHeight` metadata.
- `toObject` or controlled `nodes`/`edges` can save/restore the diagram. Restoring job progress still requires this app's authenticated backend/poller.
- React Flow 12 supports SSR when node dimensions, handle positions, and viewport sizing are supplied. Client-only lazy loading is nevertheless a sensible **integration choice** here, not a claim that the library cannot SSR.
- `onlyRenderVisibleElements` defaults to false. The docs explicitly say culling may improve performance but adds overhead. Measure before enabling it indiscriminately.
- The official accessibility guide describes tab navigation, enter/space selection, escape deselection, arrow-key movement, auto-panning on focus, configurable roles, and `ariaLabelConfig`. Preserve these and localize instructions to Chinese instead of building pointer-only cards.
- Current npm metadata lists internal `zustand`, `classcat`, and `@xyflow/system` dependencies. An internal canvas store does not require moving the application's session, credentials, credits, or generation lifecycle into a new global Zustand store.

Primary sources:

- https://reactflow.dev/learn/customization/custom-nodes
- https://reactflow.dev/api-reference/react-flow
- https://reactflow.dev/examples/nodes/node-resizer
- https://reactflow.dev/examples/interaction/touch-device
- https://reactflow.dev/examples/interaction/save-and-restore
- https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration
- https://reactflow.dev/learn/advanced-use/accessibility
- https://reactflow.dev/learn/advanced-use/performance

### tldraw Details If Licensing Is Deliberately Accepted

- Custom shapes are JSON records with validation and `ShapeUtil` implementations. `HTMLContainer` allows React/DOM content, so it is not limited to painted graphics.
- `persistenceKey` saves documents/assets to IndexedDB and synchronizes browser tabs. Sharing a key shares a document; keys must be scoped to user/workspace, not a single unqualified app-wide key.
- `getSnapshot` / `loadSnapshot` separate document content from session state such as camera/selection. Loading a snapshot replaces the document and must not run every time generation props refresh.
- `TLAssetStore` lets the app control image upload and URL resolution. In-memory defaults use base64 data URLs; local persistence uses IndexedDB; remote sync requires an application asset store. Local persistence is not account-backed cross-device persistence.
- `resolve` receives scale/DPR context for optimized image resolutions. That is an available integration hook, not evidence this repository already has a thumbnail service.
- A sync demo room is not this application's authenticated production data model. Do not send private studio content to a demonstration collaboration service by default.

Sources:

- https://tldraw.dev/docs/shapes
- https://tldraw.dev/docs/persistence
- https://tldraw.dev/docs/assets

### Excalidraw Details

- Official embedding docs say it does not support SSR. In App Router, use a `"use client"` wrapper dynamically imported with `ssr: false`, including any utility imports in that wrapper. This matches an existing pattern in the studio rather than requiring a page rewrite.
- Its containing block must have nonzero dimensions. A disappearing canvas in a responsive/flex layout is an integration risk worth testing.
- Fonts load from a CDN by default. Official docs document self-hosting the font files and configuring `window.EXCALIDRAW_ASSET_PATH`; consider deployment, CSP, and external-asset policy before shipping.
- `updateScene`, `addFiles`, `getSceneElements`, `getAppState`, `getFiles`, `history.clear`, and `captureUpdate` are public integration APIs. Canvas element state and image-file data have distinct persistence paths; saving element positions alone does not preserve imported files.
- This package internally uses Jotai and other drawing dependencies. Do not interpret adopting it as permission to create a second application-wide source of truth for jobs.
- Its drawing/annotation look is an intentional interaction model. Replacing it with brand-specific live prompt/result cards would need a prototype and may cost more than a DOM-node editor.

Sources:

- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api

### React Konva And Lean Pan/Zoom Details

React Konva:

- The current primary README describes a declarative canvas scene graph for design editors, whiteboards, diagrams, and annotations. It explicitly maps React 19.3 to wrapper 19.3 and React 19.2 to wrapper 19.2.
- A `Stage` creates a separate canvas React root. Native HTML composers/buttons cannot simply be rendered as ordinary canvas shapes; app-controlled DOM overlays or portal infrastructure would be needed for the studio controls.
- Current upstream documentation says Konva 10+ can work in Next.js using a Client Component without native `canvas` setup; earlier Konva versions need additional setup or disabled SSR. Do not reproduce outdated Next.js instructions blindly.
- Wrapper "strict mode" (reapplying declared shape properties) is not React `StrictMode`. Drag/transform state must be committed to the app model or later React updates may overwrite interactive changes.
- Remote raster export requires a separate review of browser canvas/CORS rules; ordinary DOM image display and reusing the existing download action are different operations. The Konva hosted docs links failed certificate validation during this research, so no specific tainted-canvas helper implementation is asserted here.

Lean pan/zoom:

- `react-zoom-pan-pinch` provides `TransformWrapper`, `TransformComponent`, and hooks for viewport zoom/pan/pinch over HTML content. MIT/no runtime dependency metadata makes it a useful minimal-board spike candidate.
- It does not itself define image-card selection, card resize, persistent layout, clipboard, generation, edges, hit testing, or editor history. A lightweight viewport package can turn into a large custom editor once these are added.
- Build screen-to-world coordinate conversion, drag-versus-pan ownership, selection hit testing, and viewport reset intentionally; never use screen-pixel deltas directly after zooming.
- The closer AI-canvas application references investigated by the separate application researcher use custom DOM/CSS transforms and SVG connections. They are UX/data-model references, not proof that React Flow or tldraw can be lifted from those apps as a dependency.

Sources:

- https://github.com/konvajs/react-konva
- https://github.com/konvajs/react-konva/blob/c89132f5c9ac5a47db1c7c6b6fd1012452df2e01/LICENSE
- https://registry.npmjs.org/react-konva/19.2.7
- https://github.com/BetterTyped/react-zoom-pan-pinch
- https://github.com/BetterTyped/react-zoom-pan-pinch/blob/34abc1ffbc124f2adf9c959f81ce6c6f2c2f219f/LICENSE
- Companion report: `research/ai-canvas-references.md` (owned by the application researcher; contains the application-specific source anchors and licensing distinctions).

## Repository Integration Boundaries

Relevant files read, with their purpose:

| File | Evidence and relevance |
| --- | --- |
| `package.json:5` | App's AGPL declaration; evaluate third-party SDK terms separately. |
| `package.json:47` | Next.js version and App Router integration constraints. |
| `package.json:49` | Existing React version; do not assume latest Konva wrapper matches it. |
| `src/components/create/generator-studio.tsx:49` | Existing `next/dynamic` / `ssr: false` named-component loading pattern. |
| `src/components/create/generator-studio.tsx:108` | Custom provider draft includes an API key; do not persist complete studio/node state. |
| `src/components/create/generator-studio.tsx:143` | Reference-images hook already owns runtime files/object URLs. |
| `src/components/create/generator-studio.tsx:158` | Parent-owned active-session generation list. |
| `src/components/create/generator-studio.tsx:263` | Existing shared generation poller integration. |
| `src/components/create/generator-studio.tsx:575` | Existing submission orchestration should remain the generation path for both views. |
| `src/components/create/generator-studio.tsx:1016` | Present conversation renderer boundary. |
| `src/components/create/types.ts:17` | Actual generated-image dimensions are metadata, not canvas display dimensions. |
| `src/components/create/types.ts:33` | Existing `GenerationItem` business model and backend identifiers. |
| `src/components/create/types.ts:91` | Runtime `ReferenceImage` contains `File`/preview URL; not a durable JSON asset model. |

Engineering recommendations, to be finalized after product decisions:

1. Keep generation/session/reference/provider business state and side effects in a shared studio controller. Mount/switch view renderers underneath it, not two separate studios with separate submission and polling lifecycles.
2. Maintain an explicit domain layout model: schema version, workspace/conversation ID, card IDs/kinds, positions, display dimensions, z-order, viewport, and optional creative relationships. Resolve generation/image IDs from authenticated server state rather than serializing an entire library editor store.
3. Never store provider API keys, transient `File` objects, object URLs, form callbacks, or signed/temporary media links as durable canvas truth. Treat signed link refresh and durable image ownership separately from layout.
4. Keep the backend-generated job/image status authoritative. View switching or offscreen node unmounting must not cancel/restart the shared poller or submit an additional billable job.
5. Layout deletion/undo should not automatically delete/refund/cancel a server generation. If those actions are wanted, they require explicit separate product/API semantics.
6. Use existing generation/reference/reuse/download actions for cards. Optional connecting a generated image to a prompt may express reference lineage; automatically executing downstream chains is a different product and backend problem.
7. Protect interactive inputs and scrollable prompt areas from canvas drag/wheel handlers. With React Flow, use a deliberate drag handle and applicable `nodrag`/`nopan`/`nowheel` utility classes; test IME input, textarea scrolling, touch and keyboard focus.
8. Match the established app visual language rather than adopting a library's default diagram/whiteboard skin. Preserve Chinese button/ARIA text, existing settings behavior and mobile composer constraints.
9. If both modes share content, view changes must not reconstruct content from the cross-conversation recent-history array. Conversation selection and refreshed server props must preserve the current local scope/layout.
10. For large image boards, distinguish display-size optimization from media persistence. Lazy loading/culling and thumbnail derivatives should be measured and explicitly designed, not asserted as existing capabilities.

The local architecture researcher owns the exact history-removal/data-query/API/test map; this report does not reclassify the page's recent-50 generation query as rail-only.

## Narrow Technical Spike Checklist

Only run after the user approves the product direction and authorizes the next implementation/prototype phase. No spike has been run in this research turn.

- Render one prompt textarea, one uploaded reference, one pending generation, and multiple image results inside the candidate viewport. Verify click actions, Chinese IME, textarea scrolling, and drag handles at several zoom levels.
- Run a generation through the existing shared submission/poller path; switch conversation/canvas during pending state, completion, failure, credit refresh, and active-session changes. Confirm one submission and no duplicate billable job.
- Drag and resize at zoom 0.25 / 1 / 2; save and restore negative coordinates and camera state. Ensure fresh generations do not reset manually arranged cards.
- Test phone pinch/pan, tap selection/reference actions, keyboard appearance, desktop wheel/trackpad, and keyboard-only access. Define whether full canvas editing or a reduced mobile interaction model is required.
- Test initial mount, lazy-load failure/retry, navigation and `router.refresh()` without hydration errors or local layout being overwritten by server snapshots.
- Compare 50 and 200 realistic cards, with large remote images and pending updates; measure initial load, gesture responsiveness, memory, image decoding and culling costs. These are suggested stress cases, not a claimed capacity guarantee or final acceptance threshold.
- Round-trip a deliberately small versioned layout DTO; reject malformed/oversized documents and unauthorized generation/image references. Confirm no API keys or object URLs enter persisted JSON.
- Confirm chosen package versions and dependency notices, React peers, production license rights, self-hosted assets/CSP, and optional Pro-sample rights before any production dependency is committed.

## Related Specs

- `.trellis/spec/frontend/index.md`: package/layer guide index.
- `.trellis/spec/frontend/directory-structure.md`: feature-local hooks/parts and server/client boundaries.
- `.trellis/spec/frontend/component-guidelines.md:80`: container wiring versus feature parts; `next/dynamic` pattern at line 82.
- `.trellis/spec/frontend/component-guidelines.md:73`: semantic roles, decorative icon handling and Chinese ARIA labels.
- `.trellis/spec/frontend/state-management.md:10`: no existing application-wide state library.
- `.trellis/spec/frontend/state-management.md:37`: shared state belongs in the feature container.
- `.trellis/spec/frontend/state-management.md:41`: fresh server-prop identities are not ongoing local UI truth.
- `.trellis/spec/frontend/state-management.md:74`: localStorage must not be read during SSR/render initialization.
- `.trellis/spec/frontend/state-management.md:78`: global recent generations cannot be a local-workspace fallback.
- `.trellis/spec/frontend/hook-guidelines.md:36`: cleanup for timers/listeners/object URLs; applies to view switching and culling.
- `.trellis/spec/frontend/hook-guidelines.md:54`: existing polling lifecycle/terminal stop semantics.
- `.trellis/spec/operations/media-storage.md`: relevant if a later design adds thumbnails/uploads/storage changes; no media-storage modification is proposed as already necessary.

## Primary Source Inventory

Package metadata URLs (fetched live):

- https://registry.npmjs.org/@xyflow%2Freact/latest
- https://registry.npmjs.org/tldraw/latest
- https://registry.npmjs.org/@excalidraw%2Fexcalidraw/latest
- https://registry.npmjs.org/react-konva/latest
- https://registry.npmjs.org/react-konva/19.2.7
- https://registry.npmjs.org/react-zoom-pan-pinch/latest

Current source licenses for the MIT alternatives:

- https://github.com/xyflow/xyflow/blob/bb63f4cc345acf4e6c73e0371be3ea3ca01b2a18/LICENSE
- https://github.com/excalidraw/excalidraw/blob/14bb42edee3d6fee6be264e3ee78670b3b9cee79/LICENSE
- https://github.com/konvajs/react-konva/blob/c89132f5c9ac5a47db1c7c6b6fd1012452df2e01/LICENSE
- https://github.com/BetterTyped/react-zoom-pan-pinch/blob/34abc1ffbc124f2adf9c959f81ce6c6f2c2f219f/LICENSE

`canvas-library-source-snapshot.json` stores fetched URLs/text, registry version/peer/license/dist metadata, release/branch anchors, published license-file checks, and failed-source notes. Exact package metadata/tarball integrity is the release evidence when `gitHead` is absent. Mutable official docs are dated as retrieved, not treated as pinned source commits.

## Caveats / Not Found

- No library was installed and no browser/build/typecheck/performance prototype was run. React 19 support above is verified metadata/official guidance, not empirically verified app compatibility.
- Product decisions are unresolved: spatial images versus linked creative cards, shared versus independent content, persistence guarantees, mobile editing depth, and first-version actions. The recommendation must remain conditional.
- There is no canvas position/camera persistence model in the app according to the companion local architecture research. Libraries do not create authenticated cross-device persistence merely by offering JSON snapshots.
- tldraw licensing is a material production/distribution decision. Public source visibility and a reference app's root MIT license do not remove the underlying SDK's restrictions. This is engineering risk identification, not legal advice.
- React Flow Pro sample rights are separate from core MIT. Its official paid undo-redo sample must not be copied without the appropriate rights.
- `react-konva@latest` does not match existing React 19.2.4. A matching 19.2 wrapper is available; no React upgrade was performed or recommended merely to silence a peer conflict.
- Konva hosted DOM-portal/tainted-canvas pages failed TLS certificate validation; attempted source fallback paths returned 404. TLS verification was not disabled. Primary README/metadata/license evidence succeeded, but those particular implementations remain unverified.
- `https://tldraw.dev/docs/license-key` returned 404; the authoritative licensing information was successfully read from `https://tldraw.dev/community/license` and the exact release-linked source license instead.
- Repository and package branch/release dates are different concepts; source-head commits are explicitly not asserted to be exact package commits when npm omits `gitHead`.
- No ranking is based on stars, no benchmark numbers are invented, and no third-party application code is copied into this repository.
