# Independent Review

- Reviewer: `independent_review` (`trellis-check`), 2026-10-31.
- Verdict: No additional production-code defect confirmed in the task-owned changes. Five missing regression cases are added and pass. The overall task is NOT complete: image delivery and the oversized Unicode remix-link decision remain open, and the coordinator owns the final full-suite/build/browser gates.
- Context: Read the saved native hook output, PRD, design, implement plan, check manifest/research, frontend specs including `public-work-data.md`, operations isolation rules, and the Trellis check/before-dev skills.
- Ownership: Only four existing task-owned test files and this report changed during this review. No production, asset, font, launcher, browser-fixture, create/canvas, global theme, package, schema or infrastructure file changed. No staging, commit, push, deployment or archive.

## Findings (Fixed)

These are regression-coverage gaps, not claims that the covered production paths were failing.

1. `src/tests/unit/homepage-hero.test.tsx:91`: Add rapid film -> storybook -> oriental -> already-committed film coverage. Both superseded decode promises complete late; the image, selected tab, prompt and busy/error state remain coherent and deadlines clear on unmount.
2. `src/tests/unit/homepage-motion.test.tsx:173`: Add keyed appended-entry coverage. Existing cards do not replay their entrance when a later page arrives; only the appended card animates, and interruption restores visible opacity/transform while observers dispose.
3. `src/tests/unit/homepage-motion.test.tsx:254`: Add successful clipboard feedback expiry across identities. The previous identity's feedback deadline cannot reset a newer copied result, exact source texts reach the clipboard, and unmount clears the remaining timer.
4. `src/tests/unit/homepage-header-footer.test.tsx:137`: Add desktop-breakpoint dismissal of an open home navigation portal. Scroll unlocks, the page loses only this dialog's inert state, previously inert siblings retain their original attribute, and the media listener is removed.
5. `src/tests/unit/featured-gallery-likes.test.tsx:119`: Add stalled JSON-body unmount coverage independently of stalled fetch. Abort settles the old command and clears its timer; a late old body cannot change a newly mounted viewer's acknowledged count or navigate to login.

## Findings (Not Fixed)

- **Release blocker / AC1, AC7:** `/marketing/home/bookshop-light-v1.png`, `/marketing/home/lantern-fox-v1.png` and `/marketing/home/jiangnan-rain-v1.png` are absent. All three built-in generation calls failed because the host has no enabled image model. The current error state is honest, but it is not delivery of the approved visuals. No substitute, stock image, CLI, site provider or fake successful decode is introduced. See `assets/image-prompts.json`.
- **Product decision / AC10:** The existing `/create?prompt=` transport rejects maximum-length multibyte prompts before the page renders. The unchanged real-Next baseline accepts 8000/8001 ASCII units but returns HTTP 431 for 8000 Chinese units (72,015 encoded request-target bytes) and the tested 8000-unit emoji/multibyte input (56,019 bytes). `gallery-card.tsx` retains the approved existing URL handoff; its >8000-unit note does not solve this encoded-byte limit. The coordinator requested approval for a bounded gallery-entry/manual-copy fallback; no approval, threshold, auth continuation, generator/draft change or hidden store is assumed. See `browser/evidence/baseline-1793412269046/long-url-baseline.json`.
- **Verification boundary:** Available Node is 24.11.1 rather than pinned 24.22.1. No pinned runtime, live-account/DB/Worker/provider/storage E2E, physical device, actual CI or production readiness is claimed. Final full non-DB tests and unmodified production Prisma/build are assigned to the coordinator after this review.

## Actual Source Review

- R6: The real image detail page keeps `canViewWorkDetail` before projection. `serializePublicWorkDetail` constructs exactly eleven allowlisted keys without object spreading/mutation, nulls both unpublished prompts through the existing policy, and never transports internal review fields to a non-owner. The discriminated panel branch preserves author controls and full owner/admin serializers. No public-route admin exception or video-behavior change is added.
- Public feed: Home and pagination share `serializeFeaturedWork`; `showPromptPublic` is explicit, absent cached flags fail closed, and a genuinely public prompt equal to the old placeholder remains usable. The gallery does not fetch private detail data. Initial feed failure is distinct from empty data and can retry page one; anonymous tagged cache and viewer-qualified reads remain separate.
- Paging: Observer and button use the same ordinary command with a synchronous request lock, epoch and authoritative cursor/list snapshot before unlock. First and appended pages deduplicate by immutable ID, clamp to 72, retain 16-item requests, reject malformed/cycling cursors and suspend duplicate-only/error auto retries. Same-viewer refresh preserves local pages; Home keys a new viewer separately.
- Asynchronous requests: Fetch AND JSON share the 15-second deadline, and abort races settle ignored-abort promises. Success is guarded after the asynchronous boundary. Like requests serialize per mounted immutable work ID, use actual endpoint acknowledgements, preserve old state on uncertainty, and retain real 401 login routing without automatic retry.
- Clipboard/remix: Full public positive text is copied verbatim, independently of excerpts/typewriter text. The shared clipboard hook bounds permission waits to five seconds, rejects stale identity feedback and exposes selectable text on failure. Remix adds only the encoded positive query, preserves the existing login-and-return journey, and cannot auto-generate, clone configuration or import canvas nodes. The oversized URL limitation remains explicitly unresolved.
- Card interaction: Detail, like, disclosure, copy and remix controls are siblings rather than nested interactive elements. Closed prompt contents are inert; mouse/focus, explicit touch disclosure and Escape/focus return are present. Entrance, preserve-3D tilt, clipped image, glare and forward information are separate roots.
- Motion: One shared environment subscription controls reduced motion, visibility and pause; pointer effects are event-driven rather than 72 idle loops. Scene decode/latest-request guards, typewriter, counters, capability timer, dust and reveal each own cleanup. Observer absence keeps content accessible. Image success remains unit-mocked only until actual assets exist.
- Theme/header/footer: Homepage aliases and scoped tokens do not replace root fonts/colors. Home uses an explicit sticky header and body portal; default header/mobile branches retain their original behavior. Real check-in/logout/pet components remain connected, while the capability pet/API examples are explicitly demonstrations. Footer links match existing routes and account visibility; no fake public gallery, filters, policy/model/status pages or preview annotations are introduced.
- G0 launcher (read-only audit): Python allowlists the initial Node environment, physically copies source/dependencies, excludes real dotenv, retargets internal dependency links and gives test/build separate environment values. The public-example guard, owner-marked direct runtime roots, lock checks, bounded command receipts, hidden processes and final absolute-path/reparse audit before cleanup are present. The preload is correctly documented as defense in depth, not a security sandbox. No launcher changes or live-environment operations were needed.

## Baseline And Rejected False Positives

- Compared SHA-256 against `implementation-baseline.json`: create page, root layout, globals, generator studio, saved-mode hook, work service, package manifest, lockfile, Prisma schema and Vitest config are unchanged. The validator delta against the independent pre-fix snapshot is one type-only import plus appended gallery response schemas; all prior canvas schema content remains intact.
- A footer screenshot initially caught cards 69-72 during delayed cascade. The browser owner held the viewport stationary and captured final opacity 1 / transform none for all four cards and their ancestors with visible rectangles. Evidence: `browser/evidence/home-1793413207992/footer-last-row-settle.json`. This is screenshot timing, not a permanently hidden-row production defect. The new appended-entry unit case additionally guards non-replay/cleanup.
- Possible pending-like state reuse through React Activity was not promoted to a finding: the installed Next layout router puts Activity behind `__NEXT_CACHE_COMPONENTS`, the current config does not enable it, and the existing root page transition keys by pathname. No speculative production behavior change is made.
- Public-route access denial is `notFound()`, not a promise of universal transport HTTP 404. The before/after raw response checks preserve the existing streamed HTTP 200 plus `NEXT_HTTP_ERROR_FALLBACK;404`/noindex semantics with no unauthorized client detail payload.
- Visually inspected the browser owner's current 1440 and 390 homepage screenshots. The warm composition and mobile two-line semantic title are present, stats align, and the missing-asset fallback is clearly visible. These screenshots do not pass final artwork/reference fidelity.

## Acceptance Walkthrough

The source checks below do not replace the separately owned final browser/full-build results.

| AC | Reviewed Evidence / Remaining Gate |
| --- | --- |
| AC1 | Scoped palette/fonts/layout and responsive browser evidence; final image-dependent reference comparison remains blocked. |
| AC2 | All six motion groups and four capability examples exist; isolated lifecycle tests pass, final delivered-image effects remain pending. |
| AC3 | Real account controls, public DTO, like/paging and raw prompt operations preserved; focused tests pass. |
| AC4 | Empty/error retries, login hints, pointer/touch/keyboard disclosure and manual copy are covered. |
| AC5 | Reduced/hidden/pause and late-callback/unmount cleanup reviewed and tested; final browser source cycle owned separately. |
| AC6 | Protected baseline hashes unchanged and explicit default/home variants preserved; browser owner records computed default-route parity. |
| AC7 | Fixed scene constants and atomic request guards pass mocked-image tests, but all three real bitmaps are missing. Not passed. |
| AC8 | Four desktop columns, 4:5 centered thumbnails and unchanged originals/detail contain behavior; unit/browser slice evidence. |
| AC9 | Guarded 16 -> 32 -> 48 -> 64 -> 72, unique ID merge, cursor validation, honest loading/retry/end/cap states pass. |
| AC10 | Positive-only, no-mutation handoff is correct for transportable input; long Unicode URL failure requires the pending product decision. |
| AC11 | Guest return/reselect and public copying preserved; existing saved-canvas/manual-chat/draft protection remains unmodified. |
| AC12 | Exact actual outgoing page props, allowlisted projection and non-owner prompt/review sentinels covered; prior raw Next 43-case evidence verified by browser owner. |
| AC13 | Owner/admin data and management, existing access policy and video fallback preserved; actual async page/consumer regressions pass. |
| AC14 | Dark footer, three real navigation groups and account-sensitive API destination reviewed and tested. |

## Verification

All Node checks used `checks/isolated_check.py`, never normal workspace pnpm/Node/dev commands. Production lane: `checks/.runtime/production-fa4bca90/app`, snapshot captured at `2026-10-31T02:21:24.377544+00:00`, 802 source files. Each receipt has `sourceChanges: []`, `snapshotModifications: []`, exact source-before/source-after hashes, finite deadline, true exit code and sanitized environment key list.

| Gate | Receipt ID | Actual Result |
| --- | --- | --- |
| Focused homepage/gallery/privacy tests | `20261031T022159-test-87c997` | 14 files, 173 tests pass, exit 0; 14.580s, 300s deadline; empty stderr. |
| Full-source lint | `20261031T022308-lint-f2cd0d` | Exit 0; zero errors, nine existing baseline warnings; 17.776s, 180s deadline; empty stderr. |
| Type check | `20261031T022344-types-03e255` | Exit 0; 4.352s, 180s deadline; empty stdout/stderr. |
| Whitespace | Read-only scoped Git diff plus explicit scan of all four edited test files | Pass, including untracked files; Git LF/CRLF notices are informational. |

Receipts and complete logs reside in `checks/.runtime/production-fa4bca90/receipts/`. The focused test receipt lists all fourteen file arguments. This is not the full non-DB suite or an unmodified production build. The lane is released to the coordinator at the end of the checks, with no active lock or helper process retained.

The browser owner reported the current-source Home 26/26 checks plus the separate settled-last-row check, and earlier raw detail 43/43, on actual Next with only a synthetic Prisma-shaped DB adapter and bounded task fixture additions. The final combined run remains owned/reported by that agent; this reviewer did not execute it. Those checks are not live-service E2E and do not substitute for missing real hero assets.

Coordinator follow-up before this report's handoff: full non-DB suite passed 136 files / 1610 tests in `20261031T022525-test-acab99`, exit 0, 58.197 seconds, with no source or snapshot drift. This result was run/reported by the coordinator, not this reviewer. Prisma generation and the unmodified production Next build are running at handoff; their result is not assumed here.

## Spec Assessment

`frontend/public-work-data.md` already captures the proven public projection, explicit flag and streamed denial contracts without changing owner/admin policy. No additional public-data spec correction is needed. The coordinator may record the now-tested command snapshot-before-unlock, fetch-plus-body deadline, bounded clipboard feedback and separate entrance/depth roots as reusable guidance; this reviewer does not edit coordinator-owned specs. No platform template/config/update registration is affected by these frontend-only changes.
