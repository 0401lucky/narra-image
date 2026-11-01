# Mobile regression and verification retrospective

Date: 2026-10-31 (Asia/Shanghai); approval and independent fixes are dated
2026-10-30. This record does not authorize commits, archive or rollout.

## 1. Root Cause Categories

| Finding | Category | Specific cause |
| --- | --- | --- |
| Outside pointer completion | E / implicit assumption | A viewport pointerdown does not guarantee the corresponding pointerup/cancel returns inside that element. The stale set blocked later deliberate movement. |
| External parameter update during IME | C,D / propagation and coverage | The shared prompt had composition-aware native ownership, but the extracted parameter field's external canonical-update path lacked the same focused guard. Settled text alone missed transient setter writes. |
| Accepted `auto` custom size shown blank | C,D | Existing normalizers accept automatic aliases; the custom UI blanked their canonical display. Empty user intent and accepted automatic value were conflated. |
| Saved-provider label target | D / coverage gap | General button/input rules excluded checkbox inputs and did not cover the associated native label. |
| Editor accessibility pinch disabled | C,D | Scoped panel/textarea `pan-y` excludes pinch; allowing the descendant alone cannot widen a restricting ancestor's gestures. Canvas scene pinch and browser page zoom are different boundaries. |

All five product findings were fixed by the independent check role within the
already declared source scope; red regression receipts are retained. Existing
account/save/run/media/Worker contracts did not cause these frontend defects.

## 2. Why Earlier Evidence Was Insufficient

- The original focused suites tested successful in-viewport drops and final
  field values, not outside completion plus a subsequent gesture or a native
  setter invoked by external canonical changes during composition.
- A `44px` checkbox class/DOM assertion is not a measured associated-label hit
  target. A permitted CSS gesture is also not native browser arbitration proof.
- Source-frozen unit passes cannot validate later changed CSS. Each reopened
  source freeze invalidates affected browser/build applicability and requires
  fresh copied-source/build evidence rather than rewriting old reports.

## 3. Prevention Mechanisms

| Priority | Mechanism | Action / evidence |
| --- | --- | --- |
| P1 | Lifecycle | Symmetric window pointerup/pointercancel cleanup and captured target/pointer/camera validation; outside completion cannot accept a preview. |
| P1 | Field ownership | Synchronous native input plus external-update composing/focus guard; retain DOM, caret/selection and newest draft. |
| P1 | State contract | Explicit empty custom intent stays pending; accepted `auto`/alias displays canonical size and never silently substitutes blank. |
| P1 | Component tests | Six independent regressions plus two editable/read-only accessibility cases; no fake resize, setter or browser-style bypass. |
| P1 | Browser evidence | Measure/clipped-hit-test real controls, inspect computed touch-action ancestors, calibrate native pinch against positive/negative plain controls and retain exact original downloads. |
| P2 | Device acceptance | Native iOS/Android touch/IME/keyboard/chooser/download/accessibility zoom remain explicit unperformed gates. |

## 4. Verification Tooling Lessons

- Generated fixture metadata must retain the repository package manager, but
  invoke copied Next directly with pinned Node. A package runner can implicitly
  install in a temporary project; a compiler exit 0 is not authorization or
  installed-copy provenance. The rejected attempt stays retained and disclosed.
- A control's full bounding box can lie outside its scroll clip. Scroll first,
  intersect actual visible bounds, verify `elementFromPoint`, then dispatch real
  pointer events and immediately assert the intended domain/request outcome.
- Viewport-fixed overlays are not clipped by every logical studio ancestor;
  stop clipping at the relevant fixed boundary without skipping hit testing.
- CDP `returnByValue` must receive scalar/plain evidence, not a React-managed
  DOM object. Use `void` for DOM reference setup and JSON-quoted selectors.
- On this Chrome engine, synthesized pinch does nothing even on a plain allowed
  control; actual dispatched touch passes the positive control and fails the
  `touch-action:none` negative control. Keep that calibration separate from the
  product assertion and never turn an unsupported command into a device pass.

## 5. Knowledge Capture

Main synchronizes frontend canvas/state/quality/index specs after the final
quality/browser gate. Those concrete contracts own these lessons; no new task,
operations lifecycle change or abstract duplicate guide is needed. This app has
no `src/templates/markdown/spec/` tree to synchronize. Spec edits and all evidence
remain uncommitted under the user's explicit prohibition.
