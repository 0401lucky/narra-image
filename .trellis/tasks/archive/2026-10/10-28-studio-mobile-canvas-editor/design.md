# Phone canvas editor design

## Authority And Scope

- PRD M1-M4/MA1-MA4 are authority. D1-D2 were individually approved; the user
  delegated D3-D6 to main. The final summary was explicitly approved on
  2026-10-30; activation and execution follow the recorded implementation gate.
- This is frontend adaptation of React Flow 12.12.0 MIT core and the existing
  studio, not a new editor/store/document/backend. Preserve Chinese cream/orange
  tokens/fonts and default-off production canvas. No dependencies, migrations,
  server routes, Worker, billing, cleanup or public wire changes are planned.
- Research snapshots predate final decisions; current PRD supersedes their
  unapproved alternatives. The old spec's phone read-only policy is the intended
  M1 delta; all owner/readiness/save/run/retention safeguards remain mandatory.

## 1. Mounted Architecture And Ownership

```text
GeneratorStudio (existing owner-keyed lifetime)
  useStudioMode -> mount-safe mode + mutation capability, not width permission
  useCanvasDocuments -> existing controller, drafts/blobs/assets and captured Save
  useStudioJobs / useCanvasRuntimeLease / useCanvasImageViewer (unchanged authority)
  useCanvasEditor -> transient target/mode + nonsecret unfinished field drafts
  lazy CanvasStage (renderer may unmount on mode/lazy changes)
    controlled React Flow + renderer-local measurements/move preview
    toolbar / current-scene node chooser / selected-node actions
    one untransformed node editor -> shared prompt and generation fields
    captured node/document dialogs; existing runtime and image dialogs above pane
```

| Boundary | Owner / Contract |
| --- | --- |
| Mutation capability | Enabled, mounted owner/controller and existing not-ready/deleting guards; width/pointer/keyboard do not authorize or revoke work. |
| Responsive presentation | Width/coarse-pointer/hover and visible bounds determine layout/affordances only. |
| Editor target/drafts | New feature-local hook mounted above CanvasStage; keyed by owner/canvas/node/field, no module-global store. |
| Domain scene | Existing controller/commands/shared graph validation; never React Flow toObject or UI draft JSON. |
| Job/input/save lifecycle | Existing captured commands, outbox, canonical cache/poller, asset registry and account CAS. |
| Dimensions/move preview | Renderer-local maps; no measured/DOM/pointer data persisted. |

Implemented modules (technical boundaries, not another package):

- `canvas/editor-state.ts`: typed editor target/mode and nonsecret field draft
  projection/commit decisions, with pure helpers where reusable.
- `hooks/use-canvas-editor.ts`: owner-scoped mounted UI state and cleanup; passed
  as a typed port through `canvas/renderer-types.ts`, not duplicated scene data.
- `canvas/mobile-interaction.ts`: gesture-state/preview routing and finite
  visible-bounds math; no network or document mutation side effects.
- `hooks/use-canvas-mobile-viewport.ts`: scoped visualViewport/resize observation.
- `parts/canvas-node-editor.tsx`: unscaled editor shell, reference/result panels,
  explicit Run and captured actions. Reuse/refactor CanvasNodeInspector fields.
- `parts/canvas-node-picker.tsx`: bounded current-scene selection/locate controls.
- `parts/canvas-prompt-field.tsx`: shared synchronous native prompt value behavior
  for desktop prompt node and the unscaled editor, not competing field logic.

## 2. Capability, Presentation And Navigation

- Keep SSR mode conversation and browser preferences mount-only. Replace
  useStudioMode's `(min-width: 768px)` permission rule with mount/feature-safe
  capability; retain controller readOnly checks for genuine unavailable contexts.
- Choose touch presentation when width is below 768px or the primary pointer is
  coarse/nonhovering. This also provides a safe best-effort tablet/small-window
  layout. Media/visualViewport changes must not recreate controller/lease manager.
- After init an enabled phone may edit the same controller as desktop. Feature
  off, missing controller, not-ready data, owner change and deletion still reject
  commands. Rendering miniature cards as previews must not set readOnly=true.
- A touch node tap selects; an unscaled action opens Edit or Move explicitly.
  Selection-on-drag, keyboard selection and image clicks are not edit-open intent.
  Stop nested action propagation so one tap does not open editor plus viewer.
- Node chooser lists only this scene's prompt/reference/generation/result nodes,
  with Chinese type/label and status. It provides selection and explicit Locate
  when cards are offscreen/tiny; never enumerate works/runs to reconstruct nodes.
- New/explicit import selects the deliberately created node and offers Locate;
  use existing finite insertion/collision helper. Locate/Move may fit a chosen
  node to a usable scale. Do not fit on keyboard/resize or seize the camera when
  background terminal results arrive; offer View Result/Locate instead.
- Keep existing lazy-error handling, Return to Chat and cached ChunkLoadError
  manual-refresh warning. Memory-only unapplied parameter strings need honest
  refresh-loss guidance; no automatic reload, fake retry or generation replay.

## 3. Touch State And Completed Movement

Modes: browse, edit and move, with an explicit captured owner/canvas/node target.

| Input | Browse / Edit | Move |
| --- | --- | --- |
| Single-finger canvas drag | Pan, not node mutation; tap may select. | Only the captured node's whole preview card is draggable; blank-area navigation stays distinct. |
| Two fingers | Canvas pinch/pan, never Run or node movement. | Cancel an unfinished node preview before two-finger navigation. |
| Panel/input scroll | Native content scrolling, not canvas events. | No transformed inline form controls are active. |
| Move / Done | Enter Move and optionally explicitly locate the target. | Done returns to browse; completed drops remain local edits. |
| Cancelled pointer/layout/unmount | No synthetic edit or submission. | Discard only the unfinished gesture preview; keep completed domain edits. |

- Desktop retains header dragging, port gestures and keyboard behavior. Touch
  browse nodes are nondraggable; in Move only the captured node is draggable,
  without requiring a miniature header. Keep buttons outside that drag region.
- Separate gesture preview from domain: apply interim mobile positions only to
  controlled renderer projection; on a valid one-pointer drop issue one
  `moveNode(canvasId,nodeId,position)`. Pointer cancellation, second-finger arrival,
  owner/node loss or interrupted preview emits no domain move. Use captured
  target and starting camera, finite conversion, and existing geometry validation.
- Continue recording legitimate user camera changes through setViewport. Never
  turn gesture mode into controller readOnly or silently cloud-save the camera.
- Preserve measured dimensions independently while adding preview/presentation
  options to renderer-adapter; selection/dimensions cannot bypass mutation guards.
- Use the boolean touch pan/zoom controls deliberately: installed Flow types say
  mouse-button panOnDrag arrays do not disable touch panning. Validate real event
  routing with the actual library, including a second finger joining a drag.
- Do not globally prevent page/chat scrolling, add long-press-only actions or
  disable browser accessibility zoom. Touch-action/event isolation stays scoped
  to canvas versus the untransformed panel/control subtree.

## 4. Stable Fields, IME And Visible Bounds

- Prompt text uses the existing synchronous native-input value plus immediate
  captured controller update. Do not wait for compositionend, blur or close to
  retain accepted text. External canonical changes need a focused/composing guard.
- Existing CommitField strings (`model`, custom `size`, `outputCompression`,
  `negativePrompt`, `seed`) and custom-size-open state move to the mounted
  nonsecret UI draft boundary, keyed by exact target/field. They survive panel
  hiding, node selection, mode/lazy unmount and orientation. Owner/deleted-node
  invalidation clears only the affected entries, never another canvas/account.
- Reuse current normalization/validation; no new generation parameter schema or
  copied option lists. Credentials/CAPTCHA are excluded from this field registry
  and remain solely in useCanvasRuntimeLease memory with existing cleanup.
- Blur/explicit Apply can commit valid parameter strings. Invalid/unapplied
  strings remain visible or available on reopen with a clear pending marker.
  They are runtime-only, not claimed recoverable after reload/eviction.
- Run validates/applies the target's pending parameter strings before calling
  runNode. Account Save validates/applies pending parameter strings for that
  canvas before capturing; invalid input blocks the action and locates/focuses
  its field. Valid incomplete prompt/graph drafts can still Save; Run readiness
  is stricter. A pending UI value cannot be labelled account-saved silently.
- Closing/edit-mode navigation is not account Save or Run. Retain unresolved
  runtime drafts rather than trapping the user in canvas or discarding them.
  Existing captured Save ACK does not clear newer UI/domain edits.
- When the bottom editor covers background management controls, explicit Close
  exposes toolbar Save; simultaneous direct background-Save access is not
  required. Close preserves pending fields, and the same mounted registry
  validates/applies them before toolbar Save captures the account snapshot.
- Keep stable field DOM across responsive CSS changes; do not conditionally
  replace/re-key the focused editor because height/pointer/width changed. Desktop
  inline prompt and open unscaled editor must not be two active writers to one
  field. Receive external values deliberately, not through a passive old Flow store.
- Composition ref/native isComposing/keyCode229 suppress field shortcuts and
  accidental form submission/escape. Explicit Run/confirmation controls remain
  keyboard accessible. Keep existing chat's intentional Enter/Shift+Enter behavior.
- The editor is a nonmodal untransformed workspace panel with its own scrolling;
  transient confirmation dialogs remain modal. Clamp panel/actions to the
  intersection of studio bounds and visualViewport bounds/offset, with a finite
  window/CSS fallback. Observe actual element resize and clean listeners/frames.
  Do not infer keyboard authorization or persist measurements as scene viewport.
- Touch fields use readable >=16px text and primary controls >=44x44 CSS pixels,
  wrapping at 360px. Safe-area inset padding covers visible header/footer/actions.
  Short landscape/keyboard layouts may scroll the editor rather than enforce the
  desktop 18rem stage minimum or hide the confirmation action.
- Native iOS focus zoom/candidate UI, Android Back/keyboard and caret behavior
  remain physical checks; visualViewport/dvh simulations are not proof of them.

## 5. Connections: Validate One Replacement Before Publishing

- Reuse target source selection, disconnect and reorder. Add a feature-local
  `replaceConnection(canvasId,edgeId,sourceNodeId)` controller command and pure
  CanvasEditCommand branch; no new server endpoint or document field.
- Find a current input edge and appropriate source/target. Reject missing/wrong
  ports, provenance replacement, duplicates and unavailable canonical result
  identities under existing guards. Construct the candidate on a copied scene,
  keep its edge identity/kind/target and image ordinal, then run the existing
  shared graph/schema validation. Publish once only after success.
- Replacing is not disconnect followed by connect: any rejection must preserve
  old scene/edge/order. Capacity consumption is unchanged; do not release or
  bypass pending output reservations. Disconnect still compacts image ordinals.
- Source UI shows labels/previews/readiness. Local available originals can be
  attached before upload; Save/Run resolves them through the existing runtime.
  Missing sources are explicit, never implicitly replaced or generated upstream.
- Preserve exactly one prompt, 0-16 ordered reference/result inputs, canonical
  duplicate rejection, one source to multiple targets and previous-result manual
  feedback. No DAG-only rule, new scheduling or editable provenance edges.
- Preserve frozen accepted/preparing runs when inputs change. Only a subsequent
  explicit Run uses edited inputs; uncertain transport retry retains old intent.

## 6. References, Management And Manual Run

- Use existing importReference/replaceReference and original Blob/upload mapping.
  File chooser callbacks keep explicit target/intent across mobile focus return;
  cancellation does nothing, and late events never redirect to current selection.
  Check original owner/live target. Failed Save/upload retains local originals.
- Reuse current-scene imported references or completed result cards by connection;
  restored account-saved originals reuse READY assets without another upload.
  Do not reupload thumbnails/results or add account-wide assets/works discovery.
- New/select/Save stay reachable; rename/delete/reload and node removal use
  labelled overflow/confirmation. Node confirmation captures node identity and
  explains that work/jobs remain. No undo or cancellation/refund is implied.
- Current node parameter options remain available (advanced section may collapse)
  and use existing constants/catalog/normalizers. Existing provider/CAPTCHA dialog
  stays usable on phones, with exact captured target and no chat settings borrow.
- Run calls existing runNode after field readiness/capacity checks. Busy,
  failed/rejected/unavailable and uncertain outcomes remain distinct. Recovery
  is read-only; explicit original-transport Retry is not a fresh Run.
- Preserve separate local-draft versus captured account-snapshot status. Metadata
  rename does not Save scene; Move/Done/Close/upload success does not account Save.
- Result panel uses existing canonical image view/download and explicit Locate.
  Each viewer/download retains its captured original independently of card/editor
  lifetime. Canvas viewer must not acquire chat's Use For Edit auto-copy action.

## 7. Compatibility And Verification Design

| Target | Planned Coverage | Honest Boundary |
| --- | --- | --- |
| iOS 18+ Safari | Minimum-supported/current available physical versions; portrait/landscape, Chinese native IME, safe areas, chooser/download. | Record actual devices/versions; unavailable coverage stays pending. |
| Android 12+ Chrome | Current/preceding stable engine at acceptance, native Chinese IME/keyboard Back and file/download. | Desktop Chrome mobile emulation is a separate receipt. |
| 360/390/430 CSS portrait | Actual component fixture and corresponding landscape/short visible bounds. | Simulated dimensions are not a physical phone. |
| Desktop regression | Header drag/typed ports, inspector/input/shortcuts, captured Save and shared chat. | Existing browser receipts invalidated by affected source changes. |
| Representative/capacity | 24 nodes/up to32 valid edges and 200-node domain-limit smoke; record observations. | No FPS/latency or deployment-capacity SLA; 400-edge bound unchanged. |

Automated assertions and commands are mapped in implement.md. Physical checks
are required before full target-device MA1/MA3/MA4 acceptance, but not to begin
code/automated validation. If unavailable, hand off explicit pending portions;
do not archive or mark all criteria passed. Real services/auth-to-provider and
actual CI remain outside authorization. Do not run Docker/DB just for unchanged
UI prerequisite evidence; source/harness changes invalidate affected real gates.

## 8. Safety, Rollback And Remaining Technical Risk

- No environment, production flag, database or object operation. Test enabled
  behavior uses fixture props/identity/HTTP, never production feature activation.
- Preserve preexisting patches and concurrent UI work. Main owns spec/task
  records; workers own explicitly assigned mobile source/tests. Read latest
  content and coordinate shared-file changes, never reset/check out/stash others.
- Rollback is main-reviewed removal of this session's exact patches or disabling
  its presentation in development, not destructive data/schema rollback, canvas
  duplication, cancellation or media cleanup. No automatic rollback command.
- Cross-layer invariants: same serialized scene/IDs, unchanged captured intent,
  single poller, old result suppression, original leases and account CAS. Field
  registry and responsive measures never become another canonical authority.
- Technical risks to validate after approval: Flow touch cancellation/preview,
  CSS/visualViewport keyboard intersection, focused DOM stability, external field
  updates and mobile file/download behavior. None changes the chosen MVP scope;
  inability to meet it requires a reported design correction/re-review, not a
  silent fallback to read-only or narrower undocumented targets.

## 9. Implemented Review Corrections

- Independent check corrected external parameter updates during focused
  composition, accepted automatic-size display, outside pointer completion and
  native saved-provider label targeting; see `checks/mobile-independent-review.md`.
- A narrowly reopened review enables `pan-y pinch-zoom` on the untransformed
  editor, its actual scroller and editable/read-only prompts. Relevant ancestor
  permissions must allow browser accessibility zoom; transformed scene previews
  and canvas `.viewport { touch-action:none }` remain unchanged. See
  `checks/mobile-zoom-followup-review.md` and its separate final source freeze.
- These corrections preserve architecture/document/identity/run/save/retention
  contracts and chosen D1-D6 scope. Unit/style and desktop-CDP evidence remains
  distinct from unperformed physical iOS/Android acceptance.
