# First Hosted Gate Follow-up

## Delivered Source

- Product commit: `d530132`.
- Task/evidence commit and pushed main:
  `651f12af560db529ceb3f23c58ad230c2efdd044`.
- Workflow: https://github.com/0401lucky/narra-image/actions/runs/41838299471
- Local main and remote main were verified equal after an ordinary push.
- No production operation, registry permission change or task archive occurred.

## Observed Failure

The hosted migration job passed. The CI job passed Node tests, Prisma generation,
TypeScript and lint, then failed one of 1,824 Vitest tests. The completed job log
is retained locally under `checks/.runtime/delivery-41838299471/verify-ci.log`.

`src/tests/unit/canvas-e2e-runtime-fixture.test.ts:59` expected
`CANVAS_INVALID_INPUT`, but received the real runtime environment validator's
ZodError because `AUTH_SECRET` and `DATABASE_URL` were absent. The other 1,823
tests passed. This gate was previously hidden behind the ungenerated Prisma
Client failure. E2E subsequently passed; the overall run failed and publication
was skipped. Final hosted results are in `checks/first-hosted-run.json`.

## Narrow Correction Plan

This is an evidence-backed test prerequisite within R4, not a production runtime
or canvas behavior redesign. Reproduce in a credential-isolated current-source
workspace with these two ambient variables absent, then make the fixture own
only the synthetic values required by its real parser. Retain the actual parser,
strict media-type assertions and environment cleanup. Do not add production
secrets, globally seed test defaults, mock away runtime validation, skip a test
or weaken release gates.

The implementer owns only the affected fixture test and its own receipts under
`checks/ci-followup/implementation/`. Main owns task/spec updates and remote
observations. An independent checker must verify the absent-variable regression,
full non-DB tests, Node release tests, lint and types against final source. No
agent commits or pushes. Any correction delivery is a separate follow-up to the
already completed two-commit batch.
