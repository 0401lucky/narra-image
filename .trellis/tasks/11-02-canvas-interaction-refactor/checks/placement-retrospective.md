# Bug Analysis: A Visible Preferred Point Is Not A Visible Final Position

## 1. Root Cause Category

- D / Test Coverage Gap and E / Implicit Assumption.
- Stage coordinates were captured in visible world space, but the controller
  reused the unrestricted one-column insertion scan. Dense old rows moved the
  complete new group below the visible region. Testing one far-off prompt did
  not expose the occupied-column case.

## 2. Why The First Fix Was Incomplete

1. Anchoring to the last old prompt could place new work far away. The initial
   independent fix correctly captured the current visible anchor.
2. The final controller scan still selected space outside that viewport. A
   real 24-node/32-edge browser graph plus wheel zoom discriminated this from
   native draft debounce and clipping/hit-test harness mistakes.

## 3. Prevention Mechanisms

| Priority | Mechanism | Concrete Action | Status |
| --- | --- | --- | --- |
| P0 | Architecture | Optional legal world bounds survive stage -> controller -> shared final scan. | Implemented |
| P0 | Regression | Dense real stage graph, camera, late chooser, existing IDs/edges unchanged. | Targeted pass |
| P0 | Native evidence | 24-node graph, genuine pan/zoom, new node rect and camera equality. | Fresh matrix required |
| P1 | Spec | Document bounded primary insertion versus unbounded explicit drop/terminal and visible overlap fallback. | Updated canvas-studio |

## 4. Systematic Expansion

- Creation, continuation, toolbar/paste imports and composer chooser imports
  share the bounded path; manual tools and actual drop/terminal keep old math.
- Camera changes after chooser capture never reinterpret the world bounds.
- Late Flow DOM mount is another final-boundary assumption: a captured null
  element is not a durable missing-node fact. Mount discovery plus current-node
  resize observation now replaces the fallback without changing scene camera;
  a delayed-mount hook regression and native first-creation adjacency assertion
  prevent this second class of positioning drift.
- A viewport fully occupied by old nodes permits local overlap, not hidden old
  nodes, automatic relayout, schema migration or a false packing guarantee.
- Pointer capture can similarly disguise physical outside completion: retain
  the real client-coordinate bounds check and the native red/green counterpart.

## 5. Knowledge Capture

- `.trellis/spec/frontend/canvas-studio.md` now records exact optional bounds,
  captured command/source contracts, matrix, positive/negative cases and tests.
- This application has no `src/templates/markdown/spec/` mirror; do not create
  one merely because a generic Trellis skill describes the Trellis CLI repo.
- No spec commit is made: the user's current approval excludes commits/archive.
