# Bug Analysis: Native Keyboard Harness Semantics

## 1. Root Cause Category

- B / Cross-Layer Contract and E / Implicit Assumption: the task driver passes
  its numeric modifier argument directly to CDP. H10 used `1` as if it meant
  Shift, but CDP defines Alt=1, Control=2, Meta=4 and Shift=8. The test therefore
  attempted Alt+Tab after a successful copy instead of backward focus traversal.
- D / Test Coverage Gap: the former helper lacked ordinary-control forward,
  reverse, disabled-skip and wrong-modifier calibration. Product assertions
  alone did not discriminate a bad driver event from an accessibility defect.

## 2. Why Earlier Attempts Did Not Complete The Gate

1. The earlier Enter-only issue was another input contract: a keydown without
   native character text did not activate a plain Chromium button. Paired
   key events plus Enter text semantics and enabled/disabled calibration
   corrected that helper; the next full run reached backward traversal.
2. `full-1793426443725` passed 85/86 checks, including calibrated Enter and the
   first full-prompt copy, then exposed the wrong Tab modifier. No product
   tabindex or focus change was justified by that result.
3. The preceding checker added named modifiers and trusted Tab calibration.
   Focused runs `home-1793429243243` and `home-1793430489936` then failed during
   Chrome GPU startup (`0xC0000022`), before the calibration could execute.
   Those launch failures neither disprove nor verify the helper correction.
4. In this continuation, the exact unchanged launch succeeds without GPU or
   sandbox flag changes. `home-1793431525760` passes H10, including both native
   calibrations and full-prompt keyboard copies for all three scenes. The
   isolated receipt is `20261031T072525-script-79e423`: exit 0, 7.611 seconds
   against a 180-second deadline. Full-matrix evidence remains separate.

## 3. Prevention Mechanisms

| Priority | Mechanism | Concrete Action | Status |
| --- | --- | --- | --- |
| P0 | Shared contract | Named `CDP_MODIFIERS` in the existing task driver; Shift and Control callsites use it | Done in preceding session, preserved |
| P0 | Discriminating tests | Trusted enabled/disabled Enter and forward/reverse/Alt-negative Tab calibration | Verified in fresh focused H10 |
| P0 | Evidence separation | Distinguish launch failure, driver calibration, product action and unresolved URL records | Retained in task reports |
| P1 | Reusable spec | Add exact signatures, bitmask, native-event assertions and wrong/correct example to frontend quality guidelines | Done |
| P1 | Scope protection | Keep all 806 product/test/static inputs frozen while correcting only the harness | Re-audited unchanged |

## 4. Systematic Expansion

- The existing text-entry helper now also uses named Control for Select All.
  Product components do not interpret this test-only bitmask.
- Do not infer application regressions from a closed CDP socket; inspect
  process stderr and identify whether input reached the calibration first.
- Do not resolve a false keyboard failure by changing product tab order,
  dropping disabled-control assertions or using programmatic focus/click.
- Static/unit evidence, native fixture evidence and physical-device/live
  service behavior remain distinct. A corrected driver requires a fresh
  affected browser run even if the application source is unchanged.

## 5. Knowledge Capture

- [x] `.trellis/spec/frontend/quality-guidelines.md` now records the executable
  CDP input contract and required positive/negative controls.
- [x] Exact earlier helpers remain as `.before` files under
  `browser/evidence/resume-native-before/`; historical failed runs are intact.
- [x] Task continuation and acceptance records retain the distinction between
  recovered automated gates and newly executed browser checks.
- No template mirror exists at `src/templates/markdown/spec/` in this project.
  No spec commit, task archive or journal auto-commit is authorized.
