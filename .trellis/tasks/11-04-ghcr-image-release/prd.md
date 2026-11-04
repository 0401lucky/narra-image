# Verified GHCR Image Publishing

## Status And Authorization

On 2026-11-04 the user requested a reusable image publishing flow after the
canvas delivery and agreed to the proposed scope: public GHCR App/Worker images,
main verification gates, latest/source tags, Linux amd64, the two existing CI
prerequisite fixes, and image-based Compose update/rollback instructions.
Their reply "可以，没问题" approves task creation and that product direction.
The complete artifact summary was then presented and the user explicitly
approved it with "没问题". Implementation and scoped local checks are authorized
after task activation; see `checks/implementation-approval.md`.

The canvas task is delivered separately and is not modified or archived here.
Publication does not authorize changing a production server, database, volume,
runtime flags or credentials. Commit/push and first registry execution must have
explicit delivery approval; earlier canvas delivery permission is not reused.

## Goal

Let maintainers update deployed Narra installations by pulling a verified image
version rather than rebuilding on their server. Make each published App/Worker
pair traceable to one source commit, with a documented safe update and rollback
path and no publication of failed or untrusted changes.

## Background And Confirmed Facts

- Baseline: clean main `66a4d0273f9fd3229336945ed06d87d1995943dd` in public
  `0401lucky/narra-image`. Its single workflow, `verify`, runs CI, migrations and
  E2E on main pushes/PRs but has no registry publication
  (`.github/workflows/verify.yml:1`).
- Actual Actions run `41798479538` builds App and Worker test images and passes
  E2E. CI fails on ungenerated Prisma types; migrations fail when the temporary
  PostgreSQL initialization server shuts down. Both reproduce the prior main
  run `41580622136`; see `research/ci-and-release.md` for evidence and seams.
- Root `Dockerfile` already supports the combined embedded deployment, including
  Next, Worker and operational binaries. `worker/Dockerfile` supports dedicated
  Worker. Existing Compose owns database/volume/environment/health/migration
  behavior (`docker-compose.yml:1`). Do not replace those runtime contracts.
- GHCR supports repository-scoped GITHUB_TOKEN publication and anonymous public
  pulls, but newly created packages default to private. Public source-repository
  visibility alone does not establish public package visibility. This is a
  first-publication prerequisite, not permission to invent an unsupported API.

## Requirements

- R1: Publish `ghcr.io/0401lucky/narra-image-app` and
  `ghcr.io/0401lucky/narra-image-worker` for `linux/amd64`, built from the same
  exact tested main commit using existing Dockerfiles. Retain AGPL/third-party
  notices and source/revision/license OCI metadata. No new runtime dependency,
  architecture, provider or storage redesign is required.
- R2: Publish only after all three existing verification jobs succeed. Pull
  requests, forks, failed/cancelled/skipped required checks and other branches
  must not log into GHCR or publish. Publishing credentials are limited to the
  protected publication job; validation jobs remain read-only.
- R3: Provide `sha-<full-40-character-commit>` tags for the exact source version
  and `latest` as a convenience alias. The workflow does not overwrite an
  existing valid source-tag digest on rerun. Resolve and validate both images
  before promoting aliases, serialize publishers, and prevent older runs from
  replacing a newer main publication. Report the final digests and pull commands.
- R4: Fix the actual prerequisites rather than bypassing gates: explicitly
  generate Prisma Client before type checking, and wait for the final TCP-ready
  disposable PostgreSQL server rather than its temporary Unix-socket server.
  Preserve failure propagation, deadlines, local-only resources and cleanup
  fencing. Any newly exposed gate failure must be diagnosed, not hidden.
- R5: Reuse GitHub's job token rather than asking users to maintain Docker Hub
  credentials. Verify anonymous manifest access for both published images. If
  GHCR initially keeps them private or a permission check fails, stop public
  release/promotion, retain diagnostics and show the precise one-time package
  Public/access setting and safe rerun route. Never claim unauthenticated access
  from an authenticated push/pull alone.
- R6: Provide a small image-only Compose overlay that reuses the existing
  dedicated deployment services/volume/network/environment/healthchecks. Use
  existing `APP_IMAGE`/`WORKER_IMAGE` selectors and remove inherited build blocks;
  a missing explicit image selection fails rather than silently building local
  source. Preserve existing source-build and embedded/Zeabur entry points.
- R7: Document first setup, matching App/Worker source tags or digest pins,
  explicit image pull and graceful stop/migrate/start update order, health
  verification, backup requirements, and rollback through the existing safety
  preflight. Do not recommend independently pulling two mutable latest tags as
  an atomic pair, deleting volumes, downgrading schema or automatic server updates.

## Acceptance Criteria

- [ ] AC1 / R1,R2: A tested exact main SHA has both correct amd64 images with
  source/revision/license metadata. Workflow tests prove publish needs all three
  gates and has no PR/fork/untrusted-ref credential or push path.
- [x] AC2 / R3: Negative tests cover one missing image, registry denial/network
  error, malformed digest, rerun with an existing tag, outdated main SHA and
  publisher serialization. No failed build/verification is promoted; successful
  output includes both digest-pinned references for one source version.
- [x] AC3 / R4: A clean dependency fixture generates Prisma before tsc, and
  failed generation prevents later stages. Readiness tests simulate temporary
  socket success but TCP-not-ready until final startup; deadlines/errors and
  owner-verified resource cleanup remain intact. Relevant/full local checks pass.
- [ ] AC4 / R5: Anonymous registry verification is separate from logged-in
  operations. Private-first-publication is reported as a clear pending action,
  not public-release success. After explicit visibility setup, the same source
  tag can be reused and public verification completed without moving its digest.
- [x] AC5 / R6,R7: Merged image-only Compose has no build blocks, uses explicit
  matching GHCR image references, and preserves the base database volumes,
  startup dependencies, readiness and runtime environment. Missing selectors
  fail. Documentation explains updates/rollback without server-side compilation,
  destructive volume commands or automatically bypassing migrations.
- [ ] AC6 / R1-R7: Independent review, lint/types, targeted and full non-DB
  checks, workflow/config validation and source-bound build evidence pass.
  First authorized Actions/registry run is tracked to its actual result, with
  public manifest/architecture/digest evidence distinguished from local mocks.
  Production and physical/live-provider actions are explicitly excluded.

Local acceptance and pending real publication are reconciled in `verification.md`.
The checked policy/CI/Compose criteria do not assert that images already exist
publicly; AC1, AC4 and AC6 retain the actual Actions/GHCR delivery gate.

## Out Of Scope

Production deployment, automatic polling/updaters, real database operations,
new secret/PAT storage, changing branch protection, rewriting historical SQL,
Docker Hub publication, ARM/multi-arch, semantic version/tag release channels,
registry garbage collection, dependency/runtime upgrades or unrelated canvas UI.

## Risks And Deferred Boundaries

- GHCR may require the owner to set both newly created packages Public once;
  the current local gh session cannot list private packages (no read:packages
  scope). This does not imply the workflow's repository token cannot publish.
- Two package tag updates are not a cross-registry transaction. Matching source
  tags/digest pins are the deployment contract; latest is convenient discovery,
  not an atomic App/Worker update guarantee.
- The CI fixes may uncover later gate failures previously hidden by early exit.
  Preserve real receipts and fix only evidence-backed prerequisites; request a
  scope decision if new runtime/schema/deployment work is needed.
- The standalone worker-contracts DB runner has a separate socket-only readiness
  loop. Independent review identified this existing same-class risk and main
  explicitly deferred it; the three publication gates use the approved shared
  helper correction, not that independent runner.
- Changes are prepared locally first. Registry publication and actual Actions
  evidence remain pending explicit commit/push/run approval; no remote success
  follows merely from static workflow tests.
