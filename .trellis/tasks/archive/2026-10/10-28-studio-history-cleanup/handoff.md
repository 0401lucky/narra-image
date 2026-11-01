# Checked handoff to studio-canvas-v1

## State

- Date: 2026-10-29. History cleanup HA1-HA4 and the specified frontend quality
  gate pass. Independent `trellis-check` found no issues needing fixes.
- The user explicitly requested this child's archival after the quality report.
  It is now `completed` at
  `.trellis/tasks/archive/2026-10/10-28-studio-history-cleanup`.
  `task.py archive --no-commit` preserved the uncommitted code patch; commit,
  deployment, and successor activation remain unauthorized in this session.
- Parent, `studio-canvas-v1`, and `studio-mobile-canvas-editor` stay `planning`.
  This handoff does not start either successor or authorize their implementation.
- Actual tests, environment, evidence, and live-check gaps: `verification.md`.

## Established Surface

- `src/components/create/generator-studio.tsx`: one existing conversation
  controller, no global history-image projection or right rail. Main region
  fills released width; composer measurement, cache, mount guard, generation
  actions, modals, and reference lifecycle remain in place.
- `src/components/create/parts/session-sidebar.tsx`: conversation-only props and
  responsive drawer. Chinese open/close navigation labels identify its controls.
- `src/components/create/parts/history-rail.tsx` and its dedicated global CSS
  animation/mask rules are retired; do not import or resurrect this component.
- `GenerationBubble` remains the image view/download/edit/config-reuse surface;
  no handler was retired just because it previously had a history-rail caller.
- Regression owners remain the session-history and feedback test files, with
  existing edit and retry/cancel files retained unchanged.

## Load-Bearing Boundaries For The Next Stage

1. `src/app/create/page.tsx` still fetches the current owner's latest 50 jobs.
   The active conversation's `generationIds` and known-generation cache consume
   this data. Add and verify the approved conversation-scoped loader before
   replacing it; never delete it as rail-only data or use global/orphan fallback.
2. The file/URL/internal MIME drop consumer in `Composer` is intentionally
   unchanged. Any canvas asset producer/protocol migration must update both
   consumer and tests; removal of the former rail producer is not its retirement.
3. Keep one mounted business controller. New canvas origin/poll/save isolation
   belongs to the next reviewed plan, not to this presentation patch. Do not
   reopen history removal as a generation refactor or restore global content.
4. Conversation deletion still retains jobs/images through the existing backend
   contract, and works queries remain independent. No schema/API/Worker/storage,
   cancellation/refund, video, or dependency change has occurred here.
5. Preserve existing cream/orange Chinese UI, safe areas, scroll containers,
   measured composer inset, and phone conversation creation. Phone canvas
   editing remains the separate deferred task.

## Resume Guard

- Obtain the user's explicit next-stage authorization before `task.py start`
  for `studio-canvas-v1`; do not dispatch overlapping studio/sidebar edits.
- Recheck dirty state. Preserve this uncommitted checked patch, this archived
  task, and the three remaining planning task directories; never reset or
  overwrite the predecessor.
- Read the existing canvas PRD/design/implement/manifests and this handoff. The
  confirmed decisions and prior research do not need to be recreated.
- A real authenticated browser/hydration/DB/storage check remains unperformed;
  do not treat the isolated history fixture as completed canvas/live acceptance.
