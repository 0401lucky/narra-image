# Asset Delivery Independent Review

- Reviewer: `homepage_asset_browser`, dispatched `trellis-check`, 2026-10-31.
- Current status: Source review and isolated lint/types/24 focused tests pass. Actual-image browser verification found a confirmed desktop hero copy hit-testing defect; coordinator owns the narrow product correction. Red browser receipts are retained, not final acceptance.
- Ownership: Browser helpers/evidence, this report and `browser-acceptance.md` only. No product, application configuration, shared dependency, other task runtime, credential, commit or deployment changes.
- The separately attempted review agent failed at model transport before returning a verdict. No result from that agent is used here.

## Reviewed Inputs

Loaded the saved role hook, PRD/design/implementation plan, check manifest and its frontend/public-data/quality/lifecycle/isolation references. Read the prior `independent-review.md` as historical context, not as this review's verdict.

`browser/evidence/resume-preparation-1793418995856/prior-final-source-comparison.json` compares the prior final 802-file production manifest to this fresh 806-file snapshot: 800 exact files are unchanged. The only changes are the three accepted original PNG additions, the `constants.ts` dimensions/rain-v2 URL, the hero test update and the new asset contract test. No earlier source/test regression was removed; create/canvas/auth/data-access/global-theme/package/schema/runtime files remain byte-identical to the previous verified implementation.

| Input | SHA-256 |
| --- | --- |
| `src/components/marketing/homepage/constants.ts` | `b7994c6de611f5e85559f27d539c9d53680ddf55a00c7304bdb88536da05cd59` |
| `src/tests/contracts/homepage-assets.test.ts` | `aaa25c5571e6814130cd8cc171981d71fe71eb50e080f9d88e537572e8594872` |
| `src/tests/unit/homepage-hero.test.tsx` | `2842f2b7d1f7749029a4e0417be31ac41364234927251c5ed4a83e292ccc7e2e` |

## Actual Source Review

- Assets: all scenes now reference distinct local accepted originals with exact 1448x1086 dimensions. The rejected rain-v1 file is absent. Original prompt/alt/style wording and fixed-scene independence are preserved. No new fetch, image-generation request, provider configuration, dependency or code-generated success placeholder enters production.
- Tests: the new Node-environment asset contract checks local path containment, bounded regular files, PNG signature/IHDR/IEND, real dimensions, 4:3/minimum size, distinct files and digests, rejected-candidate absence, all 344 self-hosted CSS declarations/115 WOFF2 resources and the three OFL notices. Header/container checks alone do not prove full image decoding or font glyph rendering; real Chromium success/font checks remain separate.
- Hero: reviewed actual `HeroScene`, `useHeroScene`, typewriter, dust, pointer-depth and motion provider. Scene commit occurs after decode and is epoch-guarded; failure keeps committed image/text coherent, revision-keyed retries replace failed DOM, copy uses complete committed text, and cleanup cancels listeners/deadlines. Only the decoded visible hero owns one bounded 32-particle loop. Shared pause/reduced/visibility controls stop decorative work without removing controls.
- Privacy: re-read actual async detail page and public projection. Existing access policy precedes the exact eleven-key non-owner allowlist; hidden positive/negative prompts become null and review fields cannot leak by spreading. Owner/admin serializers and video fallback stay unchanged. Current browser runs independently exercise raw HTML and navigation/refresh Flight, not only visible controls.
- Feed/actions: re-read Home bootstrap, shared featured projection, response schemas, gallery component/card, paging, request and like hooks, and clipboard hook. The same public permission flag serves initial/API data; missing flags fail closed. Synchronous request/cursor snapshots, bounded fetch-and-JSON waits, epoch checks, duplicate/cursor handling and the 72-item cap remain intact. Same-viewer refresh preserves local state; actual viewer change remounts. Full public copying, denial/manual text, real like acknowledgements and guest login behavior remain independent of image success.
- Remix: only the public positive prompt enters the existing encoded create URL. No auth continuation, canvas import, model/parameter clone or automatic mutation is added. The known multibyte HTTP431 limit remains a product-decision blocker; the character-count note does not fix it.
- Theme/navigation: re-read explicit home/default header branches, mobile portal and footer. Existing account/check-in/logout/pet components remain wired; homepage typography and palette remain scoped. Four capability demos do not issue business writes. Footer destinations are actual routes/sections, with no invented public gallery, filters, model/status/legal pages.

## Findings (Fixed)

These are browser-harness/evidence fixes, not product workarounds.

- `browser/hero-scene-contract.mjs`: replace the now-rejected rain-v1 expectation with accepted v2; pin all three independent original hashes/dimensions and visible preset labels. Fixture preparation rejects a wrong bitmap instead of silently accepting any nonempty file.
- `browser/input-identity.mjs`: record all helper/template bytes and immutable Next output hashes, not only `BUILD_ID`; assert the exact corrected G0 guard. Real Next generated external-dependency links initially failed the strict regular-file rule. The correction individually verifies each link resolves inside this new physical dependency copy, with exact targets in the identity receipt. Outside links remain rejected; the startup red receipt is preserved.
- `browser/hero-image-checks.mjs`: add rendered/client dimensions, correct object-fit/position, full preset/example disclaimers and real delayed-delivery receipts. Mobile scene screenshots now require the whole frame after native scrolling. Copy tests cover all three scenes while the real typewriter remains incomplete, including a return to film.
- `browser/homepage-checks.mjs`: the diagnostic native events prove the old return-navigation fallback clicked an already-expanded disclosure (`aria-expanded=true`, visible text `收起`) and therefore closed it. Use settled entrance plus a fresh native hover instead of that double-toggle. Touch disclosure coverage is retained.
- `browser/cdp.mjs`: add bounded native-input diagnostics. A visible candidate can receive a native pointer approach before the final geometry/hit recheck; no button is pressed unless `elementFromPoint` confirms the real target. Fast scene clicks remeasure after the pointer changes the frame transform. No DOM `.click()`, success response substitution or disabled accessibility assertion is used.

## Findings (Not Fixed)

- Existing maximum-length multibyte remix URLs still receive HTTP431 before create renders. Both Chinese and emoji failures remain separate unresolved records, not successful checks or an approved fallback.
- Confirmed product defect in `homepage.module.css`: with a decoded image and tilted hero, a visible copy button's painted center is intercepted by the image. `diagnostic-1793420516503/hero-native-hit-diagnostic.json` captures `elementFromPoint` returning IMG both before/after a settled pointer approach, and actual native pointerdown/up/click events all targeting IMG; no clipboard write occurs. `elementsFromPoint` misleadingly lists the button first and cannot be used to bypass this failure. The old missing-image path did not expose the obstruction. Coordinator owns the stacking correction; browser success remains pending.
- Mobile visual risk: the fixed overlaid prompt panel covers most of the fox lantern and rainy-stone reflections in the 390px full-frame captures. The scenes load and match their subjects, but this is not perfect subject placement. Complete frame captures in `home-1793420304347/` are handed to the coordinator for the narrow responsive-layout decision.

## Verification

Independent fresh lane: `checks/.runtime/browser-hero-resume-72e89a9f/app`; 806 copied inputs, 46,664 physically copied dependency files (856,682,032 bytes), 2,342 audited internal links. No old production/browser/mobile snapshot is reused or modified. All commands use the task Python allowlist/preload launcher, finite deadlines, hidden owned processes and installed Node 24.11.1, not pinned 24.22.1.

| Independent Gate | Receipt | Result |
| --- | --- | --- |
| Unmodified-source lint | `20261031T040036-lint-8716a1` | Pass, 0 errors / 9 pre-existing warnings, no source drift |
| Unmodified-source TypeCheck | `20261031T040113-types-401cb2` | Pass, no source drift |
| Asset/hero unit tests | `20261031T040248-test-0d2d2d` | 2 files / 24 tests pass, no source drift |
| Installed Prisma generation | `20261031T040301-script-4b3548` | Pass with inherited network-denial preload; no engine download |
| First full real-image browser run | `20261031T040703-script-91a253` | Red: 78/82 executable checks pass; 4 harness/interaction failures retained, source/helper/build drift empty |
| Diagnostic narrowed browser run | `20261031T041453-script-b93506` | Red: 1/5 pass; records native event targets used to diagnose the helper defects |
| Direct native hero obstruction probe | `20261031T042156-script-3f7f4c` | Red: native copy press hits IMG; zero copied prompts, proving the product obstruction |

Root separately reports final production 137 files / 1624 tests, lint/types, offline Prisma generation and unmodified Next build green in `validation-evidence/asset-delivery-final/`. These are root-run gates, not this reviewer's execution. Browser builds intentionally replace only the synthetic DB boundary and add task fixtures; they are not unmodified production builds.

## Spec Assessment

No platform template/update/detection touchpoint is affected by these assets. Existing homepage/public-data specs already describe exact privacy and lifecycle contracts. Coordinator owns any reusable test-harness lesson promotion; native hover/final-hit checks and full-frame mobile captures are concrete verification lessons. Do not use simulated DB/browser success to claim real-account, DB, Worker, provider, storage, physical-device/native IME, pinned-runtime, CI or deployment acceptance.
