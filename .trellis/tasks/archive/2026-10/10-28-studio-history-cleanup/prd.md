# Remove studio image-history presentation

## Status

- Completed and archived on 2026-10-29 at the user's explicit follow-up request,
  using `task.py archive --no-commit`. The user previously confirmed the final
  planning review and authorized implementation of this first child only.
- Owns the presentation-only portion of parent R12. Implementation and the
  independent quality check pass; `verification.md` records actual evidence and
  remaining live-environment checks. Code is still uncommitted; deployment and
  activation of the canvas/mobile tasks have not been authorized or performed.
- Parent: `.trellis/tasks/10-28-studio-dual-mode-canvas/prd.md`.

## Goal

Remove history-image clutter from the image creation studio on desktop and
phones without changing conversation creation or deleting the user's images.

## Background

- Two surfaces exist: desktop `HistoryRail` and the phone sidebar's recent-images
  tab (`src/components/create/generator-studio.tsx:1210`,
  `src/components/create/parts/session-sidebar.tsx:71`).
- The latest-50-job query also hydrates conversations; it is not rail-only
  (`src/app/create/page.tsx:36`). This child leaves it intact.
- Deleting conversations intentionally preserves jobs/images through `SetNull`;
  works loads generated images by user ownership (`prisma/schema.prisma:453`,
  `src/lib/server/works.ts:128`).

## Requirements

- H1 / parent R12: Remove both desktop and phone history-image presentation.
  Retain conversation navigation and let the central area use the freed space.
- H2 / parent R12: Preserve chat-bubble zoom/download/edit/reuse, reference input,
  conversation create/select/rename/delete, provider settings, and generation
  submission/retry/cancellation behavior.
- H3 / parent R12: Do not delete or mutate jobs/images, change the separate works
  experience, or alter conversation-deletion retention.
- H4 / parent R5: Keep this deliverable independent from canvas APIs/dependencies,
  persistence, generation refactoring, or unrelated video history changes.

## Acceptance Criteria

- [x] HA1 / H1: Neither desktop history thumbnails/context menu nor the phone
  recent-images tab appears in the studio; conversation navigation remains.
- [x] HA2 / H2: Existing chat-bubble actions, file/URL reference input and ordering,
  custom-provider submissions, edit/retry/cancel, and composer sizing still work.
- [x] HA3 / H2-H3: Deleted/new conversations do not repopulate from global history
  after refreshed props; conversation-create failure still blocks generation and
  restores draft input.
- [x] HA4 / H3-H4: No generation, media, works, schema, or video-history mutation is
  introduced. Existing works retention remains covered by the parent regression
  boundary; this child changes presentation only.

## Dependency And Handoff

- Run this child first. `studio-canvas-v1` waits until these acceptance criteria
  and the child's quality check pass, because both later touch studio/sidebar
  wiring. Do not dispatch their implementations concurrently.
- The canvas child owns any replacement conversation-scoped loader. Removing
  rail UI here is not permission to remove its shared initial query/handlers.

## Out Of Scope

- Canvas features, dependencies, backend/schema/media changes, image deletion,
  new generation business logic, or removal of `/video` history.
- Retiring an asset-drop consumer before a compatible canvas producer exists.

## Artifacts

- `design.md`: exact presentation-removal and preservation boundaries.
- `implement.md`: ordered edits, regression commands, and check/handoff gate.
- `implement.jsonl` / `check.jsonl`: curated specs/research, never app source files.
