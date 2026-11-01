# Canvas E2E Gates Completion

## Result And Scope

- `e2e-complete-runtime-03`: `pnpm verify:e2e` **PASS**, exit 0,
  646.196 seconds, all nine required scenarios executed without skips.
- The unchanged runner limits remain 30 minutes overall, 120 seconds reserved
  for cleanup, 300 seconds per scenario, and 35 seconds for shutdown. The
  outer isolated wrapper allows 1,920,000 milliseconds. Neither the fixed
  seven-day retention nor the 60-second scheduler interval was shortened.
- This is actual local Docker/Next/Prisma/PostgreSQL/Go Worker execution with
  authenticated synthetic accounts and a private in-memory S3 protocol fixture.
  It is not production, a real provider/S3 test, or a fresh paid generation.
- Source is frozen after the successful run. Main owns the final whole-repo
  quality review, task/spec updates and any archive operation; this implementer
  did not stage, commit, push, deploy or activate another task.

## Actual Scenario Results

| Scenario | Seconds | Executed Assertions |
| --- | ---: | --- |
| `embedded` | 14.236 | Full migration history, Worker topology lock and readyz before Next; clean bounded SIGTERM/drain. |
| `dedicated` | 16.546 | Migration sidecar, two healthy dedicated Workers, app readiness; feature-off Worker has no canvas capability and fake storage sees no versioning/object activity. |
| `conflict` | 16.324 | Second embedded supervisor exits nonzero on the actual exclusive topology conflict; original app remains ready. |
| `schema` | 21.739 | Drop/recreate only the verified fixture schema; Worker/app withdraw readiness; ordinary migration replay restores readiness. |
| `dbdown` | 33.538 | Stop only the owned database; app returns `DATABASE_UNAVAILABLE`; lost topology lock terminates Worker nonzero; normal migration/recreation restores readiness. |
| `propagate` | 7.464 | Generated nonexistent database causes migration/supervisor failure to propagate as a nonzero exit. |
| `canvas-embedded` | 132.497 | Exact enabled capability, invalid/unversioned fake storage transitions, authenticated HTTP/SSR and managed GC assertions below, clean drain. |
| `canvas-dedicated` | 134.110 | Same enabled assertions with two Workers; additional actual canvas-column drift/restore readiness checks; clean drain and app withdrawal. |
| `canvas-mismatch` | 21.632 | Enabled Node rejects a generic-ready, canvas-disabled Worker even with generic Worker readiness optional; enabling the actual Worker restores readiness; shutdown withdraws app readiness. |

Both enabled scenarios execute each of these groups:

1. Seed two synthetic users in the verified database and sign their sessions
   with the production `createSessionToken` helper and the generated test secret.
   Fetch the actual authenticated `/create` HTML and require the enabled
   dual-mode studio markup. This tests HTTP SSR, not browser hydration or login.
2. Exercise actual anonymous/foreign-owner rejection, empty canvas creation,
   four multipart original uploads through the production Node adapter and fake
   S3 HTTP service, same-upload replay, a disconnected-original snapshot save,
   readback and stale-revision conflict. Four originals produce exactly four
   PUTs despite replay; these actions create no job and leave credits at 100.
3. Install a deliberately synthetic already-SUCCEEDED job and COMMITTED run
   through the real SQL reserve/commit functions. The seed uses the production
   `canvasRunSchema`, `canonicalCanvasJson`, exact intent envelope and shared
   request headers, loaded with the installed scoped `tsx/cjs/api` loader.
4. POST the same run to the actual `/api/generate` before and after organization
   deletion; require its original job/image/origin, not a new submission. Check
   actual run lookup and explicit scene-ID runtime resolution. Job/run counts
   remain one, credits remain 100, and the original frozen snapshot/hash and
   imported identity remain unchanged. This is committed replay verification,
   **not** fresh enqueue, precharge, provider handoff or provider completion.
5. Use those same actual API-created imports for GC: an old orphan, a recent
   orphan, a snapshot-rooted import and a completed-job-rooted import whose
   canvas is deleted. Seed one generated-image record/object and one unregistered
   legacy-like sibling object. Only the sentinel-checked fixture transaction
   adjusts database-relative timestamps; production claims/finalizers retain
   their real guards and are invoked only by the running Worker scheduler.
6. Force the fake DELETE to fail. Require actual `DELETING`/`FAILED`, one
   attempt, retained physical accounting and database backoff of 10-3600
   seconds. All six known objects remain readable with their full byte count.
7. Allow DELETE and wait for the real next scheduler pass. Require exactly the
   old orphan to become `DELETED`, two attempts and released accounting. The
   recent/saved/job-rooted imports remain READY with zero deletion attempts;
   snapshot/job roots, canonical job/image, credits and cancel/refund fields
   remain intact. Exact-key HEAD checks and counters prove two DELETE requests
   total, six PUTs, five retained objects and only the orphan's bytes removed.

## Immutable Runtime Inputs

Main explicitly provisioned the base images before any Docker wrapper ran.
The E2E runner did not pull images. It inspected and built from these local IDs:

| Base Reference | Immutable Image ID |
| --- | --- |
| `postgres:17-alpine` | `sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b` |
| `node:24.22.1-alpine` | `sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53` |
| `golang:1.25-alpine` | `sha256:1ae0735f00daffa3aaf1363a5184c0d2dc55c78e3db4ec70241cdac97bf84b59` |
| `alpine:3.22` | `sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f` |

Final built images, both removed after verification:

| Image | Immutable Image ID | Build Seconds |
| --- | --- | ---: |
| `narra-e2e-app:6f7fe86810f08bc6` | `sha256:619dcb27201bb7ec775f9ba3e84cd65edb89406267022f432995caaa9b6f3c58` | 222.159 |
| `narra-e2e-worker:6f7fe86810f08bc6` | `sha256:3d1ff2bc95cd8eeb8112f4d6269e2723fbc61f832c134c1435d60ba5221adcc3` | 7.518 |

- Local endpoint: `npipe:////./pipe/dockerDesktopLinuxEngine`.
- Final independent read-only audit reports Linux Docker `29.9.2`, Compose
  `5.6.1`, and the same four base IDs.
- Build dependency downloads use pinned lockfile npm/Go dependencies without
  inherited registry credentials. `NEXT_TELEMETRY_DISABLED=1` is present in
  the successful app builder stage.
- CI now explicitly provisions all four images outside `pnpm verify:e2e`;
  the runner remains no-auto-pull. Host Go setup remains 1.24, matching go.mod.
  CI YAML parses successfully; a GitHub Actions run itself was not performed.

## Isolation And Cleanup Evidence

- Final run owner: `ba10161f-caf2-4d21-a922-f6a84ce1ebc9`.
- The runner pins the verified local Docker endpoint, uses an owned empty
  config/explicit empty Compose env file, random databases and internal-only
  networks, and PostgreSQL tmpfs. It checks actual database identity plus a
  per-project SQL owner sentinel before fixture access.
- E2E containers publish **no host ports** and may not use host networking.
  All app HTTP goes through owner-checked Docker exec to a fixed container
  `127.0.0.1:3000` destination. Cookie/body data is bounded stdin, never argv.
  Paths/methods/headers, 128 KiB decoded bodies, 256 KiB request envelopes,
  1 MiB responses, input timeout and fetch/body timeout are checked.
- Final cleanup explicitly removed **40 container IDs, 9 network IDs and
  2 tagged build images**. These are final-cleanup counts, not the total ever
  created: normal Compose recreation and `--rm` migration sidecars also remove
  their own previously verified resources. Exact IDs/names and exit codes are
  retained in the raw successful stdout receipt.
- No volume removal, prune, broad Compose down, real database, real object
  storage, or unrelated workload mutation was used. Classic-builder
  intermediate containers use `--force-rm`; ordinary build cache is not pruned.
- `e2e-complete-final-resource-audit-01` passes in 3.591 seconds. Exact owner
  label queries find **zero remaining containers, networks or owned build
  images**; `narra-e2e-aMwtal` runtime scratch is absent. The audit creates no
  workload resources and removes its own separate scratch after read-only
  checks. Base images remain available and unchanged.

## Defects Found And Corrected

These are harness/build/fixture corrections, not changes to production canvas,
billing, migration or Worker lifecycle semantics:

- Runtime 01 built both images and started a healthy migrated embedded app,
  but the host-port safety assertion failed. A controlled local probe showed
  requested `HostIp=127.0.0.1` with an empty actual port mapping on Docker 29's
  internal network. The correction removes E2E published ports and uses the
  bounded internal HTTP transport; it does not accept wildcard binds or enable
  broader network access.
- A new production image-container regression rejected the initial tiny PNG's
  invalid CRC. The fixture now contains a valid 1x1 RGBA PNG; the production
  verifier was not weakened.
- Foreign asset reads intentionally use `CANVAS_INPUT_UNAVAILABLE`/409 rather
  than 404. The fixture now checks the actual contract plus absence of data.
- The ESM helper loader encountered native JSON import-attribute requirements.
  The scoped CJS loader consumes the original pure contracts/validators instead
  of copying normalization or signing code.
- Runtime 02 passed all six legacy scenarios and the actual authenticated
  snapshot/upload smoke, then its run POST failed with 400. The fixture had
  merged `content-type` and `Content-Type`, producing two comma-joined media
  types. Case-insensitive `Headers.set` fixes it. A regression retains the bad
  request rejection and passes the relayed corrected request through the real
  strict generation parser with an unchanged normalized run.
- CI's previous E2E prerequisite step supplied only PostgreSQL. It now
  explicitly supplies every default base image; missing-image preflight stays
  fail-closed. Local assistant metadata, nested dotenv/package credential files,
  build outputs and the unrelated promo subrepository are excluded from Docker
  context; builder telemetry is disabled.

## Checks And Receipts

Receipts and raw logs are under the existing isolated temporary runner:

`C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea/react-flow-spike/logs/`

Main copies final and failed evidence into this task's checks before archiving.
`e2e-complete-source-hashes-01.json` records 17 post-run SHA256 entries for the
owned code/build/CI files and unchanged package/schema inputs, for the independent
reviewer's freeze reconciliation. It is a source fingerprint, not another test.

| Receipt | Result |
| --- | --- |
| `e2e-complete-unit-01` | Expected red: invalid PNG CRC; 78 other tests pass. |
| `e2e-complete-unit-02` | 3 files / 79 tests pass. |
| `e2e-complete-types-01` | Full types pass, 11.812s. |
| `e2e-complete-lint-01` | Scoped lint pass, 2.938s. |
| `e2e-complete-runtime-01` | Exit 1, 353.083s; actual builds/start passed, port assertion failed; exact cleanup completed. |
| `e2e-complete-port-probe-01` | Bounded daemon probe timeout, no resources created. |
| `e2e-complete-port-probe-02` | Actual owned binding inspection proves empty published mapping; manual fixture lacked Compose runtime metadata, so its Compose lookup exits 1; exact container/network/scratch cleanup completed. |
| `e2e-complete-unit-03` | Expected red: native JSON import-attribute requirement; other 101 tests pass. |
| `e2e-complete-unit-04` | 4 files / 102 tests pass. |
| `e2e-complete-types-02` | Full types pass, 12.144s. |
| `e2e-complete-lint-02` | Scoped lint pass, 4.693s. |
| `e2e-complete-runtime-02` | Exit 1, 390.024s; six legacy scenarios + actual authenticated smoke pass; duplicate MIME header caught before GC; exact cleanup completed. |
| `e2e-complete-unit-05` | Final focused 4 files / 103 tests pass, 7.602s. |
| `e2e-complete-runtime-03` | Final all-nine actual E2E **PASS**, exit 0, 646.196s. |
| `e2e-complete-workflow-yaml-01` | Installed js-yaml parses 3 jobs / 4 explicit pulls / preserved wrapper entry; 0.161s. |
| `e2e-complete-final-resource-audit-01` | Exact-label zero-resource audit **PASS**, 3.591s. |
| `e2e-complete-lint-03` | Final scoped lint pass, 4.070s; owned-file `git diff --check` also passes. |

The successful app Docker build additionally executes Prisma generation and the
current Next production compile/types/full route build. Whole-repository final
ordinary tests/types/lint and the fresh independent quality review are recorded
by the main session/checker, not inferred from this focused run.

## Files Changed In This Subtask

- `.github/workflows/verify.yml`
- `.dockerignore`
- `Dockerfile`
- `docker-compose.e2e.yml`
- `scripts/verify-e2e.mjs`
- `scripts/lib/e2e-safety.mjs`
- `scripts/fixtures/canvas-object-store.mjs`
- `scripts/fixtures/canvas-runtime.mjs` (new)
- `src/tests/unit/canvas-e2e-runner.test.ts`
- `src/tests/unit/canvas-object-store-fixture.test.ts`
- `src/tests/unit/canvas-e2e-runtime-fixture.test.ts` (new)
- `src/tests/unit/canvas-e2e-http-fixture.test.ts` (new)
- This report.

No schema, published migration, backend service, Worker runtime, frontend
component, production Compose or shared PostgreSQL/env helper was changed here.

## Remaining Boundaries

- Real production/development data, real S3/versioning/deletion permissions,
  paid providers, fresh billable end-to-end generation, login-flow testing and
  deployment remain outside this authorized verification.
- Actual browser hydration/gestures/native IndexedDB are covered by the earlier
  separate production-Next/fake-HTTP browser fixture, not by these HTTP relay
  checks. Physical phones and OS-native IME remain manual gaps.
- Docker warns that the classic builder is deprecated; the runner intentionally
  does not silently switch to an unreviewed remote/pulling builder. Native Node
  also emits a harmless typeless-package warning for the existing session TS
  helper. Neither warning is represented as a failed readiness or hidden skip.
