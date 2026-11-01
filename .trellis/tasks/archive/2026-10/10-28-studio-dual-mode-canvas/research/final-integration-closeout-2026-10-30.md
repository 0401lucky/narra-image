# Final Integration And Closeout Plan

Date: 2026-10-30. Plan approved in a subsequent user message after final review.
Active task: `.trellis/tasks/10-28-studio-dual-mode-canvas`.

The observations and gaps below are the preserved pre-execution planning
record. Approved execution receipts belong in
`checks/final-integration-2026-10-30/` and the parent verification/handoff.

## Goal And Boundaries

Close the existing integration parent against unchanged R1-R17/AC1-AC17. Reuse
the completed history-cleanup and canvas-v1 implementations; do not create a
duplicate task, redesign the editor or start the independent mobile follow-up.
The user has confirmed the final summary; only this recorded scope is approved.

No staging/commit/push/deployment/production enablement, real dotenv reads,
development/production DB, real S3 or paid provider operations. Only labelled
isolated test resources are in execution scope. Preserve every existing patch.
Passing acceptance permits parent-only archive and journal with `--no-commit`;
it is not merge, rollout or phone-editor approval.

## Evidence Inspected

Paths below are relative to `.trellis/tasks/archive/2026-10/`:

- `10-28-studio-history-cleanup/verification.md` and `handoff.md`: HA1-HA4,
  four-file/32-test targeted check, original 79-file/411-test suite, build and
  nine component-fixture browser checks. These are predecessor evidence, not
  the final changed studio's complete acceptance.
- `10-28-studio-canvas-v1/verification.md` and `handoff.md`: final CA1-CA13 and
  explicit manual/release boundaries. Historical red/preflight results are
  superseded only by their recorded successful later gates.
- `10-28-studio-canvas-v1/checks/infra-final-review.md` and
  `checks/infra-completion-2026-10-30/evidence.json`: 120 files/1386 ordinary
  tests; 64 real PostgreSQL cases; Worker TS/tagged-Go DB; five migration groups;
  nine real container scenarios; lint/types/build; independent final review.
- `10-28-studio-canvas-v1/checks/resume-2026-10-30/browser-summary.json`:
  fourteen actual Next/React Flow/native IndexedDB browser groups, including
  separate-profile reference recovery and phone read-only/chat. Identity and
  HTTP are fixtures; real signed-session SSR/API/runtime evidence is separate.

Read-only applicability audit in this planning turn:

- HEAD remains `1f7948e334c589dc6db38ac045b584f0f5381481`; index is empty.
- All 192 non-Trellis baseline paths reconciled with final infrastructure
  deltas match; no additional current dirty non-Trellis source path was found.
- Runtime named hashes match 17/17; browser named hashes 10/10; database
  identities 3/3; final infrastructure source deltas 13/13.
- Retained browser source copies match all 215 files across `src/components`,
  `src/lib` and `contracts`, with equal inventories. Named CSS hash also matches.
- Archived command receipt/log hashes match 129/129; final independent report
  hash matches. Exact input references and source identities are preserved in
  `final-integration-evidence-audit-2026-10-30.json`.
- This is provenance/source inspection, not another successful application test
  run or proof of every build-image layer. Final review must recheck any paths
  changed during execution and retain the environment boundaries per gate.

## Actual Gaps

1. **Parent records and current-stage instructions.** No parent `verification.md`
   or `handoff.md` exists. AC6-AC9, AC11-AC15 and AC17 remain unchecked. Earlier
   design/activation text still described starting the children; this planning
   update makes final parent integration the next step without erasing history.
   Contexts need the now-implemented canvas specs and archived evidence pointers.
2. **Direct old-chat and deletion-to-works SQL seam.**
   `src/tests/unit/conversation-generations-api.test.ts:93` proves the old-chat
   scenario using mocked queries (60 chat jobs, 130 newer canvas/orphan jobs).
   Current production loading is owner/conversation-scoped in
   `src/lib/server/conversation-generations.ts:28` and
   `src/app/create/page.tsx:45`. No direct real-DB counterpart was found in the
   archived DB/runtime suites.
3. **Retention retrieval rather than row-count inference.** Conversation DELETE
   calls only `db.conversation.delete` in
   `src/app/api/me/conversations/[id]/route.ts:47`; its SetNull relationship is
   `prisma/schema.prisma:484`. Works retrieves by job owner, independently of
   organization (`src/lib/server/works.ts:116`). Existing canvas SQL/runtime
   evidence preserves canonical jobs/images and credits, but does not execute
   the production conversation DELETE followed by `listUserWorksPage`. No test
   importing that works loader or the conversation DELETE route was found.
   Add one narrow real-SQL seam regression set rather than infer that the works
   retrieval contract passed from fake browser inventory or schema alone.
4. **Mobile predecessor handoff.** The independent mobile PRD already requires
   verified canvas-v1 plus parent integration. After acceptance, replace the
   still-pending parent dependency with exact accepted/archive evidence, while
   retaining its own future UX/design/review gate and planning/deferred status.

No product defect is confirmed by this planning inspection. Gaps 2-3 are test
coverage gaps, not evidence that current production behavior is broken.

## AC Review Map

All rows require a final parent verdict; candidate evidence is not a checked AC.

| Parent AC | Existing Candidate Evidence | Remaining Parent Work |
| --- | --- | --- |
| AC1 | `research/current-studio.md`; original affected-path research | Retain historical anchors; reconcile the now-replaced bootstrap. |
| AC2 | Library/application comparison and primary-source snapshot | Confirm selected MIT core/notice/version; no repeat external research. |
| AC3 | Parent design and canvas shared generation implementation | Verify independent modes still share the authoritative generation lifecycle. |
| AC4 | Product decision inventory and dated child approvals | Record fresh approval of this closeout plan; no product rediscovery. |
| AC5 | Original planning-only record; this turn's unchanged code audit | Keep planning edits artifact-only; distinguish approved child execution. |
| AC6 | Canvas CA2; graph/renderer tests and browser typed links | Map one prompt, ordered 0-16 sources, rejection and lineage evidence. |
| AC7 | CA1/CA12; root/origin/scoped-loader tests, browser mode/account isolation | Verify no global fallback; add the real old-chat SQL seam. |
| AC8 | CA3/CA4; frozen-input route/SQL tests and stable-result browser cases | Trace actual ready inputs and immutable ordered run snapshots. |
| AC9 | CA2/CA3; controller/graph tests and browser no-auto-submit cases | Confirm only explicit target-node Run, no automatic upstream execution. |
| AC10 | Cost and reference-retention research | Preserve estimates, not deployment/capacity claims. |
| AC11 | CA5/CA6; native IDB, captured Save/conflict, actual CAS/owner APIs/SQL | Join local/account/second-profile evidence; retain eviction limitation. |
| AC12 | History HA1-HA4; final studio tests; canvas CA8/CA9/CA12 | No history UI; add real conversation DELETE/works retrieval and reconcile chat compatibility. |
| AC13 | CA6/CA7; disconnected-original Save, exact bytes/reuse, actual upload/save APIs | Map recovery without local files, reuse, upload failure and no save-triggered Run. |
| AC14 | CA8/CA9; delete/late-ACK/tombstone tests and real retained job/root/credit checks | Assert owner works retrieval after organization deletion; no cancel/refund/resurrection or duplication. |
| AC15 | CA10; real signed-session SSR plus separate browser desktop/phone/IME cases | Verify capability-level phone read-only/chat and document physical-device/OS-IME residuals. |
| AC16 | Independent mobile PRD/task, planning status, explicit dependency | Update verified parent/predecessor links only; no mobile work/archival. |
| AC17 | CA11; 64 SQL cases and both real managed-GC topologies; expiry recovery tests | Map seven-day roots/races/retry, generated/legacy exclusions and actionable expired drafts. |

## Necessary Execution And Reuse

1. Recheck source identity and create the AC matrix, preserving exact dates,
   commands, exit codes, environment and coverage boundaries for reused checks.
2. `trellis-implement` owns only the narrow regression additions, preferably in
   `src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts`, using its
   existing sentinel and full/additive DB wrapper. Exercise production loading,
   conversation DELETE and works retrieval through real Prisma/SQL; fixture auth
   is explicitly labelled and does not become browser/login E2E. Assert retained
   jobs/images, owner isolation and unchanged cancel/refund/credit fields.
3. Fresh focused studio/chat regressions, augmented `verify:canvas-contracts:db`,
   lint/types, whitespace, context-manifest checks and exact resource cleanup.
   Main and a separate `trellis-check` review the complete parent scope.
4. Reuse unchanged 1386-test/build/Worker DB/migration/runtime/browser receipts.
   Product changes require final ordinary suite/build plus affected real gates;
   renderer changes require affected real browser checks, SQL/GC/Worker changes
   require their actual DB/runtime gates. If a wrapper cannot safely target a
   subset, run that wrapper, not an ad hoc bypass. A newly failing or unavailable
   required gate blocks acceptance/archival.
5. Record any defect with reproduction/source evidence and exact minimal file
   ownership before repair. Follow implement -> check -> independent re-review
   for fixes; do not turn acceptance into a canvas rewrite or scope expansion.

## Archive Conditions And Deliverables

- All AC1-AC17 have evidence-backed verdicts within the approved local/test
  scope. No required gate is failed, stale for changed code, skipped or unmapped;
  independent final review has no unresolved blocking defect.
- Parent `verification.md` and `handoff.md` are complete; PRD/checklist reflect
  actual acceptance; specs are reviewed for necessary capture; mobile dependency
  references the verified foundations and accepted parent without activation.
- Physical phone/native OS IME, fresh browser login-to-paid-provider flow,
  real provider/S3, production migration/deployment, actual CI and capacity are
  explicitly unverified. Signed-session SSR/API and fixture-browser layers are
  never represented as one complete authenticated generation E2E.
- Check absolute archive source/destination stay under the intended task root,
  destination does not exist, and hooks cannot perform forbidden side effects.
  Archive only `10-28-studio-dual-mode-canvas` using `--no-commit`. Repair current
  references/manifests for the archive location, preserving historical evidence.
  Verify artifact preservation and unchanged HEAD/index/product patch afterward.
- Record the journal with `--no-commit`; phone task stays active in
  planning/deferred. Leave all user code and existing uncommitted patches intact.

## Planning Gate And Execution Approval

The PRD, design, implementation plan and contexts describe this closeout scope.
The planning turn changed only task artifacts and performed read-only evidence
inspection, without application checks, dispatch, activation or archive. The
user then explicitly approved the latest final summary on 2026-10-30. Execution
now proceeds on this parent only; no commit, deployment or mobile activation
is authorized. New results must not be backdated into the planning audit.
