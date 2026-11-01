# HomeReveal Cleanup Race: Implementation Evidence

Date: 2026-11-01. Scope: the coordinator-authorized reveal lifecycle correction only.
The three source/test inputs below are frozen; full production/browser gates belong
to the coordinator and browser checker.

## Defect And Minimal Correction

The supplied native diagnosis (`browser/evidence/diagnostic-1793432333207/`)
records cleanup writing opacity 1 / transform none at 1806.2ms, followed by a
queued Motion render restoring opacity 0.683627 / translateY 7.56036 at 1815.6ms.
This is distinct from the separately corrected browser hover helper.

Installed Motion 12.38.0 creates a retained DOM VisualElement for
`animate(element, ...)`. Its JS animation `stop()` can sample MotionValues and
schedule another VisualElement render. Synchronously setting final DOM styles
after `stop()` does not cancel that queued writer. `cancel()` is not a safe
substitute because it can restore initial values.

`src/components/marketing/homepage/home-reveal.tsx` now animates scalar progress
from 0 to 1, applying opacity and translateY directly in a guarded `onUpdate`.
Cleanup marks the effect disposed before calling `stop()`, then sets opacity 1
and transform none. No DOM VisualElement owns a competing render. Natural
completion also writes transform none. Delay, duration (0.75s), easing,
offset (24px), visibility gates and one-shot/stable-key semantics are unchanged.
No CSS, layout, API, authentication, business, dependency or timing workaround
is introduced.

## Real-Motion Regression And Calibration

`src/tests/unit/homepage-reveal.test.tsx` uses the actual installed Motion
animation, stop implementation and frame scheduler, not animate/stop mocks.
Only browser inputs and time are controlled. RAF capture is installed before
Motion imports; each 16ms frame runs its real callbacks and yields through
async `act`, allowing Motion's event-loop time cache to expire. Cleanup occurs
8ms between frames, followed by actual queued frame rendering.

The coordinator's first draft was deliberately run before any product edit.
Receipt `20261101T012450-test-0ad085` has six passing interruption cases and a
failing normal-completion control. This is a **harness-calibration failure, not
product RED**: synchronous frame advancement retained Motion's cached
`time.now()`, suppressing the between-frame sample. The original draft and its
receipt/manifest are retained separately. After correcting only the harness,
the old product source produces the discriminating RED below.

Seven cases cover offscreen, hidden document, runtime reduced motion, pause,
unmount, interruption during a stagger delay, and normal staggered completion.
The five interruption cases first prove real intermediate opacity, then prove
cleanup's immediate final styles, and finally check every flushed frame for
stale writes. Re-enabled conditions retain the final state without replay;
all queued frames drain during teardown. Delay and normal completion are
positive controls, not expected failures on the old code.

The existing twelve-test `homepage-motion.test.tsx` suite is retained. Its
animate mock now has the scalar signature. Tests verify the same animation
constants, stale callback rejection, stable keyed entries and independently
targeted updates for appended cards instead of relying on the old DOM-subject
argument. All other pointer/dust/counter/capability/clipboard coverage remains.

## Receipts

All Node commands ran through `checks/isolated_check.py` in the owner-verified,
dependency-audited `checks/.runtime/hhi-d6837226/app` lane. The lane had 806
unchanged prior inputs and no lock on takeover, then refreshed to 807 inputs
after adding the regression suite. No receipt reports source changes or
snapshot modifications; no command timed out.

| Stage | Receipt | Actual result |
| --- | --- | --- |
| Harness calibration | `20261101T012450-test-0ad085` | Exit 1; 1 file, 6 pass / 1 control failure; 4.204s |
| Semantic RED, original product | `20261101T012702-test-defdbc` | Exit 1; 1 file, 5 expected failures / 2 controls pass; 2.464s |
| Focused GREEN | `20261101T012831-test-226b04` | Exit 0; 2 files / 19 tests pass; 2.506s |
| Full-source lint | `20261101T012934-lint-9dadba` | Exit 0; 0 errors, 9 pre-existing warnings; 15.430s |
| Full-source types | `20261101T013007-types-afd526` | Exit 0; no output; 5.020s |

All five semantic RED failures occur after immediate cleanup has already
passed: the next real scheduled render changes opacity from 1 to
`0.5227156672481215`. The same regression source is used for GREEN.
`git diff --check` and explicit whitespace checks of all three changed/new
source files pass; Git emits only existing LF/CRLF normalization warnings.

Exact receipts, stdout/stderr, 807-input manifests and source bytes are retained
durably under `checks/validation-evidence/reveal-lifecycle/`, with the unchanged
originals also kept in `checks/.runtime/hhi-d6837226/reveal-lifecycle/`:

- `before/`: untouched original product/tests and coordinator draft;
- `harness-calibration/`: the non-semantic failed attempt and its manifest;
- `red/`: semantic RED receipts, manifest and exact `.before` inputs;
- `green/`: focused/lint/types receipts, manifest, exact `.after` inputs and
  machine-readable candidate/cleanup evidence.

The coordinator verified all 29 promoted files byte-for-byte; the additional
`promotion-manifest.json` records their hashes and original location. No old
failure or source snapshot was overwritten.

## Frozen Source Identities

| Source | SHA-256 |
| --- | --- |
| Original `home-reveal.tsx` | `8e44ba16847a3e503fed68638588dd2ff1bc28e199aaafa006d7db044f411762` |
| Original `homepage-motion.test.tsx` | `1918e7063a4572d23b45b0898aca26861e4e665492b06ccf3d29c85d6d642ef0` |
| Final `src/components/marketing/homepage/home-reveal.tsx` | `cbfcc21f6039c0d3a01ebb2bc2edb59ce22a1c023997d7aa080506d4090ff073` |
| Final `src/tests/unit/homepage-motion.test.tsx` | `55732e133ea17eeb8539b791183dc0fc8112220980ea1a74877e7ad4b28d9092` |
| Final `src/tests/unit/homepage-reveal.test.tsx` | `8827b3f22fad96715027bd26a6395b9e44357e47d32c7bd859aa02a4d7a9a3fa` |

Only the product component and compatible mocked test change between the
807-input semantic RED and GREEN manifests. The real-Motion suite is byte
identical across those two stages. No other source/test/static input changed.
This report is the only additional task-document edit by the implementer.

## Cleanup And Remaining Boundaries

- All bounded commands exited and the validation lane is released without an
  active lock. Runtime evidence is intentionally retained; no shared scratch
  or unowned process was removed or stopped.
- Full non-DB tests, production Prisma/build and new native browser acceptance
  must be assessed on these frozen hashes by their owners. The focused green
  suite does not claim browser, real-service or release acceptance.
- Available Node is 24.11.1, not the project's pinned 24.22.1. No runtime or
  dependency was downloaded. No live dotenv, personal profile, product DB,
  provider, storage, image request, deployment or Git write operation was used.
- The two oversized Unicode Remix URL HTTP 431 cases remain separate and
  unapproved; no transport, authentication or create-workspace change is made.
