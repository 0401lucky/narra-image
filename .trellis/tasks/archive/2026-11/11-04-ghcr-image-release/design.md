# Verified GHCR Release Design

## Status And Architecture

Approved design for the scope in `prd.md`. The user's subsequent "没问题"
authorizes implementation and scoped local checks; see
`checks/implementation-approval.md`. Remote publication requires separate
delivery approval.

Extend the existing `verify` workflow with one publication job, rather than a
second independent verification pipeline or a privileged workflow_run consumer.
Keep existing application/Worker Dockerfiles and runtime/SQL contracts.

```text
main push at exact SHA
  -> verify-ci / verify-migrations / verify-e2e
  -> all successful + trusted repository/main/push guard
  -> serialized GHCR publisher for that same SHA
  -> resolve existing source tags or build/push missing amd64 images
  -> verify both image metadata/digests + anonymous manifest access
  -> recheck current main -> promote both latest aliases by digest
  -> Actions summary: source SHA, both digest pins, result and update commands

operator chooses one published SHA/digest pair
  -> image-only Compose config validation and pull
  -> backup / graceful stop -> forward-only migration -> worker/app readiness
```

## Workflow And Permission Boundary

- Publication requires `needs: [verify-ci, verify-migrations, verify-e2e]`, all
  successful, `push`, `refs/heads/main`, and the intended original repository.
  Do not use `always()` or continue-on-error to bypass failed/missing checks.
- Global validation permissions are read-only `contents: read`. Only the
  publication job has `packages: write` plus `contents: read`. Checkout is bound
  to `github.sha` with persisted checkout credentials disabled where applicable.
  PR/fork events never log into the registry or write cache/package state through
  this job. No pull_request_target or cross-workflow artifact execution is needed.
- Use maintained official Docker setup-buildx/login/build-push actions, pinned
  to verified commit revisions at implementation time. Use distinct per-image
  build cache scopes. Do not add QEMU or change existing base runtime versions.
- Serialize publication with a repository-scoped concurrency group and
  cancel-in-progress false. Do not rely on scheduler arrival order: compare the
  current remote main SHA immediately before alias promotion. An outdated run
  may retain its valid source images but must not move latest backwards.
- Publishing is bounded by a 30-minute job timeout. Registry operations are
  individually bounded; transient/network/denied responses fail clearly, not
  silently treated as a missing image. Existing CI/DB runtime deadlines and
  production timeout values remain unchanged.

## Image Identity And Promotion

```text
app:    ghcr.io/0401lucky/narra-image-app:sha-<40 lowercase hex characters>
worker: ghcr.io/0401lucky/narra-image-worker:sha-<same SHA>
pin:    ghcr.io/0401lucky/<name>@sha256:<64 lowercase hex characters>
alias:  latest (discovery convenience, not an atomic deployment reference)
target: linux/amd64
```

Validate the fixed repository/image names and SHA/digest syntax before any
registry or Docker operation. Do not interpolate untrusted event titles, branch
strings or arbitrary user URLs into shell commands. Registry credentials never
enter build args, image layers, command logs or exported summary artifacts.

1. Probe both SHA tags. A genuine manifest-not-found is the only build-missing
   case. Denied, malformed or network errors are failures, not an overwrite path.
2. An existing SHA tag must point to an amd64 image with matching OCI source and
   revision labels; preserve its digest and reuse it on rerun. Do not rebuild
   then overwrite it merely because its Docker base tag has changed.
3. Build each missing image from the checked-out exact source with its existing
   Dockerfile and push only its SHA tag. Stamp source, revision and
   `org.opencontainers.image.licenses=AGPL-3.0-only` metadata using the build
   action; retain the existing third-party license notices.
4. Resolve and validate both pushed/reused digests, then verify anonymous
   manifest access independently of the login context. For public OCI access,
   use the registry's anonymous bearer challenge, not an authenticated Docker
   config whose cache could hide private visibility.
5. Recheck current main and promote latest from those exact digests without
   rebuilding. Report a stale-main skip distinctly. No verification/build/public
   access failure reaches this step.
6. Emit a nonsecret summary/JSON record containing sourceSha, platform, each
   image name/source tag/digest, anonymous verification, and promotion status.

There is no transaction across two GHCR packages: a network failure between two
alias writes can leave different latest aliases. Fail the job, retain both fixed
source tags and the partial-promotion diagnostics, and document rerun. Operators
pin the matching SHA pair or digests from a complete release, never assume two
independent latest pulls form a version transaction. Do not delete images or
retag an older version automatically as a hidden rollback.

## Public GHCR Bootstrap

GitHub may create both packages private on first push. Repository-linked
GITHUB_TOKEN provides publishing rights, not proof of anonymous access. If the
public check fails after initial SHA uploads, do not promote latest or claim a
complete public release. Show the package settings links and the one-time
Public/access instruction, retain uploaded SHA tags, then rerun the failed job
after the owner changes visibility. The existing matching tags are reused.

Do not invent a package-visibility REST endpoint, change personal token scopes,
or add a PAT secret. Current missing local read:packages scope is not a reason
to block local implementation or leak/reuse another credential. First real
publication is verified only after separately approved delivery.

## CI Prerequisite Corrections

### Prisma And Build Environment

`scripts/verify-ci.mjs` must explicitly run Prisma Client generation before
TypeScript and tests, with the existing script/CLI and normal failure propagation.
Reuse stage runner deadlines; add a generation stage with a bounded timeout,
without increasing existing stage budgets to mask failures.

Keep environment lanes distinct. Local checks use a current-source isolated
copy and no actual dotenv. The production-build stage needs only synthetic
build-valid configuration, not real database/provider credentials. Dummy APP_URL
and production build settings must not leak into preceding Vitest/default-env
tests. If a genuine later CI defect is exposed, record evidence and restrict
the fix to this release gate; schema/runtime redesign returns to planning.

### Disposable PostgreSQL

Use `pg_isready --host 127.0.0.1 --port 5432` inside the exact owned container.
The official initialization-only server listens on a Unix socket and will not
pass that probe. Keep the existing 20-second overall ready window, short probe
deadline, local pinned Docker endpoint, random owner marker and no-volume cleanup.
No arbitrary sleep, production connection, port broadening or schema repair is
needed. Other consumers of the shared helper receive the same corrected probe.

## Image-Only Compose And Operator Documentation

Add `docker-compose.images.yml` as an explicit overlay over the current base.
Require `APP_IMAGE` for migrate/app and `WORKER_IMAGE` for worker. Reset the two
inherited build blocks with Compose `!reset null`; document a modern Compose v2
baseline (2.24.4+), and validate the actual merged JSON model. No new runtime
environment variable or duplicated base environment/service tree is needed.

Documentation in README and the existing production operations guide includes:

- Exact image locations and the difference between full App (embedded-capable)
  and dedicated Worker, plus Linux amd64 and initial public-visibility setup.
- A matching full source tag or digest pair, populated from the release summary.
  Preserve existing credentials/settings instead of replacing a live `.env`.
- `docker compose ... config --quiet`, explicit pull, graceful stop of app/worker,
  forward-only migration with its exit checked, then worker/app startup and
  readiness. Image-only commands prohibit local builds; do not print secrets.
- Backup and current-image record before update. Failure leaves a clearly
  interrupted deployment for the operator; do not automatically start mixed
  versions, erase the database or run repair/baseline/seed.
- Existing rollback preflight using the current operational binary before
  choosing an older image pair. No schema downgrade or `down --volumes` advice.
- Zeabur/embedded can choose the full App image manually; no automated server
  control, SSH secret, watcher or platform integration is introduced.

## Code Boundaries And Testing

Likely touched files: workflow, `scripts/verify-ci.mjs`, shared disposable DB
helper, narrow release helpers/CLI, release/readiness tests, the Compose overlay,
README and production operations docs. Keep policy pure where possible and inject
registry/process adapters for negative tests. Reuse the existing command-runner
instead of adding a parallel unbounded subprocess framework.

Test YAML/job guards and actual release decision behavior: failed dependencies,
PR/fork/ref rejection, missing/denied/malformed images, pinned rerun, no early
latest, stale current-main, anonymous versus authenticated access, and partial
promotion. Also test actual merged Compose using dummy configuration and no
daemon mutation. Local Docker/CI end-to-end follows the repository's disposable
resource contract and cannot borrow real auth/database/provider state.
