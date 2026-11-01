# Mobile Accessibility Zoom Follow-up

Date: 2026-10-30. Role: existing independent `trellis-check`.
Active task: `.trellis/tasks/10-28-studio-mobile-canvas-editor`.

## Scope And Authority

Main explicitly reopened the prior final source freeze only for the confirmed
P2 accessibility-zoom CSS-contract defect. The starting source is
`checks/preservation-after-review-01.json`, whose 35 product/test identities
were checked before editing. All five pinned tooling identities also matched.

Only `canvas-stage.module.css` and the existing `canvas-node-editor.test.tsx`
changed in product/test scope. This report and the separately requested
`source-freeze-after-zoom-2026-10-30.json` are new records. The earlier independent
review, raw receipts, main browser/build artifacts and all specs remain untouched.

## Findings (fixed)

- File: `src/components/create/parts/canvas-stage.module.css:230`.
- Issue: `touch-action: pan-y` on the untransformed editor, its scroller and
  prompt content excluded native browser pinch-zoom, contrary to design section
  3. The editor is a sibling of the Flow viewport, not part of its intentionally
  gesture-controlled canvas subtree. Permissive descendants alone cannot widen
  a restricting ancestor's allowed gestures.
- Fix: two scoped CSS declaration edits allow `pan-y pinch-zoom` on
  `.nodeEditor`, `.nodeEditor .inspectorScroll`, `.nodeEditor .promptInput` and
  `.nodeEditor .promptText`. Both editable and read-only prompt surfaces are
  covered, including the existing short-height whole-editor scroll mode.
- Preserved: transformed/shared prompt base rules, `.viewport` and
  `.previewText` touch-action rules, all geometry/ancestor/short-height CSS,
  Flow routing, controller capability, event handlers and scrolling containment.
- Tests: two parameterized actual CanvasStage/controller cases verify the
  editor remains a sibling of the canvas viewport; panel/scroller/prompt
  touchstart/move/end and pointerdown do not prevent default; scene, camera and
  request counts remain unchanged. Separate authored-CSS assertions cover all
  four scoped selectors and the deliberately unchanged transformed rules.

The CSS assertions inspect source declarations, not a fabricated browser
computed-style result. jsdom event defaults do not prove native pinch arbitration
or actual viewport scaling. Fresh main-owned browser and physical checks remain
separate requirements.

## Findings (not fixed)

No unresolved product defect remains within this narrowly reopened scope.
Native browser/device accessibility zoom remains unverified, not marked passed.

## Verification

All application commands ran through the identity-verified pinned Node v24.22.1
and audited `safe-run.mjs`, with test-mode environment isolation and real
repository-dotenv denial. No browser, dependency preparation, service/DB/Docker,
staging/commit/deployment or lifecycle operation was run by this role.

| Receipt | Result | Duration |
| --- | --- | --- |
| `mobile-zoom-focused-01` | PASS, exit 0, 7 files / 117 tests | 9984ms |
| `mobile-zoom-full-01` | PASS, exit 0, 125 files / 1442 tests | 33260ms |
| `mobile-zoom-types-01` | PASS, exit 0, nonincremental tsc --noEmit | 10841ms |
| `mobile-zoom-lint-01` | PASS, exit 0, zero errors / nine baseline warnings | 12857ms |
| `git diff --check` | PASS, exit 0; existing CRLF notices only | Not timed |
| Changed-file trailing whitespace | PASS for both edited files | Not timed |

All four final wrapper receipts have empty stderr and `timedOut=false`. The
actual-editor suite increases from 25 to 27 tests; the full ordinary suite
increases from 1440 to 1442. Sentinelled DB suites remain excluded, not verified.
The nine existing lint warnings remain in migration-safety, repair,
marketing/mobile-nav and my-works-board tests; no new warning was introduced.

### Retained Red Receipt

`mobile-zoom-regression-01`: exit 1, 25 passed / 2 failed, 7594ms. Both new cases
reached the authored `.nodeEditor` permission assertion and failed because the
source still declared only `pan-y`. This initial run also reported incomplete
async renderer settlement in the new read-only case; the tests now await the
existing settlement helper before/after events, without warning suppression.

The original JSON/stdout/stderr files are preserved under:

`C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-e9e6cb3e34884a1cbeada1b036cfffea/react-flow-spike/logs/`

The new machine-readable freeze records exact command/deadline/code/duration
metadata and SHA256 identities for each receipt and its raw output logs.

## New Final Source Freeze

The final 35-path identity set is recorded in
`checks/source-freeze-after-zoom-2026-10-30.json`. Exactly two hashes differ from
the pre-zoom reviewed-source baseline; the other 33 are unchanged:

```text
src/components/create/parts/canvas-stage.module.css f6c2af7423851f4f44fdb54004c089395303286bc215d20e8dcd87d829b1b889
src/tests/unit/canvas-node-editor.test.tsx 3a359f64483297305d7e2959593a9e717a719592180407cacb43b55a06da58e4
```

Preservation comparison covers all 1337 original baseline identities: only the
same 23 already-authorized mobile baseline files differ. There are no unexpected
baseline changes or additions. Concurrent homepage task additions remain outside
mobile ownership and were not edited. HEAD remains
`1f7948e334c589dc6db38ac045b584f0f5381481`; the index matches HEAD and staging is
empty. Product package/lock/backend/operations files remain unchanged by this
follow-up, as do the other mobile product paths.

Earlier build/fixture receipts stay historical for their exact old source.
This CSS correction invalidates their affected final-source applicability;
the old independent review was not rewritten to conceal that boundary. Main
owns the new repository build, fresh copied-source fixture build, corrected
hit-tested browser/native IndexedDB verification and resulting evidence.

Physical Safari/Android browser zoom, real touch, native Chinese IME/keyboard,
chooser/download and hardware/browser-version coverage remain UNVERIFIED.
Real services and actual CI remain UNPERFORMED/outside this role's authority.
No full MA acceptance, archive, rollout readiness or production claim is made.
