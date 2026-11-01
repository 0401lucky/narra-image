# History presentation cleanup design

## Scope And Source Of Truth

This child implements H1-H4 and the parent R12 presentation subset only.
The detailed evidence is
`.trellis/tasks/10-28-studio-dual-mode-canvas/research/current-studio.md`.

## Removal Boundary

- Remove `HistoryRail` import/render and its now-unused history-only projection
  from `generator-studio.tsx`, after checking every use.
- Remove `SessionSidebar`'s recent-image props/tab state/button/grid and
  history-only imports. Keep its conversation list and responsive drawer.
- Retire `parts/history-rail.tsx` if no production consumer remains. Remove its
  rail-only context-menu wiring/tests, not the image actions used by chat bubbles.
- Reclaim the right column using existing layout tokens. Preserve the floating
  composer's measured inset, central scroll container, modal and safe areas.
- Update misleading comments about retained orphan images appearing in a rail.

## Preservation Boundary

- Keep the `create/page.tsx` latest-50 initial job query: conversation restoration
  still depends on it until the canvas child supplies a scoped replacement.
- Keep generation submission/polling, session ownership, reference hooks,
  image URL/download/zoom helpers and `GenerationBubble` operations unchanged.
- Keep existing file/URL drop compatibility. A history-named MIME consumer may
  remain temporarily; any generic canvas protocol migration belongs to the next
  child and must update producer, consumer and tests together.
- No DB/schema/API/provider/worker/media/works behavior changes. Video studio
  history is a different feature and is untouched.

## Regression Shape

Replace assertions about the retired rail/menu with absence checks for both
studio surfaces. Retain behavioral assertions for conversation scoping across
deletion/new/refresh, create failure, reference ordering/drop, config reuse,
custom-provider forms, edit, retry and cancellation.

## Rollback And Handoff

This is a reversible presentation patch with no migration. Any rollback is a
reviewed scoped patch/commit, not a workspace reset; preserve unrelated changes.
Do not start overlapping canvas edits until this child passes its check gate.
