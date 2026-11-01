# Bug Analysis: Recovery And Verification Boundaries

## 1. Root Cause Category

- B/D, cross-layer contract and coverage gap: SQL emitted 23514 while Node and
  mocks assumed P0001. Type checking cannot detect two independently invented
  string contracts; real Prisma adapter coverage still needs actual SQL values.
- C/E, propagation and implicit assumptions: E2E verified a local Docker
  endpoint, but older shared/standalone DB runners inherited context. A random
  localhost database name does not prove the Docker daemon itself is local.
- B/D, recovery gaps: cloud deletion and failed native tombstones crossed
  persistence boundaries; multi-run recovery processed a terminal batch before
  sibling counts were known and never retried that exact binding.
- D/E, incomplete async boundary: aborting a fetch was assumed to settle the
  command; fetch or JSON that never settled left the conversation loading guard.
- D/E, library-runtime gap from the previous session: mocked dynamic retry did
  not model Turbopack's cached rejected chunk promise.

## 2. Why Earlier Checks Missed Them

- Handwritten P0001 failures copied the mapper's assumption instead of reading
  the migration contract; unit successes never established SQL execution.
- Safe E2E helper tests did not exercise the separate DB command boundary.
- Normal Delete tests persisted tombstones successfully; normal restore tests
  usually had one run or local outbox counts. Combined failure paths were absent.
- Settled-promise tests proved stale response guards, not bounded waiting.
- Recreating a React loader changed component state but not the bundler cache.

## 3. Prevention Mechanisms

| Priority | Mechanism | Applied Evidence |
| --- | --- | --- |
| P0 | Derive SQLSTATE from actual migration, use exact allowlisted mapper | Seven red failures, real Prisma raw/CRUD fake-driver tests and route/fence green. |
| P0 | One shared pinned-local Docker boundary at both DB command entry points | Remote/context-change/config/owner/no-volume regression; no real resources. |
| P0 | Honor explicit cloud tombstone before local terminal recovery | Quota/CAS/uncertain-shell/selection/phone cases and actual native-browser stale-draft case. |
| P1 | Reconcile only current scene-bound terminal cache after hydration | New-device count2/count1, missing/pending siblings, zero-addition completion and once-only refresh. |
| P1 | Bound fetch plus JSON and settle ignored aborts | Fake-clock timeout/cursor-retry regressions; no async global rewrite. |
| P1 | Real production chunk failure acceptance | Fourteen-group Next/browser fixture includes honest guidance and explicit F5 without replay. |

## 4. Systematic Expansion

- Reviewed full generation/storage/runtime and frontend owner/source flows,
  not just the original lazy component. Expanded the Docker fix to the shared
  migration helper because that helper is also used by canvas verification.
- Kept hard distinctions between unit/fake transport, native browser/fake API,
  production compilation and positive database/topology execution. Missing
  local images remain an unmet gate, not pressure to use real credentials.
- Saved command receipts, failing and passing logs, source hashes and handoff
  to task artifacts so another interrupted session need not infer final state
  from an old progress table or a one-off summary.

## 5. Knowledge Capture

- Updated frontend canvas/state specs with authoritative deletion recovery,
  scene-only terminal reconciliation, bounded conversation reads and real
  failed-chunk semantics; tests name the exact assertion points.
- Updated operations canvas/release and worker-contract specs with SQLSTATE,
  shared Docker safety and the worker/canvas versus legacy migration environment
  distinction. Existing seven-section executable contracts are retained.
- This application has no matching bundled spec-template tree to synchronize.
  No commit is performed: user authorization preserves the uncommitted patch.
  Positive infrastructure and full release acceptance remain open in handoff.md.
