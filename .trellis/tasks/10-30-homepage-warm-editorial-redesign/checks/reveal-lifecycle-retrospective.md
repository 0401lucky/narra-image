# Bug Analysis: Reveal Cleanup And Deferred DOM Rendering

## 1. Root Cause Category

- B / Cross-Layer Contract: stopping Motion's DOM animation can sample current
  values and queue a retained VisualElement render. React cleanup's direct
  final styles are not the last writer merely because they follow `stop()`.
- D / Test Coverage Gap: the old hook suite mocked `stop()` with an empty
  function and inspected styles synchronously, missing the later frame.
- E / Implicit Assumption: a partially visible target was sufficient for the
  browser helper's point operation, but not its separate raw hover fraction.
  This helper defect and the product cleanup race require independent proof.

## 2. Why Earlier Attempts Did Not Establish The Fix

1. The out-of-viewport hover point explained a bad native action, not all
   opacity failures. Native full-card scrolling still left the entrance
   frozen. Mutation evidence in `diagnostic-1793432333207` shows final cleanup
   styles at 1806.2ms followed by partial Motion styles at 1815.6ms.
2. Replacing stop with cancel is not enough: cancel can restore initial DOM
   animation values. The correction removes the competing DOM renderer,
   rather than racing it with another timer or delayed final-style write.
3. The first real-Motion test draft advanced frames synchronously and retained
   Motion's event-loop time cache. Its failed completion control was a harness
   calibration failure, not semantic product RED. Yielding between frames
   and interrupting between timestamps produces five genuine old-source
   failures, with normal and delayed controls passing.

## 3. Prevention Mechanisms

| Priority | Mechanism | Concrete Action | Status |
| --- | --- | --- | --- |
| P0 | Single DOM writer | Scalar progress with guarded local opacity/translateY; dispose before stop, then settle final styles | Implemented |
| P0 | Real scheduler regression | Five interruption cases inspect every subsequent render; two delay/completion controls; no replay and empty final frame queue | 7/7 pass after 5-failure semantic RED |
| P0 | Independent native validation | Preserve mutation/scroll/hover red evidence; rerun new interruption/cascade and complete browser checks | Separate browser gate |
| P1 | Native action contract | Check the requested hover fraction against viewport, ancestor clipping and actual hit before and after movement | Separate calibrated helper fix |
| P1 | Reusable guidance | Record deferred writer ownership and real frame/microtask testing in homepage and quality specs | Done |

## 4. Systematic Expansion

- `HomeReveal` also wraps the capability section and appended gallery entries;
  preserve stable keys, one-shot playback and original stagger constants.
- Keep input calibration, product behavior, browser launch failures and
  unresolved URL transport cases distinct. A helper fix must not conceal a
  separately demonstrated product defect.
- Preserve exact semantic RED/GREEN test bytes. A failing test control is a
  reason to repair the harness, not convenient evidence for a product patch.
- Full automated/build/browser results must use the new 807-input revision;
  earlier 1626-test receipts remain historical, not final acceptance.

## 5. Knowledge Capture

- [x] `.trellis/spec/frontend/homepage-interactions.md`: scalar reveal lifecycle,
  delayed-write regression and native interrupted-entrance contract.
- [x] `.trellis/spec/frontend/quality-guidelines.md`: exact-fraction hover and
  actual Motion frame/microtask calibration, without broad animation bans.
- [x] `validation-evidence/reveal-lifecycle/`: retained calibration failure,
  semantic RED, focused GREEN/lint/types, manifests and exact changed bytes.
- [x] `reveal-lifecycle-implementation.md`: source identities and implementation
  details; final browser/full-suite results remain with their owning reports.
- No template mirror exists at `src/templates/markdown/spec/`; no automatic
  spec commit, task archive or journal commit is authorized.
