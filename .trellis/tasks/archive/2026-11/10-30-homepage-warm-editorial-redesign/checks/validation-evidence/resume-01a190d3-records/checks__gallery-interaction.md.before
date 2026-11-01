# Gallery Interaction Implementation Evidence

- Date: 2026-10-31; implementer: `gallery_interaction`.
- Scope: implementation plan step 5. This document does not mark the integrated G4/G5/G6 or asset acceptance complete.
- Safety: every Node test/lint/type command ran through `checks/isolated_check.py` in the owner-marked, credential-free `checks/.runtime/production-fa4bca90/app` snapshot. No live dotenv, account, database, provider, storage, generation, migration or release command was used.
- Runtime: available Node 24.11.1; project-pinned 24.22.1 parity remains unverified.

## Implemented Contracts

- `FeaturedGallery` consumes `SerializedFeaturedWork`, not a duplicated local Work type. Initial props bootstrap once; Home owns the viewer-qualified remount key. Appended records and card like state survive ordinary same-viewer refresh.
- The real featured endpoint is requested with `limit=16`; immutable-ID merge preserves order and caps both initial and appended records at 72. Observer and button call one ordinary command with a synchronous request lock, authoritative snapshot and epoch checks. The next cursor is committed before releasing the lock, even before React commits a render.
- Cursor transport validation remains opaque: nonempty bounded base64url token shape plus consistent `hasMore`/cursor, no competing client decoder or sort logic. Equal or previously consumed cursors produce visible errors. Duplicate-only valid pages pause automatic advancement and retain an explicit manual next-page action.
- First-page failure has a genuine first-page retry. Later failures retain successful records and the failed cursor, release loading and suspend automatic retry. Loading, empty feed, exhausted feed and homepage display cap are distinct states, with no fake total or public-gallery route.
- The shared gallery request helper bounds fetch and JSON together to 15 seconds. Abort/unmount ends the caller's wait even for ignored-abort promises, and late continuations never own state publication. Like commands serialize independently by mounted work, await the actual PUT response, retain prior state on failure, and route real 401s to bare `/login`. Uncertain toggle outcomes are explicitly labeled, not automatically retried.
- Scoped grid uses one/two/four columns and fixed 4:5 centered thumbnails. Original URLs/detail destinations and optimizer-to-original fallback are retained. Entrance, preserve-3D tilt, clipping image, warm glare and forward information depth are distinct elements; no full-card backdrop filter or idle per-card animation loop was added.
- Independent detail, like, disclosure, copy and remix controls support mouse, touch, keyboard, Escape and focus return. Closed drawer controls are inert. Public full text is available in a bounded, selectable textarea; short cards scroll the information panel without covering the like control.
- Prompt actions require `showPromptPublic === true` and nonblank full text. Missing cached flags default false at the centralized network schema. A genuinely public prompt equal to the old redaction placeholder remains usable. Hidden data is never fetched from detail to bypass this flag.
- Shared clipboard feedback is bound to the work identity/full raw text. Denied or missing clipboard exposes and selects the complete manual-copy textarea. Authenticated remix links contain only the encoded positive `prompt` query. Guests see login-and-return/reselect instructions; the saved-canvas/manual-chat hint remains visible. No create/auth/mode/persistence/generation code was modified.

## Files Owned And Changed

Production:

- `src/components/marketing/featured-gallery.tsx`
- `src/components/marketing/homepage/gallery-card.tsx`
- `src/components/marketing/homepage/gallery.module.css`
- `src/components/marketing/homepage/gallery-constants.ts`
- `src/components/marketing/homepage/gallery-request.ts`
- `src/components/marketing/homepage/hooks/use-featured-gallery.ts`
- `src/components/marketing/homepage/hooks/use-work-like.ts`
- `src/lib/validators.ts`: one type-only import and appended narrow featured/cursor/like response schemas only; pre-existing mobile/canvas edits retained.

Tests:

- `src/tests/unit/featured-gallery.test.tsx`
- `src/tests/unit/featured-gallery-likes.test.tsx`
- `src/tests/unit/featured-response-validation.test.ts`
- `src/tests/unit/use-featured-gallery.test.tsx`
- `src/tests/unit/helpers/gallery-fixtures.ts`

Shared homepage motion, reveal, visibility, pointer and clipboard hooks are owned by `homepage_visual` and imported without edits. Page/header/hero/footer/assets, the privacy mapper and create/canvas/global/infra files were not changed by this implementer. No commits or staging occurred.

## Actual Checks

Receipts and exact bounded stdout/stderr are under `checks/.runtime/production-fa4bca90/receipts/`. Every listed receipt records `sourceChanges: []`, `snapshotModifications: []`, the source-before/source-after hashes and the sanitized environment keys.

| Receipt ID | Command through isolated runner | Result |
| --- | --- | --- |
| `20261031T020033-test-ded034` | `test` with the four gallery suites | 4 files, 72 tests passed; exit 0; 11.562 seconds; empty stderr |
| `20261031T020126-lint-0b7c74` | `lint` | Exit 0; 12 warnings: 9 baseline plus 3 unused disable directives; all 3 subsequently removed by the respective owners |
| `20261031T020216-types-3f82c8` | `types` | Exit 2: unavailable Github imports in visual slice and partially typed gallery test Response mocks; preserved red receipt, both fixed |
| `20261031T020431-test-bfde9d` | `test` with four gallery and four homepage suites | Gallery 72/72 passed again; combined 103/104 passed, exit 1; one hero test query matched both accessible full text and visual typewriter (visual owner fixed it later) |
| `20261031T020543-types-2d2845` | `types` | Exit 2, remaining gallery test Response diagnostics; removed redundant casts and made the real Response helper contract explicit |
| `20261031T020634-lint-d0e79c` | `lint` | Exit 0; only the 9 documented baseline warnings remain; empty stderr |
| `20261031T020903-types-1d5114` | `types` | Exit 0; 4.957 seconds; empty stdout/stderr; snapshot captured at 02:08:52 UTC |

The four gallery suites contain 19 component tests, 25 loader tests, 12 like tests and 16 schema tests. Coverage includes 16 -> 32 -> 48 -> 64 -> 72, same-tick/deferred-render requests, duplicate/cycling cursors, malformed data, missing flags, bootstrap/retry/empty, stalled fetch and JSON, ignored abort, unmount and new viewer isolation, clipboard rejection/unavailability, public placeholder equality, full Unicode/multiline text, guest hints, original fallback, independent controls and keyboard/touch disclosure. Tests mock network responses; they do not prove live service behavior.

After the final test-only type cleanup, the visual owner takes the production lane for a fresh combined test/lint/type cycle. The earlier 72-test evidence is not substituted for that final integrated run. This implementer released the lane after `20261031T020903-types-1d5114`; no helper/server remains running.

`git diff --check` passed for the owned tracked files. A Python read-only scan of all 13 owned source/test files also passed trailing-whitespace/final-newline checks, including untracked files. LF-to-CRLF Git notices were informational.

## Remaining Boundaries

- **Encoded long URLs are an unresolved baseline compatibility issue, not a new gallery regression.** The coordinator reports real-Next baseline `/create?prompt=` results: ASCII 8000/8001 units returns 200 and prefill truncates to 8000; Chinese 8000 units (72015-byte encoded request URL) and emoji 8000 units (56019 bytes) return 431. User approval for a bounded copy/manual-paste fallback is pending. No new URL threshold, guard, auth continuation or create-page workaround was implemented. The existing >8000-unit UI note alone does not solve the encoded URL limit.
- The three approved hero bitmaps were not generated because the host image model is unavailable. No stock/placeholder asset was substituted. Asset-dependent visual acceptance and final scene fidelity remain blocked independently of gallery unit checks.
- Native browser hit testing, motion/depth rendering, responsive geometry, full-prompt navigation, saved-canvas behavior and raw SSR/RSC privacy checks belong to the separately owned browser lane. Static DOM/CSS structure tests do not claim those results.
- Final full non-DB suite, unmodified production build, independent review and integrated acceptance belong to the coordinator's final cycle. No real-account/DB/Worker/provider E2E, physical-device check or pinned-runtime parity is implied.
- Recommended spec assessment for the coordinator: preserve the public-flag fail-closed contract, sync-snapshot-before-unlock request invariant, duplicate-only auto suspension, and ignored-abort fetch-plus-JSON cleanup as reusable guidance only after final review.
