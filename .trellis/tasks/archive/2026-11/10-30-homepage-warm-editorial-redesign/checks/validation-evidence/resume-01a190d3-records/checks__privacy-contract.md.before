# G1: Image Detail Privacy And Featured Data Contract

- Owner: `privacy_contract` implementer.
- Approval: the parent activated the existing task after the user's complete-plan approval on 2026-10-31.
- Scope: image detail projection, featured publication flag, actual page-to-client prop tests and owner/admin regression tests. No gallery visuals, generator/canvas changes, permission-policy changes or video behavior changes.
- Status: G1 focused red/green verification passed. The privacy slice is ready for homepage integration; whole-task lint/types/build and raw-transfer/browser gates remain separately tracked.

## Production Changes

- `src/lib/prisma-mappers.ts`: additive `SerializedFeaturedWork.showPromptPublic`, plus pure `serializePublicWorkDetail()` and its eleven-key nullable-prompt public type. The existing owner/admin serializers are unchanged.
- `src/app/works/[id]/page.tsx`: project non-owner data after the unchanged access gate and before creating any client props. The owner branch still receives the full authorized DTO.
- `src/components/works/work-detail-panel.tsx`: discriminated owner/public props and null-safe prompt rendering; only the owner branch can render the full-data management controls.
- The three production files matched the parent's recorded baseline hashes immediately before editing. `src/lib/server/works.ts`, `src/lib/work-showcase.ts`, create/canvas and the video fallback remain unmodified.

## Boundary Checks

- `work-detail-page-privacy.test.tsx` awaits the actual image detail page, keeps `getWorkById`, serializers and visibility policy real, mocks only DB/auth/environment/irrelevant UI, and inspects the actual client child's props.
- Distinct sentinels identify positive/negative prompts, review note/timestamp/identity/email, submission time, owner/job IDs and author email. Non-owner output must have exactly the eleven planned allowlisted keys.
- Guest, signed-in non-owner and admin-as-public-visitor each cover FEATURED public/hidden prompts and denied PRIVATE/PENDING/TAKEDOWN_PENDING statuses. Owners retain all data in every status.
- The same raw object is reused by public, owner and admin requests to detect destructive redaction. The actual admin page retains its authorized author/review payload and login gate; existing video fallback stays separate.
- `featured-public-contract.test.tsx` keeps the actual Home page, featured API, feed service and serializer, asserting first-page/API parity, explicit permission, redaction, cache policy and the sixteen-item query boundary for guests/authors/other users.
- Mapper cases include a genuinely public prompt equal to the old hidden-placeholder string; permission is not inferred from text.
- Consumer tests cover nullable protected prompts, full positive/negative prompt modal copy, original-image view/download, private-owner review notes, submission opt-in, withdrawal and takedown.

## Verification Receipts

- `git diff --check` on the three production files and two modified existing test files: passed.
- New task-owned test files checked for trailing whitespace with Python: passed.
- Isolated pre-fix red Vitest: 4 files / 49 tests; 16 expected semantic failures and 33 passes, exit 1. Failures cover raw hidden prompts/internal owner-review fields in actual outgoing client props, missing featured permission and Home/API parity. Immutable pre-fix source, `.before` files, command, hashes, stdout/stderr and receipt are preserved under `checks/validation-evidence/privacy-red/`.
- Isolated focused green Vitest: **10 suites / 99 tests passed**, exit 0; no stderr, timeout or source/snapshot mutation. Receipt ID: `20261031T014013-test-d58fe1` (2026-10-31, 7.704-second process duration). Command, logs, full source manifest and runtime preparation evidence are preserved in `checks/validation-evidence/privacy-green/`; the original receipt is in `checks/.runtime/production-fa4bca90/receipts/`.
- Isolated lint/typecheck: the G0 environment agent owns the next baseline run; not claimed as passed here.
- Actual raw Next HTML/RSC and browser checks: owned by the later G6 validation lane; these unit props checks do not substitute for them.

No live dotenv, account, database, provider or object-storage access; no staging, commits or destructive cleanup.

## Exact Focused Green Invocation

The Python outer launcher strips inherited configuration before launching Node and uses the owner-marked credential-free snapshot; it is not an ordinary workspace Vitest invocation.

```powershell
python .trellis/tasks/10-30-homepage-warm-editorial-redesign/checks/isolated_check.py run --workspace E:\code\narra-image\.trellis\tasks\10-30-homepage-warm-editorial-redesign\checks\.runtime\production-fa4bca90\app --stage test src/tests/unit/work-detail-page-privacy.test.tsx src/tests/unit/public-work-detail-serialization.test.ts src/tests/unit/work-detail-panel.test.tsx src/tests/unit/featured-public-contract.test.tsx src/tests/unit/prisma-mappers.test.ts src/tests/unit/featured-route.test.ts src/tests/unit/featured-works.test.ts src/tests/unit/work-showcase.test.ts src/tests/unit/my-works-board.test.tsx src/tests/unit/prompt-modal-copy.test.tsx
```

The executed child was the already installed `D:\node\node.exe` + copied Vitest 4.1.5 entry with `run --testTimeout=30000`. No build-only `APP_URL` was inherited into tests. Runtime-version/release parity is reported by the G0 owner, not inferred from this focused green result.

## Integration Handoff

- Gallery consumers must use `showPromptPublic === true`; missing cached flags fail closed. No negative prompt or owner-only featured exception is introduced.
- The new Home/API contract suite mounts the real Home server-page result and spies on the gallery child. If new visual islands require JSDOM setup, mock only those unrelated islands or supply their safe browser primitives; keep the actual Home/feed/API/serializer path intact.
- G6 must still verify raw HTML/RSC sentinel absence on real Next initial load and navigation/refresh. Unit tests of actual outgoing props are evidence at that boundary, not live-service E2E or raw RSC evidence.
