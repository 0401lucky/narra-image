# Independent Hosted-CI Follow-up Review

## Findings (fixed)

No additional defects found. The reviewer made no product or fixture edits.
The existing correction provides suite-owned synthetic configuration and restores
it with Vitest's real environment API. All original test bodies, parser imports,
duplicate-media-type rejection and successful relay assertions are unchanged.

The real opt-in import path is `parseGenerateRequest -> canvas/http ->
server/current-user -> db -> getEnv`. It validates configuration and constructs a
lazy Prisma/pg client before JSON validation; this parser path performs no auth
lookup or database query. No parser/getEnv mock or global default is added.

## Findings (not fixed)

None. Hosted verification of the correction and public GHCR publication remain
separate delivery gates, not results of these local tests.

## Verification

All commands ran sequentially using installed Node 24.22.1 and the validated
owner-marked `checks/.runtime/release-integration-5781d68e/app` snapshot with copied
dependencies. `AUTH_SECRET`, `DATABASE_URL` and `APP_URL` were absent before Node
startup. The OS allowlist, isolated home/temp, exact public `.env.example`
exception, unchanged dotenv-deny preload and dependency-link audit stayed active.
No install, client generation, Docker build, database/provider or registry
operation was performed in this follow-up.

| Receipt | Actual result | Duration / deadline |
| --- | --- | --- |
| `preflight.json` | Exit 0; pinned Node, absent variables in parent/child and actual synthetic dotenv denial | 0.199s / 57s |
| `fixed.json` | Exit 0; 20/20 fixture tests | 1.498s / 57s |
| `reverted-negative.json` | Expected exit 1; old source fails 1/20 with the same missing-variable ZodError | 1.439s / 57s |
| `restore-absent.json` | Exit 0; 20/20 real fixture tests with outer hooks checking restored absence | 1.439s / 57s |
| `restore-present.json` | Exit 0; 20/20 real fixture tests with outer hooks checking restored prior synthetic values | 1.439s / 57s |
| `cleanup-negative.json` | Expected exit 1; removing only snapshot cleanup makes all 20 restoration checks fail | 1.554s / 57s |
| `restored-fixed.json` | Exit 0; restored fixture passes 20/20 | 1.442s / 57s |
| `full-vitest.json` | Exit 0; 1,824/1,824 tests, 144/144 files; normal two DB-suite exclusions unchanged | 110.997s / 300s |
| `node-tests.json` | Exit 0; 32/32 Node release/migration/startup/prerequisite tests | 0.813s / 57s |
| `lint.json` | Exit 0; whole-snapshot `eslint .`, 0 errors and 9 existing warnings | 12.530s / 180s |
| `types.json` | Exit 0; installed `tsc --noEmit`, reused isolated generated client | 2.558s / 180s |

The restoration probe imports the unmodified fixture and surrounds its nested
hooks; it does not replace Vitest, production parsing or environment validation.
The prior-value lane seeds only its own parent hooks after confirming a genuinely
absent startup environment. Both snapshot mutations restore the original bytes
in `finally`, and each temporary probe is removed before the full suite.

JSON receipts bind actual exits, deadlines, source-before/source-after identities,
launcher/guard hashes and verbatim stdout/stderr hashes. The negative parser log
has exactly the same SHA256 as the implementer's failure. `source-audit.json`
independently verifies all six implementer receipts and the committed baseline;
`final-audit.json` verifies the review receipts and final whitespace/source state.
The full suite retains unrelated React act warnings, not test failures; lint's
nine warnings are unchanged and outside the corrected fixture.

## Scope And Source Freeze

- HEAD: `651f12af560db529ceb3f23c58ad230c2efdd044`.
- Fixture: `src/tests/unit/canvas-e2e-runtime-fixture.test.ts`, SHA256
  `c76bb69cd11c903ff73c0e7c9bd32dae245d0c9bca369d2f4ae1c09ee3e22ac1`.
- Updated quality spec: `.trellis/spec/frontend/quality-guidelines.md`, SHA256
  `b3a6a5a1f3dd064a75b3a6a2c34f88de89f0545fbaa12d1f6600b410254858e6`.
- All 15 original release product/spec handoff hashes still match. Production
  modules, workflow/gates, environment manifest, global test setup, dependencies,
  Compose and Dockerfiles are unchanged. The new quality contract matches the fix.
- Each prior production/Docker receipt was compared against 834 non-task inputs:
  only the fixture differs. Metadata is excluded by `.dockerignore`; runtime
  sources remain identical. The App builder's broad copy can include tests, so
  prior receipts are not relabeled as fresh builds or byte-identical images of
  this correction. Fresh local types/tests cover the changed test input.

No staging, commit, push, credential change, production action or other-task
modification occurred. The snapshot lock is released: **SOURCE FREEZE / HEAVY IDLE**.
