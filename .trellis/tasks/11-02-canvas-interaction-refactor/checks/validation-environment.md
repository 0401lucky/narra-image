# Validation Environment

- Date: 2026-11-02
- Scope: local code/browser validation only; no live application credentials,
  databases, provider calls, billing, physical device or remote CI acceptance.
- Installed pinned Node: `C:/Users/Administrator/AppData/Local/Temp/narra-history-cleanup-20261029/node-v24.22.1-win-x64/node.exe`, version `v24.22.1`.
- Default shell Node is `D:/node/node.exe`, version `v24.11.1`; do not label its
  earlier safety self-test as pinned runtime parity. Product gates use the
  explicit pinned executable and installed dependency copies; no downloads.
- `pnpm` is absent from this shell PATH. The fixed task runner invokes installed
  ESLint/TypeScript/Vitest/Prisma/Next entry points directly with pinned Node,
  equivalent to package scripts without implicit install.

## Task-Owned Isolation

`isolated_check.py` is adapted from the previously verified project task helper,
with current path/owner identity, dummy canvas URLs, bounded two-worker Vitest
and current task-tool capture. The corrected `deny_env.cjs` remains unchanged;
its native filesystem/custom-promisifier behavior must not be loosened.

All runtime snapshots are new owner-marked direct children of this task's
ignored `checks/.runtime/`. Copy production/public/config/test sources and
current task tools, excluding real dotenv, private configs/keys, runtime/evidence
and caches. Installed dependency files are copied, and internal junctions are
retargeted/audited to remain inside each copy. Prisma cannot write the original
in-use dependency tree. Refresh at source checkpoints before checks.

Construct child environment from OS allowlist before initial Node startup:
synthetic home/temp/npm paths, dummy AUTH_SECRET and deliberately unavailable
loopback database, no caller preloads/proxies/provider/AWS/S3 configuration.
Only the exact hash-verified copied public `.env.example` may be read. Tests
have no APP_URL; build/browser lanes alone use a non-loopback dummy APP_URL.

Commands retain unique receipt IDs, stdout/stderr, actual exit, deadline and
duration. Heavy tests/build/browser run serially under a workspace lock. Guard
self-tests exercise sync/callback/Promise/promisified/ESM/child access, exact
public exception, source filtering, internal dependency isolation, invalid
owner/junction rejection, exit/deadline preservation and network diagnostic.
The initial eight self-tests pass on default Node. All eight also pass with the
explicit pinned v24.22.1 executable; see `pinned-isolation-selftest.json` and log.
Runtime data are ignored, not staged or committed.

The original project's archived helpers/receipts stay unchanged. They are
patterns and historical evidence, never current-product test results. New
browser fixture inputs/build/helpers and native action calibration will be
recorded separately against the final source. Physical/live/CI gaps remain
explicitly unperformed rather than inferred from fake HTTP/CDP success.
