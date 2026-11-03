# Research: infinite-canvas implementation reference

- Query: Which interaction and architecture patterns from basketikun/infinite-canvas can improve Narra's existing canvas without replacing its durable generation/data contracts?
- Scope: external implementation research, with local contract comparison only
- Date: 2026-11-02
- Repository: https://github.com/basketikun/infinite-canvas
- Pinned main commit: `9cd3deacbcc598361807afc16c059a80dd18b6f9`
- Commit timestamp: `2026-10-25T11:21:15Z`
- Evidence: GitHub repository/tree/commit APIs and pinned raw source, successfully retrieved; no third-party scripts executed and no reference dependencies installed.

## Evidence And Source References

Source anchors below refer to the upstream repository paths. Exact downloaded copies
live under `research/infinite-canvas-source/` relative to this task. For any anchor
`path:line`, its immutable browser URL is:

`https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/<path>#L<line>`

The directory includes `repository.json`, `commit.json`, `tree.json`, `LICENSE`,
README, canvas components, project orchestrator, stores, factory/geometry helpers,
generation context, image/storage helpers, config defaults, and shortcut manuals.
This is a selected source snapshot, not a runnable repository checkout.

| File | Role |
| --- | --- |
| `web/src/components/canvas/infinite-canvas.tsx` | Pan, pointer capture, cursor-anchored wheel zoom, transformed DOM stage/grid |
| `web/src/pages/canvas/project.tsx` | Selection, creation, drag, connections, generation, history, persistence, project UI orchestration |
| `web/src/components/canvas/canvas-node.tsx` | Media/text bodies, corner resize, ports, counter-scaled node composer |
| `web/src/components/canvas/canvas-node-hover-toolbar.tsx` | Contextual action bar above the active node |
| `web/src/components/canvas/canvas-node-prompt-panel.tsx` | Node-scoped references, prompt, model/settings, generate/stop |
| `web/src/components/canvas/canvas-node-reference-bar.tsx` | Actual reference thumbnails, add/select and disconnect actions |
| `web/src/components/canvas/canvas-node-generation.ts` | Upstream resource interpretation, prompt mentions, generation inputs |
| `web/src/stores/canvas/use-canvas-store.ts` | Browser-local project persistence and metadata |
| `web/src/types/canvas.ts` | Upstream scene/node/connection types |
| `web/src/lib/image-thumbnail.ts` | Preview/original selection based on rendered pixel demand |

## Findings

### 1. The reference is still a node graph, not a graph-free image board

- Built-ins are image, text, config, video, audio, and group, with an open plugin
  type registry (`web/src/types/canvas.ts:12`, `web/src/types/canvas.ts:21`).
- A node contains position, explicit width/height, title, and broad media/generation
  metadata. Connections are plain `fromNodeId -> toNodeId`
  (`web/src/types/canvas.ts:90`, `web/src/types/canvas.ts:100`).
- Images appear primarily as images rather than permanently expanded parameter
  forms; with content, their border is transparent until active/related
  (`web/src/components/canvas/canvas-node.tsx:145`, `web/src/components/canvas/canvas-node.tsx:365`).
- The key improvement to borrow is **contextual, direct manipulation around the
  selected content**, not necessarily eliminating nodes or changing renderer.

### 2. Camera and selection behavior

- Default tool is `pan` (`web/src/pages/canvas/project.tsx:233`): left drag on
  background pans. Switching to select makes background drag a marquee. Control
  or Space temporarily toggles the current tool; middle-button drag always pans
  (`web/src/components/canvas/infinite-canvas.tsx:109`).
- Pointer capture, a 3-pixel movement threshold, `requestAnimationFrame`, and
  pointer-cancel/window-blur cleanup make background gestures explicit
  (`web/src/components/canvas/infinite-canvas.tsx:118`, `web/src/components/canvas/infinite-canvas.tsx:148`).
- Plain wheel vertically zooms, clamped to 5%-500%. World coordinates beneath the
  cursor remain fixed (`web/src/components/canvas/infinite-canvas.tsx:87`).
  Overlay/menu/editable targets opt out, and a native non-passive listener blocks
  page scrolling only on the canvas (`web/src/components/canvas/infinite-canvas.tsx:192`).
- Click selects a node; Shift/Ctrl/Cmd toggle membership; marquee intersects node
  bounds; selected nodes move together
  (`web/src/pages/canvas/project.tsx:1246`, `web/src/pages/canvas/project.tsx:1277`,
  `web/src/pages/canvas/project.tsx:1415`). Text/editor capture selects without
  forcing the inner editor to become a drag handle (`web/src/pages/canvas/project.tsx:1261`).
- A click (not drag) opens the node composer. Optional focus-on-select defaults
  false, so normal selection does not unexpectedly move the camera
  (`web/src/pages/canvas/project.tsx:1346`, `web/src/stores/use-config-store.ts:127`).
- Zoom slider, reset, optional minimap, and a shortcut dialog provide visible
  alternatives (`web/src/components/canvas/canvas-zoom-controls.tsx:26`).

### 3. Creation, import, and contextual editing

- Bottom dock creates image/text/config/etc. nodes or opens upload. Creation uses
  visible canvas center, selects the node, and immediately opens image/config
  editing (`web/src/components/canvas/canvas-toolbar.tsx:93`,
  `web/src/pages/canvas/project.tsx:832`). Double-clicking empty canvas opens a
  creation menu at the pointer (`web/src/pages/canvas/project.tsx:3197`).
- Dropped image/video/audio files are created at the actual world-space drop
  point with 40-pixel staggering (`web/src/pages/canvas/project.tsx:2284`). System
  clipboard images become image nodes; clipboard text becomes text nodes, after
  the internal node clipboard is tried (`web/src/pages/canvas/project.tsx:1563`,
  `web/src/pages/canvas/project.tsx:1635`).
- A floating toolbar is positioned above the active node using world-to-screen
  coordinates and does not shrink with scene zoom. It exposes relevant actions
  rather than every setting permanently (`web/src/components/canvas/canvas-node-hover-toolbar.tsx:110`,
  `web/src/components/canvas/canvas-node-hover-toolbar.tsx:185`). Image tools include
  download, reuse/edit, preview, prompt copying, crop/mask and more; many of those
  latter operations are separate features, not prerequisites for useful basics.
- The prompt/settings panel is below the selected node, explicitly counter-scaled
  with `scale(1 / scale)` so its inputs remain readable regardless of camera zoom
  (`web/src/components/canvas/canvas-node.tsx:449`). Node prompt panel has reference
  thumbnails/add, prompt editor, model selection, compact settings, generate/stop,
  and expanded-editor modal (`web/src/components/canvas/canvas-node-prompt-panel.tsx:72`).
- Generation settings override defaults per node; they do not silently mutate
  unrelated nodes/global config (`web/src/components/canvas/canvas-node-prompt-panel.tsx:170`).

### 4. Generation and iteration are direct, while links remain useful

- **Empty image:** submit prompt directly on its composer; result fills the same
  image node rather than leaving an empty placeholder behind
  (`web/src/pages/canvas/project.tsx:2394`, `web/src/pages/canvas/project.tsx:2438`).
- **Existing image:** default `new-node` behavior uses that image plus connected
  references as image-edit inputs, creates an adjacent image node, and adds a
  source-to-result connection. Original content stays visible for comparison
  (`web/src/stores/use-config-store.ts:126`, `web/src/pages/canvas/project.tsx:2398`,
  `web/src/pages/canvas/project.tsx:2415`, `web/src/pages/canvas/project.tsx:2464`).
- Image batches are stored in the image node's `metadata.images` with per-image
  loading/success/error and primary-image identity. Do not transplant this format
  into Narra's accepted-run/result identity model
  (`web/src/pages/canvas/project.tsx:2421`, `web/src/pages/canvas/project.tsx:2473`).
- Text can be edited inline by double-click. A text node's image-generation action
  creates and connects a config node to the right, selects it, and opens its
  composer (`web/src/pages/canvas/project.tsx:2936`).
- References are not restricted to manually dragging tiny ports: a thumbnail bar
  has an add/select action and remove button
  (`web/src/components/canvas/canvas-node-reference-bar.tsx:13`). Manual port links
  and drag-to-empty-space connected-node creation are also supported
  (`web/src/components/canvas/canvas-node.tsx:446`, `web/src/pages/canvas/project.tsx:1446`).
- Resource interpretation uses connections and supports image/text/video/audio/
  groups; config composer mentions use `@[node:id]` tokens. This is not Narra's
  one-direct-prompt plus ordered image-input contract
  (`web/src/components/canvas/canvas-node-generation.ts:40`,
  `web/src/components/canvas/canvas-node-generation.ts:66`).

### 5. Architecture and persistence are implementation references, not migration targets

- Vite/React 19, Tailwind 4, Zustand 5, Ant Design 6, React Query, localforage,
  motion and assorted media/editor libraries (`web/package.json:16`). No React
  Flow or other graph-renderer dependency appears in the web package.
- Stage is regular DOM with `translate(x,y) scale(k)`; nodes are absolutely
  positioned DOM; connections are SVG (`web/src/components/canvas/infinite-canvas.tsx:223`,
  `web/src/components/canvas/canvas-node.tsx:301`, `web/src/pages/canvas/project.tsx:3205`).
- The project page owns local React state plus refs; Zustand persists projects,
  not transient selection/drag state. The orchestrator is >3,400 lines, so its
  monolithic structure is not itself a recommended local refactor target.
- Store persists browser-local projects through localforage with a 400ms write
  debounce, falling back to localStorage. The inspected project model has no
  Narra-like owner, revision CAS, server snapshots, run bindings or tombstone
  protocol (`web/src/stores/canvas/use-canvas-store.ts:10`,
  `web/src/stores/canvas/use-canvas-store.ts:48`, `web/src/lib/localforage-storage.ts:9`).
- Project changes save on effects; camera saves with a separate 500ms debounce.
  History uses a 180ms debounce and at most 50 past entries, pausing commits during
  drag (`web/src/pages/canvas/project.tsx:490`, `web/src/pages/canvas/project.tsx:524`,
  `web/src/pages/canvas/project.tsx:533`).
- Preview thumbnails cap their longest edge at 768; selection switches to the
  original when rendered size * DPR requires more pixels
  (`web/src/lib/image-thumbnail.ts:1`, `web/src/lib/image-thumbnail.ts:17`). This is
  a useful performance pattern, but preserve local media lease/storage semantics.

## Adaptable Patterns For Narra

1. Keep the user's primary action close to the content: select an image, show a
   readable contextual toolbar/composer, enter an edit request, explicitly run,
   place new results adjacent while retaining the original.
2. Make new generation/import reachable without constructing a graph manually;
   reuse current prompt/generation/reference commands behind a simpler UI.
3. Offer explicit reference thumbnails/add/remove in addition to optional links;
   preserve local source validation and canonical ordinal ordering.
4. Separate pointer intent (pan/select/content drag/edit), shield controls from
   stage shortcuts, and never let focusing a field accidentally pan or run.
5. Keep controls screen-sized rather than scaled with the content; on narrow
   screens use a bounded native-scroll sheet rather than the reference's fixed
   600px node panel.
6. Retain the existing controlled React Flow core unless concrete local evidence
   justifies replacing it. The reference UX does not require rewriting camera,
   ports, snapshots, media or server orchestration from scratch.

These are candidate recommendations for the user, not decisions already approved.

## Local Compatibility Boundaries

- `contracts/canvas/v1/scene.json:1` defines `prompt/reference/generation/result`,
  semantic edge kinds, accepted `runBindings`, and forbids library state. No
  width/height, media URLs or upstream `metadata.images` exist in that durable model.
- `.trellis/spec/frontend/canvas-studio.md:5` makes React Flow a controlled renderer
  and prohibits an application-global replacement store. Existing canvas controller,
  local draft transactions, owner-scoped jobs and media leases remain authoritative.
- `.trellis/spec/operations/canvas-contracts.md:29` requires explicit manual Run,
  immutable run intent, ordered sources, original retention, owner/revision CAS,
  and no automatic generation from editing/linking/recovery. A convenient UI must
  call those existing boundaries, not upstream browser-to-provider generation.
- Local mobile contracts deliberately make click select only, explicit Edit/Move,
  and native scrolling/accessibility zoom in a separate editor. Adopting upstream
  click-to-open on desktop is a UX choice; copying it unconditionally onto touch
  would change an existing documented behavior.
- Local appearance is Chinese cream/orange editorial styling; reference themes,
  Ant Design and dark/light chrome are not mandates.
- New video/audio/LLM generation, agent/MCP integration, plugin runtime, groups,
  mask/crop/upscale/panorama, global provider scripts, WebDAV and asset-library
  rewrites should remain deferred unless the user explicitly includes them.

## License And Reuse

- Root `LICENSE:1` is MIT, copyright 2026 basketikun. GitHub license metadata and
  the current licensing manual agree. MIT allows adapting/copying code, including
  commercial use, provided copyright and license notices remain in copied or
  substantial portions (`LICENSE:12`).
- Narra's package declares `AGPL-3.0-only` (`package.json:5`); use of MIT reference
  code does not change Narra's license. If code is copied rather than independently
  reimplemented from interaction research, retain upstream MIT attribution in the
  relevant notices. Dependency/media/trademark licenses are separate and were
  not exhaustively audited. No upstream branding or sample media is needed.

## Caveats / Not Found

- Source-level research only: no live visual/browser trial, actual generation,
  touch-device test, accessibility audit, or performance benchmark was run.
- Upstream node drag/resize/ports still enter through mouse handlers even though
  the background stage uses pointer capture. There is no verified multi-touch
  pinch protocol in the inspected canvas implementation. The fixed 600px
  composer and dock offsets are desktop-biased (`canvas-node.tsx:451`,
  `canvas-toolbar.tsx:94`); do not assume mobile ergonomics are solved upstream.
- Shortcut manual claims Ctrl/Cmd drag selection; stage tool inversion actually
  checks Control/Space, not Meta (`infinite-canvas.tsx:114`). Plain wheel zoom also
  differs from typical two-axis trackpad-pan conventions; device behavior is a
  product decision, not automatically correct because the reference uses it.
- Manual says undo includes viewport (`canvas-shortcuts.zh-CN.mdx:43`), but
  `CanvasHistoryEntry` omits viewport and `applyHistory` does not restore it
  (`web/src/pages/canvas/project.tsx:110`, `web/src/pages/canvas/project.tsx:1150`).
- Manual says text-node image action immediately starts generation
  (`canvas-node-manual.zh-CN.mdx:36`); the actual handler creates/selects/opens the
  config node without invoking Run (`web/src/pages/canvas/project.tsx:2936`).
  Product behavior recommendations here use the implementation, not those claims.
- Debounced localStorage/localforage persistence is not crash durability or
  multi-tab safety evidence. It cannot replace Narra's native transaction ACK,
  owner scoping, CAS, deletion fencing or uncertain-run recovery.
