# GHCR Release Implementation Plan

## Planning Gate

The user approved new-task creation and public GHCR/product scope, then explicitly
approved the complete final artifact summary with "没问题" on 2026-11-04.
PRD, design, research and context manifests are ready for task activation and
implementation. No commit/push/first registry run is automatically approved by
the previous canvas delivery. See `checks/implementation-approval.md`.

This is one integrated release deliverable: CI prerequisites enable the same
publication gate, and the Compose/docs consume its image identities. They are
implemented in order, not as independently released child tasks. The completed
canvas work remains in its own untouched task.

## Ordered Work

1. Record baseline HEAD/status and load all relevant specs before coding. Add
   focused failing regressions for Prisma-before-tsc and socket-versus-TCP DB
   readiness. Verify unchanged safety deadlines/resource ownership.
2. Correct the shared DB ready probe and CI generation/build environment lanes.
   Run focused checks; inspect any newly exposed failures rather than weaken
   assertions or skip required jobs.
3. Add narrow, testable image identity/publication helpers: trusted source and
   digest validation, explicit missing versus denied/error states, immutable
   source-tag reuse, anonymous access, and promotion policy. Keep secrets out of
   arguments/logs/build inputs and every external call bounded.
4. Extend the existing workflow with a guarded publication job needing all three
   verification jobs. Add official pinned Docker actions, read-only defaults,
   job-only package permission, serialized no-cancel publication, exact SHA
   checkout, image-specific caches and source/digest summary. Do not expose PR
   execution to publishing credentials or bypass red gates.
5. Add image-only Compose overlay and update README/operations docs. Validate
   actual merged services with dummy input, no remaining build blocks, existing
   volumes/environment/health/dependencies preserved and missing-image failures.
6. Run targeted tests and hand off the complete diff to an independent checker.
   After any correction, refresh current-source receipts and rerun affected and
   full gates. Main updates executable release specs only for implemented facts.
7. Present local results and grouped commits for separate delivery approval.
   After authorized main push, track the whole gate/publish run. If GHCR first
   visibility is private, surface owner action; after it is completed, rerun
   safely and verify both public amd64 manifests/digests. No production rollout.

## Ownership And Dispatch

Main owns planning artifacts, specs, coordination, isolated validation helpers,
commit approvals and actual remote observations. After approval dispatch one
`trellis-implement`, then one independent `trellis-check`. Prompts begin:
`Active task: .trellis/tasks/11-04-ghcr-image-release`.

Use native Codex context injection; child fallback reads role JSONL entries,
then PRD, design and this plan. Tell agents they are already their role and
must not spawn implement/check descendants. They are not alone in the codebase:
preserve others' changes, accommodate main task/harness writes and report any
unexpected conflict without reverting foreign edits.

Implementer owns the relevant `.github/workflows/verify.yml`,
`scripts/verify-ci.mjs`, `scripts/lib/disposable-postgres.mjs`, narrowly scoped
new release helper/entry files and corresponding Node/Vitest tests,
`docker-compose.images.yml`, README and production operations documentation.
Runtime Dockerfiles are reused; add metadata through the publish action instead
of unnecessary runtime changes. The checker may self-fix scoped bugs/tests and
writes evidence under this task's `checks/review/`.

No agent stages/commits/pushes, changes production configuration, reads real
dotenv/secrets, runs real database/provider operations, installs dependencies
implicitly, modifies another task or bypasses the user's first-release approval.
Main owns actual registry execution/monitoring and any one-time Public-setting
interaction with the user.

## Validation

Prepare fresh owner-marked credential-isolated current-source snapshots with
the installed pinned Node24.22.1 and copied dependencies. Historical canvas
isolation is a reference, not a current release verdict; adapt paths/context
and include `pnpm-workspace.yaml`/new Compose and workflow inputs explicitly.
No local actual dotenv, inherited preloads/proxies/credentials or source-tree
Prisma output may leak into verification. Serialize heavy tests/builds.

Run equivalent installed CLI commands (no implicit install fallback):

```text
node --test scripts/tests/migration-safety.test.mjs scripts/tests/release-startup.test.mjs <new release/readiness tests>
pnpm lint
pnpm exec prisma generate
pnpm exec tsc --noEmit
pnpm exec vitest run --testTimeout=30000 --maxWorkers=2
pnpm build
git diff --check
```

Additional gate validation:

- Clean-client CI fixture proves generation precedes typecheck and a failed
  generation stops the chain; synthetic production build environment is absent
  from tests. Stage tests alone are not actual clean-runner/remote CI evidence.
- Workflow syntax/guard tests, official action pin verification, and optional
  installed actionlint. Do not claim missing tooling was run.
- `docker compose --env-file <dummy> -f docker-compose.yml -f docker-compose.images.yml
  config --format json` with synthetic selectors; inspect only nonsecret shape.
  This is daemon-free config evidence, not a real deployed system.
- Disposable DB/migration/E2E wrappers only with installed local Docker and
  approved base images; missing tooling/image/daemon is a reported prerequisite,
  never a fallback to a real database or automatic pull from a test wrapper.
- Full real workflow/registry gate after separate approval: tests pass, both
  image pushes are traceable, latest cannot bypass requirements, anonymous OCI
  checks and a no-login isolated pull/inspect establish public availability.

Keep source hashes, actual exits/deadlines, failed and successful receipts and
nonsecret Actions URLs. Never relabel mocked registry success as published,
authenticated pulls as anonymous, or two latest aliases as a transactional pair.

## Completion And Rollback

- Reconcile AC1-AC6 with actual local/remote evidence and visibility limits.
- Update operations release spec with signatures, identity/permission/error
  contracts, good/bad cases, tests and the first-publication prerequisite.
- Preserve old source-build Compose and deployment topology; no image/volume
  cleanup or schema rollback is part of this work.
- Registry/network/permissions failures preserve valid fixed images and
  diagnostics; no force-push, deleting images, ignoring red gates or automatically
  deploying partially published aliases.
- Git delivery and any task archive/journal commits need their own workflow
  gate. Do not silently continue the old canvas task's delivery authority.

## Execution Status

- Steps 1-6 are complete: scoped implementation, independent review and local
  source-bound tests/types/lint, clean CI prerequisites, actual Compose merge,
  production build and both Linux amd64 Dockerfile builds. See `verification.md`.
- The reviewer added the missing mocked CLI/bootstrap/output/rerun regression;
  no in-scope production-code defect remained. Main's executable operations
  specs and the narrow receipt Git attributes were verified.
- Step 7 delivery was explicitly approved on 2026-11-04 at 13:06:01 UTC. The
  interrupted session is resumed after verifying unchanged source and remote
  main; see `checks/delivery-approval.md`. Real hosted gate results, GHCR Public
  setup and anonymous image evidence remain pending. The task remains
  in_progress; neither this task nor the prior canvas task is archived.
