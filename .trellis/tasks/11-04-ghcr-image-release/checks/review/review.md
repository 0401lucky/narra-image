# Independent GHCR Release Review

## Findings (fixed)

- File: `scripts/tests/image-release.test.mjs:85`
- Issue: The release policy tests did not exercise the actual CLI's first-package
  bootstrap, Actions output wiring, summary output, or immutable rerun outputs.
- Fix: Added a credential-free mocked CLI regression for two `NAME_UNKNOWN`
  packages, authenticated `pull,push` preparation without a prior Docker login,
  build digest inputs, separate anonymous verification, matched digest summary,
  immutable rerun outputs, and absence of the job token from logs/artifacts.
  No production-code defect was found in the reviewed implementation.

## Findings (not fixed)

- The independent `src/tests/integration/worker-contracts/postgres-runner.ts:600` runner's
  `waitForPostgres` at line 600 still uses a socket-only probe. This is a
  pre-existing same-class readiness risk in `verify:worker-contracts:db`, not a
  consumer of the corrected shared helper or one of the three publication gates.
  Main explicitly deferred that separate runner rather than expand this scope.
  No unresolved in-scope finding blocks the reviewed local release changes.

## Verification

All Node commands ran in the fresh owned `release-check-238dde99` snapshot using
installed Node 24.22.1 and copied dependencies, with credential-filtered startup,
denied real dotenv reads and a deliberately unavailable dummy database. No
dependency installation, production connection, registry write, stage, commit,
push or server operation was performed by this reviewer. Heavy gates ran serially.

| Gate | Receipt | Result |
| --- | --- | --- |
| Baseline Node tests | `20261104T093339-node-tests-bb76b7` | PASS, 31 tests before reviewer coverage |
| Final Node tests | `20261104T093640-node-tests-53e790` | PASS, 32 tests |
| Full non-DB Vitest | `20261104T093709-test-dae8ee` | PASS, 144 files / 1,824 tests, 123.9s |
| ESLint | `20261104T094106-lint-ab81ce` | PASS, 0 errors / 9 existing warnings |
| TypeScript | `20261104T094150-types-d4b5ff` | PASS, `tsc --noEmit` |
| Tracked and new product-file whitespace | `review-final-source.json` | PASS; no-index additions use Git's expected difference exit status |

Full raw receipts/stdout/stderr are preserved under `evidence/`. The test stderr
retains existing React act warnings; those are not erased or counted as failures.
The two sentinel DB suites remain excluded from the non-DB run. The final-source
record binds all four final gates' before/after hashes to the same 12 current
product/docs/test files, identifies the one reviewer-edited test, and hashes the
reviewed operations specs. The baseline receipt remains a distinct older result.

## Scope And Spec Consistency

- Reviewed the complete workflow, registry helper and CLI, CI stage changes,
  shared database probe, both Dockerfiles, overlay and operator documentation.
  Original-repository/main-push guards, all three success gates, read-only
  defaults, publication-only package write, exact SHA checkout and serialized
  noncancelling publication agree between code and design.
- SHA-tag reuse, strict missing versus denied/network handling, expected digest
  checks, bounded metadata reads, redirect credential stripping, independent
  anonymous access, stale-main fencing and partial latest diagnostics are
  implemented consistently. Fixed SHA/digest pairs, not independent latest
  aliases, are the deployment contract.
- First-package preparation uses the helper's own authenticated token exchange
  and does not require Docker login or an existing package. A denied token is
  intentionally not converted into permission to build. The mocks establish
  this decision/wiring, not GHCR's actual first-package permission behavior.
- Both final images retain LICENSE and THIRD_PARTY_NOTICES; OCI metadata keeps
  the application's AGPL identity without replacing the preserved MIT notices.
  The image overlay removes inherited builds while preserving the base topology;
  docs retain project/volume identity, backup, graceful stop, forward migration,
  readiness and current-binary rollback preflight.
- Main's `operations/image-publishing.md`, operations index and release-hardening
  updates match the reviewed implementation. Main corrected two review wording
  notes: null is returned only in the explicit missing-allowed lookup mode, and
  TCP readiness describes the shared helper rather than claiming the standalone
  worker DB runner was fixed. Those corrections were reread and verified.

## Evidence Boundaries And Handoff

Main separately owns actual merged Compose checks, disposable TCP database
cycles, clean-client generation checks, official action pin lookups, final Next
and Dockerfile builds, and the later authorized Actions/GHCR run. This review
does not relabel those as reviewer-performed checks or claim first publication,
public pulls, Linux build success, production readiness or a deployed update.
GHCR's private-first-publication setting and any partial alias failure require
the documented owner/rerun path; no automatic registry or database rollback is
introduced.

Reviewer product/test source is frozen after the final gates. Main may refresh
its integration snapshot and take the heavy-validation slot. Task evidence/spec
edits remain main-owned and are not a reason to alter the frozen product files.
