# CI And Container Release Research

## Baseline And Evidence

Inspected on 2026-11-04 at clean main
`66a4d0273f9fd3229336945ed06d87d1995943dd`. The user approved a new task and
public GHCR direction; this report is research, not implementation approval.

Current public Actions run:
https://github.com/0401lucky/narra-image/actions/runs/41798479538

- `verify:e2e` succeeds. Its log records successful App build/tag at 08:22:23Z
  and Worker build/tag at 08:22:55Z; these are disposable runner-local images.
- `verify:ci` fails before generation/build with missing `@prisma/client` exports.
  A source/diagnostic comparison with run `41580622136` finds the same 188
  normalized TypeScript diagnostics, not a new canvas regression.
- `verify:migrations` reports `FATAL: the database system is shutting down`
  on its first CREATE DATABASE after readiness. The previous main run has the
  same failure. Raw observation remains in the previous task's ignored runtime;
  the URLs and job IDs are authoritative remote evidence, not a local DB pass.
- Jobs: current CI `126468164425`, migrations `126468164517`, E2E
  `126468164143`; previous CI `125734343480`, migrations `125734343593`.

## CI Fix Seams

- `.github/workflows/verify.yml:3` triggers on main pushes and pull requests.
  Three independent jobs run existing wrappers. No package-write permission,
  registry login or image publication exists.
- `scripts/verify-ci.mjs:29` defines ordered stages. Node tests precede tsc,
  but no Prisma generation stage runs before tsc at `:42`. `pnpm build` later
  runs `prisma generate && next build`, which cannot repair the earlier exit.
- `pnpm-workspace.yaml:1` only permits selected dependency build scripts;
  relying on package installation to generate the client is not a supported
  prerequisite. Explicit generation is required on clean runners.
- `prisma.config.ts:5` attempts local `.env` loading; verification must keep the
  established credential-isolated environment. Build-only dummy APP_URL cannot
  leak into tests that check defaults. Later Next build in verify:ci also needs
  valid synthetic production build environment, not real deployment credentials.
- `scripts/lib/disposable-postgres.mjs:273` calls `pg_isready` without `--host`,
  which can accept the initialization Unix socket. The official image entrypoint
  starts its temporary server with `listen_addresses=''`, initializes the DB,
  stops it, then starts the normal server. Explicit container loopback TCP
  readiness avoids the false positive without raising the 20s deadline.
- `runPsql` at `:335` and owner-checked container startup/cleanup remain reused;
  no persistent database migration, retry budget or cleanup policy must change.
- Existing tests: `scripts/tests/release-startup.test.mjs`,
  `scripts/tests/migration-safety.test.mjs`, `local-docker-safety`,
  `canvas-e2e-runner`, `runtime-environment-contract` and sentinelled DB suites.
  Add behavior tests for stage order/failure and TCP readiness, not only YAML
  string assertions or arbitrary sleeps that conceal initialization races.

## Docker And Compose Seams

- Root `Dockerfile:1` pins Node24.22.1/Go1.25 and builds the app with dummy
  build inputs. Its runner includes Next, Worker, prompt sync, rollback preflight
  and migration scripts, enabling existing embedded deployment.
- `worker/Dockerfile:1` produces a separate Alpine dedicated Worker and includes
  the same operational binaries and shared contracts. Current Linux builder
  matches approved amd64 scope; multi-architecture work is unnecessary.
- `docker-compose.yml:49` uses `APP_IMAGE` for migrate/app, and `:66` uses
  `WORKER_IMAGE`. Migrate/worker retain local build sections. A small override
  can require both existing image selectors and reset build to null without
  duplicating the entire environment/volume/network/healthcheck model.
- `docs/production-operations.md:36` defines embedded/dedicated boundaries;
  `:153` requires rollback preflight. Update docs must retain complete DATABASE_URL,
  forward-only migrations, backup, graceful stop and readiness checks.
- `.dockerignore` excludes assistant metadata, dotenv, credentials and unrelated
  workspaces. Registry jobs must use this exact repository context, not upload
  task evidence, real credentials or a generated deployment snapshot.
- `APP_IMAGE`/`WORKER_IMAGE` already exist as Compose-only selectors. Reuse them
  without inventing a new Node/Go runtime variable or widening the environment
  manifest. New managed runtime variables would need the normal manifest gate.

## Official External Contracts

Read directly on 2026-11-04 (documentation, not a performed registry operation):

1. https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
   - Repository-associated package publication can use GITHUB_TOKEN.
   - Public container images support anonymous access.
   - "When you first publish a package, the default visibility is private."
   - OCI `org.opencontainers.image.source` links the source repository;
     `org.opencontainers.image.licenses` holds an SPDX identifier.
2. https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
   - Package visibility and repository-inherited permissions are distinct.
   - The package owner can set Public in package settings. Do not assume a
     made-up REST PATCH endpoint or a token scope change is available.
3. https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
   - Concurrency serialization alone does not guarantee dispatch order.
     Recheck current main before moving latest; do not let an old delayed job
     override a newer publication or cancel a running multi-image promotion.
4. https://docs.docker.com/reference/compose-file/merge/
   - `!reset null` removes inherited attributes. Require a modern Compose v2
     baseline and verify the merged model, not an unparsed override file.
5. https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh
   - `docker_temp_server_start` uses `listen_addresses=''`; temporary startup
     and shutdown precede the final TCP-serving postgres process.

## Registry Bootstrap And Boundaries

The repository is public and the local gh identity has repo administration.
Listing its container packages returns403 due to missing read:packages scope.
This is not evidence that the separate workflow GITHUB_TOKEN cannot publish.
Do not request/store a PAT just for ordinary workflow publication. First push
may need the owner to change two package visibility settings once; final public
acceptance requires an anonymous manifest check, not an authenticated pull.

Using the same verified commit does not mean a later Buildx build is byte-for-byte
the earlier disposable E2E image: base tag/cache state can differ. Bind the final
registry digests and source labels explicitly; do not falsely promote old test
hashes. Source-tag immutability is a workflow contract, while digest pinning is
the registry content identity. Cross-package latest promotion is not atomic.
