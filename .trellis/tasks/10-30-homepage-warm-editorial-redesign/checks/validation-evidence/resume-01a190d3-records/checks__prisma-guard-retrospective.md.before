## Bug Analysis: Prisma Guard Promisification

### 1. Root Cause Category

- Category: B (cross-layer contract), D (coverage gap), E (implicit assumption).
- The task-owned preload wrapped `fs.exists` as though preserving its callback
  were sufficient. Prisma consumes `util.promisify(fs.exists)`, whose special
  boolean-only contract depends on `util.promisify.custom`. Losing it caused a
  rejection with primitive `true`, shown by Prisma as `Error: undefined`.

### 2. Why Fixes Failed

No speculative production fix was attempted. Initial safety tests covered
direct, callback, promises and ESM reads but not the custom-promisified API.
The first actual Prisma gate exposed the missing consumer. A read-only probe
then discriminated this from schema, missing engine, download or Node-version
issues; the new regression failed before the narrow fix.

### 3. Prevention Mechanisms

| Priority | Mechanism | Action | Status |
| --- | --- | --- | --- |
| P0 | API contract | Supply a custom Promise<boolean> that calls the guarded exists, never the unguarded native custom function | Done |
| P0 | Regression | Check allowed public/ordinary files, denied dotenv, missing/invalid paths, callbacks, promisified and ESM consumers | Done; eight safety tests pass |
| P1 | Integration | Run real copied Prisma generate with an extra no-network guard, then rerun product build/full tests under the final preload | Done |
| P1 | Documentation | Record special Node callback/custom-promisify preservation in frontend quality specs | Done |

### 4. Systematic Expansion

- Other API wrappers must preserve special signatures, descriptors and error
  conventions; direct-call parity alone does not prove consumer compatibility.
- Keep credential-free snapshots as the primary boundary. A shim bug must not
  be resolved by allowing real dotenv reads or downloading alternate tooling.
- Preserve independent red/green receipts, source hashes and the original guard
  bytes. Distinguish runner defects from product regressions.

### 5. Knowledge Capture

- Updated `.trellis/spec/frontend/quality-guidelines.md`, section 8.
- Evidence: `validation-evidence/prisma-runner/` and `validation-environment.md`.
- Real generate uses installed Prisma 7.7.0, no download; final production build
  and all 136 non-DB test files / 1610 tests pass under the corrected preload.
- Template sync is not applicable: this application has no
  `src/templates/markdown/spec/` mirror. No commit/archive was made, per the
  explicit task authorization boundary and incomplete acceptance criteria.
