# Pending physical-device verification

Status: NOT PERFORMED. Desktop browser emulation, CDP composition, jsdom events
and visualViewport simulation must never fill in these physical-device results.

## Record For Every Device

- Actual hardware, OS version, browser version/engine, locale and native keyboard
  app/version; viewport, orientation, zoom and safe-area state.
- Exact implementation source/build identity, date, scenario, result and receipt
  or recording. Identify whether HTTP/identity is a fixture or a real service.
- Primary supported targets: iOS 18+ Safari (minimum/current available coverage),
  Android 12+ Chrome current/preceding stable major at acceptance, >=360 CSS px.
  Missing versions remain pending; in-app WebViews are not substituted.

## MA1 / MA4: Touch Creation Loop

- New empty canvas; add prompt, reference and generation nodes. Use the node
  chooser and Locate for offscreen/zoomed-out nodes. A tap selects without opening
  competing overlays; explicit Edit opens readable unscaled fields.
- Distinguish one-finger browse pan, two-finger pinch, explicit Move/Done and
  native editor scrolling. During Move, use the whole preview card. Valid drop
  persists once; pointer cancellation or a second finger leaves the last accepted
  position unchanged. Check supported zoom, portrait and landscape.
- Import/cancel/replace an original through the OS chooser. Reuse current-canvas
  originals and completed results. Connect/replace/disconnect/reorder from the
  panel; invalid, duplicate or unavailable replacement preserves the old edge.
- Explicitly Run one ready target; double tap, Enter in fields, upstream edits,
  navigation and resize must not create extra requests. View/download its original
  result, retain prior results and check controls >=44x44 CSS px/fields >=16px.

## MA3 / MA4: Native Chinese Input And Visible Bounds

- Compose Chinese with actual candidate UI, candidate Enter/keyCode229,
  selection/caret changes, long multiline input and local field scrolling.
  Check no temporary old-value restoration, unexpected blur or Run/Save.
- Rotate and show/hide the real keyboard during prompt and unfinished parameter
  editing; use Android Back where applicable. Verify safe areas, short landscape,
  reachable actions/dialog confirmations and stable text/focus.
- Pinch for native browser accessibility zoom inside the untransformed prompt
  and parameter editor in normal and short layouts. Verify native scrolling and
  scene camera stay distinct, no Run/Save occurs, and zoom can be restored.
  A computed CSS or desktop-CDP pinch pass is not Safari/Android device evidence.
- Switch panel/node/canvas/mode and foreground the page. Completed text/geometry
  and unfinished nonsecret parameters survive within their stated lifetime; no
  additional Run/Save occurs. Owner/deleted-node state never leaks into another
  target. Runtime-only unapplied strings are not claimed reload-durable.
- Return to conversation creation. Preserve its intentional Enter/Shift+Enter,
  Chinese composition, references/settings and error recovery. Test original
  viewer/download while its card/editor closes and the OS downloads UI takes over.
- Test provider/CAPTCHA confirmation with an explicitly approved safe fixture.
  No real credentials, paid request or real service is authorized by this matrix.

## MA2: Account And Draft Recovery

- Same-profile native reload restores completed local edits and originals.
  Explicit account Save captures only its acknowledged edit; newer edits remain
  dirty. A separate profile/device restores that saved owner/canvas identity and
  originals without another upload. Test safe failures and warned conflict reload.
- Confirm canvas/node/result deletion removes organization only; retained jobs,
  works and originals remain. No cancellation/refund or delayed resurrection.
- Physical account/service testing requires separate authorization. Fixture HTTP
  passes remain labelled as such; unchanged predecessor API/SQL evidence is dated
  prerequisite evidence, not a new phone/authentication/paid-provider pass.

## Acceptance Gate

Code and automated checks can finish with these items pending. Do not mark all
MA1-MA4 accepted, archive, enable production or declare rollout ready until the
required physical-target evidence is supplied and reviewed. Real services and
actual CI remain separate, explicitly unverified gates.
