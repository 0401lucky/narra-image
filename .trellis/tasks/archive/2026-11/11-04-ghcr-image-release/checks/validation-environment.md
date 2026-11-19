# Release Validation Environment

Local validation uses the previously audited isolation primitives copied into
this task, with a distinct owner kind and fresh ignored runtime snapshots. The
actual dotenv filesystem guard, copied-dependency junction audit, owner-path
checks, deadlines/real exits and process cleanup remain intact.

Source capture now includes pnpm-workspace.yaml, the image-only Compose overlay,
operations documentation and this task's authored helpers. Historical evidence
directories are excluded. Node24.22.1 and installed dependencies are used without
install fallback; Prisma generation writes only the dependency copy.

Every Node child starts with an OS-allowlisted environment, synthetic home/temp,
no inherited caller preloads/proxies/credentials, deliberately unavailable dummy
database and exact hash-checked public .env.example exception. Tests receive no
build APP_URL or production settings. Only local build children use the verified
Next two-worker CIRCLE_NODE_TOTAL setting. No production config is changed.

`node-tests` runs repository scripts/tests/*.test.mjs using pinned Node. Lint,
types, non-DB Vitest, Prisma and actual Next build use installed direct entry
points, the package-script equivalent when pnpm is absent from the shell.
Heavy work is serialized through the snapshot lock.

Docker Compose config checks use an empty synthetic Docker config and explicit
dummy env-file/project paths; they do not start containers or read live .env.
Actual local DB/E2E needs a reachable supported local daemon and installed
approved images. Missing prerequisites remain unperformed rather than falling
back to a real database or silently installing dependencies.

No registry login/push or package-setting change occurs in local verification.
Anonymous/public HTTPS and official action-pin GETs are research evidence only;
mocked registry responses do not establish actual publication. First real
Actions/GHCR delivery has a separate user-approval gate.
