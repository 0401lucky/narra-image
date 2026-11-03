# Native Placement Integration Correction

- Native red evidence: `checks/browser/evidence/native-1793611765492`, B8.
- Root cause: the initial independent visible-anchor fix selected a visible
  preferred point, but the controller's unbounded occupied-column scan could
  still move the complete new group below dense old rows. A far-off prompt alone
  did not reproduce the actual dense 24-node/32-edge composition.
- Correction: optional feature-local `CanvasInsertionBounds` bounds legal world
  top-left positions. The existing insertion helper searches nearby columns via
  the unchanged legacy scan, then prefers a visible overlap when the entire
  region is occupied. Old nodes, coordinates and camera are never rearranged.
  Manual graph insertion, explicit drop and terminal output use the original
  unbounded path. Creation, continuation and captured chooser/paste imports pass
  bounds through the controller so a second scan cannot push them offscreen.
- Tests: dense real stage/controller graph plus zoom and late chooser camera
  change; nearby-column search and deterministic fallback; invalid bounds reject
  without any partial group, original map, upload or Run.
- Execution ownership: initial implementer and independent checker completed
  their work and post-anchor gates. Every final native/check follow-up and a
  bounded default CLI reviewer then failed with the same `prompt_cache_key`
  service error before executing a review/fix tool. The main coordinator applies
  this narrow integration correction, not a broad inline implementation or a
  workflow/model/global-configuration change. Failed dispatch/CLI receipts stay
  preserved. Do not label a later main-run gate as a fresh independent review.
- A second screenshot review exposed a late Flow node mount: the placement
  effect captured null once and the composer stayed at the right-edge fallback
  even after the new card appeared. Current-target discovery on DOM child-list
  changes now switches node resize observation, with both observers cleaned up.
  A real delayed DOM mount regression and first-creation native adjacency check
  verify this without fake resize or camera changes.
- Fresh pinned isolated gates and rebuilt browser inputs follow both fixes.
  Previous 1734/1738-test and earlier browser verdicts are historical, not the
  final-source acceptance. Final current receipts belong to main coordination;
  the independent final review is still unavailable due the service errors.
