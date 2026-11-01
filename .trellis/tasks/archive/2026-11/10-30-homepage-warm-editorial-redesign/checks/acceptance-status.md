# Implementation Acceptance Status

## Current Revision

As of 2026-11-01, the approved gallery-only long-URL fallback is implemented
and verified alongside the three original 1448x1086 PNGs, native hero-copy
correction, phone composition and guarded scalar-Motion reveal cleanup.

The final 809-input revision passes **140 files / 1704 non-DB tests** on the
already installed pinned Node 24.22.1, metadata-inclusive root lint, types,
offline Prisma generation and an unmodified Next production build. The final
real-Next/synthetic-DB browser matrix passes **103/103 checks**, including
43 privacy transfers and 15 added long-URL/native-control checks. Its
unresolved-acceptance list is empty.

The user's explicit approval covers the fallback plus committing this and
the recognized prior tasks and pushing GitHub `main`. Git delivery follows
the final staged-content audit and independent report in
`git-delivery-independent-review.md`; deployment is not authorized.
Historical reports retain their original evidence and review attribution.

## Approved Fallback And Verification Limits

1. A complete encoded `/create?prompt=` target of at most 8192 bytes keeps the
   existing link. Larger or unencodable prompts retain complete readonly text
   and full copy, with manual-paste instructions and a promptless `/create`
   or `/login` link. Strict public permission, saved mode, drafts and auth
   behavior are unchanged. Copy does not navigate or transfer hidden state.
2. Direct 8000-unit Chinese/emoji URLs still return HTTP 431 at 72,015/56,019
   request-target bytes. They are truthful transport observations, not
   successful prefill. The gallery no longer creates those links; independently
   verified fallback resolves the product gate without raising server limits.
3. Pinned Node 24.22.1 parity is verified for the final local gates. Earlier
   24.11.1 and pre-fallback results remain historical. No tool is downloaded.
4. Actual Next/React/Chromium with finite synthetic services does not establish
   physical-mobile/native-IME/OS-download, live-service, actual CI or deployment
   acceptance. Prior mobile MA1-MA4 remain deferred; see `git-delivery-prior-tasks.md`.

## Acceptance Matrix

| AC | Current Evidence | Status |
| --- | --- | --- |
| AC1 | Real fonts/images at 320/390/768/1024/1440; coordinator visually compares final desktop/phone frames with the clean reference | Passed within fixture/visual scope |
| AC2 | Six motion groups, real-image effects, calibrated keyboard/hover and interrupted cascade pass in the final 103-check run | Passed |
| AC3 | Actual API/account/like/paging/copy contracts and approved full-copy/manual-paste fallback pass | Passed within synthetic-service scope |
| AC4 | Empty/error retry, keyboard/touch disclosure and manual copy tests plus actual Next browser checks | Passed |
| AC5 | Real-Motion queued-render regressions, native interrupted reveal/no replay, pause/reduced/hidden/unmount and rapid-switch checks pass | Passed |
| AC6 | 185 protected source hashes unchanged; default route baseline and actual navigation comparisons pass | Passed |
| AC7 | Original bookshop/fox/rain-v2 PNGs, all-scene decode, native tilted/touch/keyboard copies and failure/retry pass | Passed |
| AC8 | Four-column 4:5 thumbnail grid and centered crop; original/detail preserved | Passed |
| AC9 | 16-to-72 paging, synchronous command gate, retry/dedup/cap tests and real API browser checks | Passed |
| AC10 | Positive-only valid links plus exact encoded-budget/manual fallback; full text, permission, guest/member and no-write controls pass | Passed |
| AC11 | Actual guest login without continuation, return/reselect, saved-canvas/manual-chat and successive selections | Passed |
| AC12 | Actual page props plus real Next raw HTML and navigation/refresh Flight secret-sentinel checks | Passed |
| AC13 | Owner/admin controls/data intact, access policy unchanged; raw transfer matrix | Passed |
| AC14 | Real existing-route footer/header links; no invented policy/status pages | Passed |

## Automated And Browser Evidence

- Current product revision: 140 files / 1704 non-DB tests pass, lint has zero
  errors and nine baseline warnings, TypeScript passes, installed Prisma
  generation passes with a diagnostic network block, and the unmodified
  production Next build passes in 19.369 seconds. DB exclusions are unchanged;
  no migration, fixture adapter or download enters the production build.
- These five gates were freshly executed on the final bytes on 2026-11-01,
  not inferred from old source. `validation-evidence/git-delivery-final/result.json`
  retains commands and the complete 809-input manifest. The real-Motion semantic RED
  (five expected failures / two passing controls) and focused GREEN (19/19)
  are retained in `validation-evidence/reveal-lifecycle/`.
- Final browser: `browser/evidence/full-1793502794542/result.json`, 103/103
  executable checks, including 43 privacy transfers. Wrapper
  `20261101T031314-script-5cadc5` exits 0 in 326.492 seconds against 900 seconds.
  The earlier keyboard, hover and reveal failures remain intact.
- `validation-evidence/git-delivery-independent/` binds final source, helpers,
  fixture/build and pre/post identities, with explicit DB-only adaptations.
  `validation-evidence/git-delivery-final/process-cleanup.json` records zero
  surviving owned processes/locks; `visual-audit.json` records final frames.
- Earlier concurrent Node worker OOM attempts remain failed. The successful
  full reruns limit test workers to two, preserving every test and timeout.
  Two source/docs final-LF removals are byte-proven and followed by fresh gates;
  original licenses and `.before` evidence are unchanged.

## Verified Privacy Slice

- Before fix: 49 unit tests, 16 expected semantic failures and 33 passes.
- After fix: 10 suites / 99 tests pass; actual outgoing client props retain only
  the 11 allowed public fields. Hidden positive and negative prompts are null;
  internal management fields never cross the non-owner boundary.
- Actual Next with a synthetic DB-only boundary: 43 / 43 raw transfer checks
  pass, including 32 visibility/permission combinations and 8 real navigation
  plus refresh transfers; retained in the final 103/103 combined browser run.
- The existing Next streaming denial may use transport HTTP 200 with
  `NEXT_HTTP_ERROR_FALLBACK;404` and noindex. Before/after evidence confirms the
  existing behavior, with no client detail props or secret sentinels. Do not
  equate that transport detail with an authorization exception.

## Safety And Test Scope

- `validation-environment.md` documents owned snapshots, OS-essential sanitized
  child environments, exact public `.env.example` exception, independent
  dependency copies, generated outputs, deadlines and cleanup. Eight final
  safety self-tests pass. A task-preload `fs.exists` custom-promisification bug
  was fixed without weakening dotenv rules; red/green evidence is preserved.
  No real dotenv is read.
- Source ownership starts at `implementation-baseline.json`; each continuation
  preserves a fresh byte-identity baseline. Create/canvas, root layout, global
  styles, package/lock/schema/config and service access edits belonging to
  other work are preserved, not reset or attributed to this continuation.
- Final full-suite/build results supplement, rather than substitute for,
  per-slice evidence and independent review.
- Browser evidence uses actual Next/React/Chromium with deterministic synthetic
  service data. It is not live-account/database/Worker/provider/storage E2E,
  physical iOS/Android testing or production release approval.
