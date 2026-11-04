# Unified Canvas Interaction Retrospective

## Root Cause Categories

- E / implicit assumption: reopening depended on selection ID changing. Closing
  the editor retained selection, so a later native click on the same generation
  selected it again but opened nothing. First native U5 reproduced this.
- C / change propagation: replacing the visible generation article did not
  disable the React Flow outer wrapper's focus/hit behavior. The screen-space
  editor and scaled card have different bounds, leaving invisible interaction
  space at high zoom. Independent review reproduced this in projection tests.
- C / change propagation: moving controls to higher-z bottom docks changed the
  safe overlay region, but image-toolbar placement still used viewport bottom
  and a fixed height. Independent review reproduced low-image overlap.

## Fixes And Why Earlier Evidence Missed Them

Explicit click/subthreshold-release intent reopens a generation even when its
selection identity is unchanged. Drag, cancel and mobile Browse remain distinct.
The same selected-close-click sequence is retained in native U5 and component
tests rather than bypassed with an Edit-button workaround.

The outer Flow wrapper is inert, unfocusable/unselectable and pointer-transparent
while an attached editor replaces its article, with canonical ID/measurements
unchanged. Native zoom validation additionally checks outside-editor hit samples.

Image controls measure themselves and both docks within visualViewport bounds.
Resize/mount listeners update CSS without moving the image/camera. Native U6
uses real hand panning to place an image at the lower edge, then checks all
actions and opens View. Earlier fit-to-content cases never reached that edge.

## Prevention And Knowledge Capture

The executable rules, error cases, good/bad examples and regression assertions
are recorded in `.trellis/spec/frontend/canvas-presentation.md`, linked from
`canvas-studio.md` section 3.4, and the frontend quality guide. The presentation
spec is split to keep each injected file below the 32KiB context cap rather than
silently truncate test/error contracts. Parent-level studio regressions distinguish
the full graph from folded creation view without deleting ownership/run/Save
assertions. Future overlay changes must audit their outer interaction wrapper
and other independent screen-space controls, not only their visible component.

No repeated speculative CSS fixes or runtime-schema changes were necessary.
Historical red receipts are retained. There is no bundled `src/templates/`
spec mirror in this application to synchronize. No commit is made without
separate user approval; documentation sync does not authorize one.
