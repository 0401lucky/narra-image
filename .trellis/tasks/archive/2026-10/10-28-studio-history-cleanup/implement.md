# History cleanup execution plan

## Activation Gate

The user explicitly approved the preceding session's final planning review on
2026-10-29 and authorized this first stage only. The coordinator started this
child, not the integration parent. `trellis-implement` and an independent
`trellis-check` read the reviewed artifacts and curated contexts, with explicit
file ownership and instructions to preserve other work. Later child activation
and any commit or deployment require separate user confirmation.

## Ordered Checklist

1. Load frontend specs and inspect current uses of `HistoryRail`, history-image
   props/projection, shared image actions and drag MIME consumers. Recheck git
   status; stop on unexpected changes.
2. Remove the desktop rail and phone image tab, retire unused rail-only code,
   and adjust existing layout without touching shared query/generation logic.
3. Update presentation-specific tests/comments and retain all conversation,
   composer, reference, provider, image edit/reuse, retry/cancel regressions.
4. Run targeted tests, lint, types, full non-DB tests and production build.
   Use `trellis-check` for a fresh review and fixes before declaring the child
   done; record actual results and residual manual/browser gaps.
5. Verify H1-H4 and no backend/media/video changes. Hand off the checked studio
   surface to `studio-canvas-v1`; do not concurrently edit that child's files.

## Targeted Commands

```powershell
pnpm exec vitest run src/tests/unit/generator-studio-session-history.test.tsx src/tests/unit/generator-studio-feedback.test.tsx src/tests/unit/generator-studio-edit.test.tsx src/tests/unit/generator-studio-retry-cancel.test.tsx --testTimeout=30000
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vitest run --testTimeout=30000 --exclude '**/worker-contracts-db.test.ts'
pnpm build
git diff --check
```

Use the project's wrapper deadlines rather than putting the complete suite in
a short parent timeout. No DB runner is required unless the scope unexpectedly
changes; any such change returns to planning, not silent backend editing.

## Manual Acceptance

- Check desktop and phone-sized layouts: no history surface; conversation
  drawer, chat actions, composer scrolling/inset and modals remain usable.
- Exercise delete-all/new/select conversations and a failed conversation create;
  no old/orphan content returns and no unintended generation is sent.
- Confirm works remains independent of the removed studio presentation. Do not
  delete real images or connect production storage to validate this change.

## Risk And Rollback Points

- Shared initial jobs/handlers are the primary accidental-deletion risk.
- Rail-only tests must be intentionally replaced, not removed wholesale.
- Revert only reviewed child changes with a scoped patch/commit if needed; never
  reset the workspace or overwrite a later canvas implementation.
- This document lists future checks. None of these application checks has run
  during planning.

## Execution Record: 2026-10-29

- Steps 1-3: complete. Retired both history surfaces and their dedicated CSS;
  kept the shared initial query, actions, drop consumer, and generation state.
- Step 4: complete for the specified frontend quality gate. Independent review
  found no issues requiring fixes. Targeted tests, lint, types, full non-DB tests,
  production build, and diff checks pass. Real authenticated/DB/storage end-to-end
  checks were not run and are not claimed as passing.
- Step 5: scope/HA1-HA4 checked; handoff written to `handoff.md` for
  `studio-canvas-v1`. The successor remains in planning and has not been started.
- Exact commands, counts, the corrected validation-environment failed attempt,
  browser-fixture scope, and remaining checks are in `verification.md`.
- The user subsequently requested archive only. The coordinator archived this
  child with `--no-commit` on 2026-10-29; status is `completed`, while the checked
  code remains uncommitted. No deployment, successor activation, or stored-data
  change occurred. Archive does not imply a merged or committed patch.
