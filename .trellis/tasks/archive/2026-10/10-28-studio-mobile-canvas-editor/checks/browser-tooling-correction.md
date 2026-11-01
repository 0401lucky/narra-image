# Rejected fixture build and isolated correction

- `mobile-fixture-source-01` copied 224 exact production component/lib/contract/
  CSS inputs; `mobile-fixture-audit-prebuild-01` verified those identities before
  compilation. Neither receipt is application acceptance.
- `mobile-fixture-build-01` returned compiler exit 0, but its generated private
  fixture package lacked `packageManager`. `pnpm exec` selected pnpm 12.16.1 and
  its automatic dependency verification installed/downloaded packages in the
  owned temporary fixture/tool caches. Its log also reports ignored Sharp build
  scripts. This result is REJECTED, not an accepted copied-installed-only build.
- The fixture's node_modules links were restricted to its own copied temporary
  package store, not the repository's package contents. Repository package/lock,
  application sources, HEAD and staging are unchanged by this tooling command.
  No browser/service was started by this attempt and no real dotenv, DB/S3 or
  paid-provider operation occurred. Raw logs/receipt are retained unchanged.
- Preserve the rejected temporary root and config as historical evidence; do
  not delete arbitrary caches or user Temp. Prepare a new uniquely owned root
  using installed-package copies only. Future fixture compilation invokes the
  pinned Node executable and the copied Next `dist/bin/next` directly, never
  `pnpm exec` or an implicit install. The fixture package also records the
  repository's existing packageManager for accurate metadata.
- Package-link audits must prove Next/React/Flow/TypeScript resolve to the copied
  installed package destinations before/after build/browser. All production and
  fixture-helper input hashes/inventories must match before any browser verdict.
- Independent product review also corrected runtime/pointer/field source after
  the first snapshot. The old source/build receipts are stale for those paths;
  the next fixture must use the reviewer's final current-source freeze.

This correction changes verification tooling only, not product dependencies,
approved mobile scope, production flags, manual gates or task lifecycle.

## First browser attempt: rejected unclipped click coordinates

- `mobile-browser-01` ran actual source-bound fixture-02. The first three groups
  passed, then the legacy helper clicked connection-button bounding-box centers
  without scrolling or respecting the editor's clipped scroll area. Those two
  coordinates reached the inline Run card instead; two fake generation requests
  occurred, no reference edges were created, and the ordering selector was absent.
  This is a rejected harness attempt, not a connection or no-auto-Run pass.
- Original scripts are preserved byte-for-byte in `browser-harness-01/` with
  `.before` suffixes and hashes. JSON/stdout/stderr/screenshots remain unchanged.
- The task-owned wrapper now scrolls each control, intersects its bounds with
  actual clipping ancestors and checks `elementFromPoint` before dispatching
  native CDP pointer events. It records the exact hit target. Each connection
  waits for the intended domain edge and immediately asserts zero new Run calls.
  Production source and the copied API/CDP helper files are not modified.
- Programmatic native-select change events, CDP file/composition/touch events
  and desktop downloads remain labelled simulations, not OS picker/native IME
  or physical-phone acceptance. The corrected attempt must run from a new
  isolated browser profile and retain its own fresh receipts.
- Pre-rerun inspection also corrected the representative seed's zero-based
  image ordinal to the shared schema's one-based ordinal. The 24-node/32-edge
  graph must be valid; production validators/limits are not relaxed to load it.

## Second browser attempt: fixed overlays are not studio-scroll descendants

- `mobile-browser-02` on fresh fixture-03 passed the first four groups, including
  actual reference connections/order, zero connection-triggered Run calls,
  separate-profile restoration and captured cloud conflict handling.
- Its close-viewer click was rejected by the new harness's overly broad clip
  calculation: it incorrectly intersected a viewport-fixed overlay with logical
  studio scroll ancestors. The retained screenshot shows the 44px close control
  visibly at the viewport top; no product defect was established by that error.
- Ancestor clipping now stops at the fixed overlay's viewport boundary while
  still checking the editor's own scroll clips and `elementFromPoint`. It never
  substitutes a DOM `.click()` or removes the real hit-target check. The red
  receipt/screenshots/request records remain unchanged; next attempt is fresh.

## Third browser attempt: CDP DOM assignment is not a JSON return value

- `mobile-browser-03` passed 11 groups on fixture-03: all preceding desktop
  regressions, representative/capacity scenes, and phone capability/composition/
  five responsive layouts with computed accessibility-touch permissions.
- Entering the new pinch group failed in CDP `Runtime.evaluate` because a raw
  assignment returned the React-managed textarea DOM object under
  `returnByValue:true` (`Object reference chain is too long`). No pinch assertion
  ran; this is a harness serialization error, not a native-zoom product verdict.
- Exact attempt-03 harness inputs are retained in `browser-harness-03/`, matching
  the raw report hashes. DOM-reference setup now explicitly returns `void`, both
  for the pinch prompt and the analogous runtime-input marker. Subsequent
  assertions still return only booleans/numbers/plain evidence projections.

## Fourth browser attempt: native pinch calibration, not a requirement waiver

- `mobile-browser-04` reached the native-pinch assertion but
  `Input.synthesizePinchGesture` left `visualViewport.scale=1`. This failed
  assertion is retained, not marked as zoom acceptance.
- Discriminating `mobile-native-pinch-probe-01` used a separate plain non-React
  loopback page on Chrome/156.0.8078.74. Synthesized pinch did nothing for both
  `auto` and `pan-y pinch-zoom`; dispatched two-finger touch events changed
  native scale to 3.187213897705078 for both, while `touch-action:none` retained
  scale 1. Thus the synthesized-command result was not product-specific.
- The application assertion now uses the positively/negatively calibrated
  native dispatched touch sequence. It still requires actual browser page-scale
  change, stable field/domain/camera and zero requests; it does not substitute
  programmatic scale setting as a pass. Resetting scale occurs only afterwards.
- The next fresh fixture adds only a controllable dummy `savedProvider` prop to
  its wrapper. The actual runtime component's native associated checkbox label
  must measure >=44px and activate from a real CDP touch without confirmation.
  No real provider credentials/settings/service or production source changes.

## Fifth browser attempt: embedded selector quoting

- `mobile-browser-05` passed 14 groups, including actual native browser
  accessibility page zoom (scale 1 -> 2.9294252395629883), real Flow browse/pinch/
  Move/cancellation and mounted unfinished parameter Run/Save guards.
- The runtime branch measured and touch-activated its native saved-provider
  label, then hit a harness `Runtime.evaluate` syntax error: a quoted aria-label
  selector lost its inner escaping inside a JavaScript string. No runtime field
  layout verdict is claimed from that failed group.
- Exact attempt-05 harness inputs are retained. Runtime and the analogous image
  selector now use `JSON.stringify(selector)` rather than two-layer hand quoting.
  This changes only task evidence scripts, not product source or requirements.

## Sixth browser attempt: close the editor before background Save

- `mobile-browser-06` passed 16 groups, including dummy saved-provider label
  measurement/native activation, stable focused runtime fields across short
  layouts, and phone local import/connection replacement/order.
- After an expected duplicate-input alert, the open bottom editor covered the
  toolbar Save coordinate. The harness correctly refused a real hit on Close
  settings instead. It did not bypass the overlay or create a Save request.
- Independent read-only Trellis review confirmed the intended Close -> toolbar
  Save path: no simultaneous background-Save access is required; Close preserves
  mounted pending drafts and Save validates/applies them before capture. No
  product layout blocker was identified and the source freeze remains unchanged.
- The next attempt performs real visible Close, asserts zero Run/Save, then
  hit-tests toolbar Save. It retains invalid-pending rejection and delayed
  snapshot/newer-edit assertions; no covered-background DOM click is allowed.
