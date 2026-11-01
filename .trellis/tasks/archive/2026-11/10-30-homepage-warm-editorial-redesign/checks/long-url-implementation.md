# Gallery Long-URL Implementation

Date: 2026-11-01. Scope: the user-approved complete-copy/manual-paste fallback
in PRD R4/AC10 and design section 7. This report covers implementation and
isolated unit/static checks, not final browser acceptance or Git delivery.

## Changes And Ownership

- `src/components/marketing/homepage/gallery-card.tsx`: the existing
  `promptHref` first encodes the unchanged complete prompt, then accepts the
  complete ASCII `/create?prompt=` request target only at or below 8192 bytes.
  Encoding failures and larger targets return the same manual-path sentinel.
- `src/components/marketing/homepage/gallery-constants.ts`: one named
  `GALLERY_REMIX_MAX_TARGET_BYTES` budget, fallback/action/mode/input-limit
  copy, and the unchanged ordinary prefill-limit message.
- The manual branch retains the readonly complete textarea and existing
  clipboard hook. Its explanation describes manual paste and a promptless
  entry; `aria-describedby` associates it with the textarea, copy button and
  ordinary `/create` (member) or `/login` (guest) link. Copy never navigates.
  New markers are `data-gallery-remix-fallback` and
  `data-gallery-manual-create`; the fallback does not expose
  `data-gallery-remix` or a prompt-bearing link, including for guests.
- Manual text above the existing 8000-JavaScript-unit input limit advises
  shortening before paste. Allowed 8001-unit ASCII links retain the original
  first-8000 prefill warning and the full copy/query value. No text is sliced,
  normalized or replaced in the gallery.
- `src/tests/unit/gallery-remix-fallback.test.tsx`: 62 new component cases.
  `src/tests/unit/featured-gallery.test.tsx`: preserve the full-text assertion
  while changing the old allowed-prefill boundary fixture from Chinese to
  ASCII; long Chinese is now covered by the explicit manual-branch tests.

No CSS, create/auth/draft, permission/serializer, API, provider, storage,
schema, animation or clipboard-hook source changes are included. Existing
guest return/reselect and saved-canvas/manual-conversation guidance remains.
Concurrent ESLint config/regression work belongs to the checker and is not
claimed by this implementation. Only the coordinator owns staging/commits/
pushes; none were performed here.

## Regression Evidence

Evidence root: `checks/validation-evidence/long-url-implementation/`.

- Before-image bytes/hashes for all three existing owned files are preserved
  with `.before` extensions and match the coordinator's 807-input baseline.
  The baseline is not treated as a new quality gate.
- `lane-audit.json`: the assigned `hhi-d6837226/app` is a direct, nonlinked,
  owner-verified task runtime child with no active lock; all dependency links
  stay in its copied dependency tree. Its 807 prior snapshot inputs and copied
  dotenv guard match their manifests. No other runtime lane was modified.
- Semantic RED `20261101T023425-test-44f3f7`: 2 files / 81 tests;
  34 expected failures and 47 passes; exit 1, no timeout, 10.929 seconds.
  Failures demonstrate oversized member query links, the wrong guest branch,
  and the missing ordinary link for malformed Unicode. All failures are
  assertions, not module/import failures. Production files were unchanged
  when RED ran. Runtime: available Node 24.11.1.
- Focused GREEN `20261101T023631-test-59cbd7`: 2 files / 81 tests pass;
  exit 0, no timeout, 7.995 seconds; no snapshot modifications or source drift.
  Runtime: the coordinator-verified, already installed pinned Node 24.22.1
  (`d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5`).
  No runtime or dependency download was made.
- Isolated snapshot lint `20261101T023815-lint-3d787c`: exit 0, 16.77 seconds,
  zero errors and the same nine pre-existing warnings. Types
  `20261101T023849-types-1a06ca`: exit 0, 5.216 seconds, empty stdout/stderr.
  Both use pinned Node 24.22.1 with no timeout, snapshot modifications or source
  drift. These are not the coordinator's metadata-inclusive checkout gate.
- Expanded 14-file attempt `20261101T024004-test-118ad4`: exit 1 after
  38.017 seconds, with a Node worker heap OOM and unhandled Vitest-pool error.
  Thirteen files / 230 tests reported passes (including all 81 focused tests),
  but `homepage-motion.test.tsx` did not complete. This is not a passing gate;
  the original failure is retained in `expanded-worker-crash/`, with no source
  or snapshot drift.
- The already-started one-file retry `20261101T024448-test-f4ac89` completes
  `homepage-motion.test.tsx`: 1 file / 12 tests pass, exit 0, 2.557 seconds,
  pinned Node 24.22.1, no timeout or source/snapshot drift. It is recorded in
  `motion-retry/` and does not relabel the failed 14-file attempt as a passing
  run. No test semantics or runtime/production limits were changed.
- Each run retains the command, exit/deadline/duration, stdout/stderr,
  source-before/after hashes and complete source manifest. RED additionally
  retains the exact test inputs. `source-freeze.json` identifies the four
  owned source files shared with the coordinator/checker after focused GREEN.
  `final-audit.json` confirms those hashes remain unchanged, no whitespace/
  conflict-marker/skipped-test issues, and the assigned hhi lane is unlocked.

The new matrix exercises member and guest at exact total target lengths
8191/8192/8193 for ASCII, reserved symbols, Chinese, emoji, original whitespace,
newlines and decomposed Unicode. It also covers 8000/8001 ASCII, 8000/8001 Chinese
units, 8000 emoji units/characters, malformed high/low/reversed surrogates,
false/missing/blank permissions, clipboard pending/success/denied/absent/timeout,
full manual selection, keyboard disclosure/copy/link focus/Escape, associated
descriptions and absence of query links/navigation/fetch/storage writes on copy.

## Remaining Validation

- Implementation is frozen and hhi is idle. At the coordinator's scheduling
  request, no more heavy/test runs will start here; the coordinator's exclusive
  bounded-worker full suite will cover all targets without discarding the
  original worker-OOM failure record. Focused tests, lint and types pass.
- The coordinator owns fresh full non-DB, pinned-runtime production/static
  gates and metadata-inclusive checkout lint. The checker owns the real-Next
  synthetic-service browser matrix, native touch/hit testing, promptless
  navigation/mode preservation and independent review.
- JSDOM assertions do not prove native browser hit targets or actual navigation.
  The 8192-byte entry policy is conservative, not a guarantee of every proxy's
  request limit. Raw direct long-URL HTTP 431 observations remain historical
  transport evidence; no HTTP limit was changed.
- No real account/DB/Worker/provider/storage, deployment, physical-device or
  remote Git gate is claimed by this implementation report.
