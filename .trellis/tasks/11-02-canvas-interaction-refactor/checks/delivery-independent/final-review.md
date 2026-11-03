# Final Independent Canvas Delivery Review

## Verdict

- Independent code review of the complete task scope is complete after one
  narrowly scoped P2 UI fix. No unfixed product defect was found.
- Fresh integrated-source lint, strict types, targeted tests, full non-DB tests
  and Prisma generation pass. The production build is NOT a pass: Next compiled
  and completed TypeScript, then its 15-worker page-data phase exited 134 with
  native allocation OOM. A resource-safe build retry remains necessary.
- The main session must complete the rebuilt current-source browser matrix and
  build gate before calling local automated verification complete. This review
  does not authorize deployment or certify physical devices/live services/CI.

## Findings Fixed

1. P2 - `src/components/create/parts/canvas-image-toolbar.tsx:49`: the toolbar
   captured a missing React Flow card once and never rediscovered it. A newly
   imported/selected image could mount after that effect, leaving controls at
   the fallback rather than attached to the card. The update now rediscovers the
   captured node ID, transfers ResizeObserver ownership, and watches child-list
   mount/removal. Both observers are disconnected on cleanup. No camera, scene,
   permissions, original lease or generation behavior changes.
2. `src/tests/unit/canvas-image-first-stage.test.tsx:47`: added the actual toolbar
   late-mount/removal regression without fake viewport resize. The unmanaged
   fixture DOM is always removed in `finally`; its card geometry shadows only
   that instance rather than mutating the existing prototype spy. An explicit
   reference-kind guard preserves strict typing without a cast.

The negative control `20261103T022116-test-8d201c` runs the regression with only
the isolated toolbar copy replaced by its pre-fix bytes: exactly 1 failure and
17 passes, with the stale 8px fallback. The fixed isolated bytes are restored
exactly afterward. `negative-control.json` records the deliberate one-file
snapshot override; it is not represented as a current-source gate. A later
typing-only guard changes final test bytes, not the negative-control semantics.

## Findings Not Fixed

- No remaining in-scope product finding.
- Build/environment gate: `20261103T024448-build-883048` exits 134 during page
  data collection with native `HashMap::Initialize` / zone allocation OOM.
  No syntax/type/compiler error precedes it. The owned production lane has no
  remaining Node process after exit. The OS audit reports 5,918,164 KiB free
  physical memory and only 2,558,908 KiB free virtual/commit capacity. No
  production config, dependency, memory limit or test was weakened to hide this.

## Full-Scope Coverage

Read the curated check manifest, PRD/design/execution plan, relevant frontend
and operations contracts, reference/seam research, all 24 task source/test files
and the three changed frontend specs. `review-source.json` enumerates the exact
scope and hashes. Review includes the integrated remote R2/Windows-loader and
homepage compatibility changes; those contributions are preserved.

- AC1/AC2: controller quick creation and prompt repair use guarded complete
  candidate validation/publication; private prompts, shared sources, ordered
  canonical inputs, reserved capacity and immutable older results survive.
- AC3: whole-card pointer movement has renderer-local preview, one final write,
  final release coordinates and live owner/camera/source/viewport guards.
  Native Flow pointer-position writes stay disabled; explicit keyboard movement
  and viewport-scoped Delete retain text/IME/control opt-outs.
- AC4/AC6: composer placement is screen-space and does not shrink/move the
  scene. Late Flow mount discovery, bounded dense insertion, stable native
  textarea identity, shared/missing prompts and pending-field lifetime are
  covered by the real components/controller and geometry tests.
- AC5: all-or-none staged imports, captured chooser/cancel lifetimes, explicit
  image ordinals and atomic source replacement preserve accepted inputs on
  rejection. Existing strict readiness/canonical checks are reused.
- AC7: the integrated full suite preserves Save/CAS/outbox/terminal/draft/media
  lease/jobs/owner and conversation regressions. No schema/API/Worker/storage
  migration, automatic Run/Save/upload or credential persistence is introduced.
- AC8: fresh gates below bind to the integrated copied source. The historical
  10-case browser receipt is not relabeled after these source/integration changes;
  main owns the fresh rebuilt browser run.

## Fresh Verification

Base HEAD: `e42ff7a74fb7d1c0e4507c960720bb0dc973f1ab`.
Pinned Node: `v24.22.1`. Installed dependencies are copied and links audited;
Node starts with the task-owned clean environment, synthetic home/temp and dummy
unavailable database/credentials. Prisma writes only the dependency copy.

| Gate | Receipt | Result |
| --- | --- | --- |
| Targeted creation/placement/stage | `20261103T024011-test-18ed81` | PASS, 3 files / 33 tests |
| Root ESLint including copied task tools | `20261103T024053-lint-cca071` | PASS, 0 errors / 9 existing warnings |
| Strict TypeScript | `20261103T024145-types-65e9ed` | PASS |
| Full non-DB Vitest | `20261103T024223-test-0326aa` | PASS, 143 files / 1812 tests, one full receipt |
| Isolated Prisma generation | `20261103T024431-prisma-a08489` | PASS |
| Actual application production build | `20261103T024448-build-883048` | FAIL, exit 134 native OOM |

All six receipts have finite deadlines, no timeout, no source changes during
execution and no unintended snapshot modifications. `gates.json` indexes exact
raw JSON/stdout/stderr hashes; `gate-inputs.json` retains copied input hashes.
Earlier red/fixture/type receipts remain in `evidence/` and are not overwritten.
Existing React act diagnostics remain unsuppressed warnings. Database suites,
live S3/R2/provider/Worker/authentication and remote CI are not claimed by this
non-DB receipt or Prisma generation.

## Source Handoff

Only two of the 24 originally frozen task source/test files change in this review:

- `src/components/create/parts/canvas-image-toolbar.tsx`:
  `c4b249104e4bd9179a30280d685eef8b2ed9e0f5f470aff3342acd6b8792b6e0`
- `src/tests/unit/canvas-image-first-stage.test.tsx`:
  `44cd164686f5359e533a62d11b9d4e37e568f81758f18180a20a32179bf22e10`

The other 22 historical task source hashes remain unchanged. Final raw source
audit finds no drift. Main owns spec updates: document that the selected-image
toolbar, like the composer, must rediscover late-mounted/replaced Flow DOM and
clean up both mount and resize observation. Refresh all ten browser cases on the
integrated source, especially selection/import/continuation (B2/B4/B5).

No reviewer staging, commit, push, merge, archive, deployment or unrelated source
edit occurred. The production lane is unlocked; no heavy retry/browser work is
running from this reviewer. Physical phones/OS input/chooser/download, real
services and actual CI remain explicitly unperformed.
