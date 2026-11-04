# Approved Revision 2 Commits

Status: approved on 2026-11-04 after the user reviewed this two-commit plan.
The user explicitly requested committing, pushing to GitHub main and tracking
the resulting Actions image-build progress. See `delivery/approval.md`.
Archive, journal auto-commit, workflow redesign and production deployment remain
outside this delivery. Product and local validation are complete.

## 1. feat(canvas): unify creation cards and floating tools

- `.trellis/spec/frontend/canvas-presentation.md`
- `.trellis/spec/frontend/canvas-studio.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `THIRD_PARTY_NOTICES.md`
- `src/components/create/canvas/composer-placement.ts`
- `src/components/create/canvas/renderer-adapter.ts`
- `src/components/create/canvas/renderer-types.ts`
- `src/components/create/hooks/use-canvas-composer-placement.ts`
- `src/components/create/parts/canvas-dock.tsx`
- `src/components/create/parts/canvas-generation-composer.tsx`
- `src/components/create/parts/canvas-generation-settings.tsx`
- `src/components/create/parts/canvas-image-toolbar.tsx`
- `src/components/create/parts/canvas-node-editor.tsx`
- `src/components/create/parts/canvas-node-inspector.tsx`
- `src/components/create/parts/canvas-nodes/generation-node.tsx`
- `src/components/create/parts/canvas-nodes/node-shell.tsx`
- `src/components/create/parts/canvas-nodes/reference-node.tsx`
- `src/components/create/parts/canvas-nodes/result-node.tsx`
- `src/components/create/parts/canvas-stage.module.css`
- `src/components/create/parts/canvas-stage.tsx`
- `src/components/create/parts/canvas-toolbar.tsx`
- `src/tests/unit/canvas-composer-placement.test.ts`
- `src/tests/unit/canvas-image-first-stage.test.tsx`
- `src/tests/unit/canvas-node-editor.test.tsx`
- `src/tests/unit/canvas-renderer-adapter.test.ts`
- `src/tests/unit/canvas-stage.test.tsx`
- `src/tests/unit/canvas-unified-view.test.tsx`
- `src/tests/unit/generator-studio-canvas.test.tsx`

## 2. chore(trellis): record unified canvas verification

- `.trellis/tasks/11-02-canvas-interaction-refactor/prd.md`
- `.trellis/tasks/11-02-canvas-interaction-refactor/design.md`
- `.trellis/tasks/11-02-canvas-interaction-refactor/implement.md`
- `.trellis/tasks/11-02-canvas-interaction-refactor/implement.jsonl`
- `.trellis/tasks/11-02-canvas-interaction-refactor/check.jsonl`
- `.trellis/tasks/11-02-canvas-interaction-refactor/task.json`
- `.trellis/tasks/11-02-canvas-interaction-refactor/verification.md`
- `.trellis/tasks/11-02-canvas-interaction-refactor/research/unified-cards-and-dock.md`
- Authored revision-2 helpers, approval/review reports, retained JSON gate
  receipts and browser evidence indexes under `checks/unified-cards-and-dock/`.
  Existing task ignores keep screenshots and stdout/stderr captures local;
  do not force-add ignored artifacts. Also ignore `.runtime/` and `__pycache__/`;
  no generated application build is included.

## Unrecognized Dirty Files

None at proposal creation. Recheck before any approved staging. The stage audit
must include fresh cached whitespace checks and identify preserved machine receipt
bytes separately; do not silently include later unrelated work.
