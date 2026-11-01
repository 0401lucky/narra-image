# Research: Public Prompt and Homepage Reuse Contracts

- Query: What existing permission, serialization, detail-page, prompt-prefill, and login contracts can safely support homepage gallery Copy Prompt and Remix actions?
- Scope: internal; source and test inspection only. Limited to prompt reuse, not a second homepage styling/header/layout audit.
- Date: 2026-10-30
- Task: `.trellis/tasks/10-30-homepage-warm-editorial-redesign`; planning only. Read the current `prd.md`, workflow, role instructions, and relevant specs. No implementation approval is assumed.

## Confirmed Product Decisions

During resumed planning, the user approved the following bounded Remix behavior, recorded in PRD R4 and AC10-AC11. Implementation still requires the final planning review. The separately approved privacy scope is recorded next.

- Signed-in Remix reuses only the permitted public positive prompt in the existing conversation composer. It does not clone the negative prompt, model, parameters or reference image, and does not generate or charge automatically.
- Anonymous users log in and then return to the gallery to select again; public-prompt copying remains available. The homepage must explain that step instead of promising automatic login continuation. No pending-prompt store or authentication return-target feature is in scope.
- Preserve the saved workspace preference. A user whose preferred mode is canvas switches back to conversation to view the prefill; Remix does not force a mode change, create a canvas node or import a prompt into canvas.
- Existing mounted-draft protection remains a compatibility constraint. Browser navigation/cache behavior and long URLs still need technical validation; source inspection does not establish that every route revisit remounts the composer.

## Approved Privacy Scope

The user approved including the minimum image-detail privacy fix in this task, recorded in PRD R6 and AC12-AC13. This is scope approval, not approval to leave planning.

- Non-owner image-detail responses must exclude internal review metadata and, when prompt publication is disabled, both original positive and negative prompts. A public prompt does not make review metadata public.
- Redaction must take effect before data reaches client components or the RSC payload, not only in rendered controls. Authorized public prompts remain usable.
- Preserve the existing work-visibility rules, author detail/management capabilities and admin flows. Do not add an admin exception to the public detail route or strip permitted data from all owner/admin serializers.
- Add regression coverage for the transferred data, including anonymous and signed-in non-owners, authors, permitted public prompts and inaccessible works. Video behavior changes and a general permission-system redesign remain outside this fix.

## Findings

### 1. Direct Answers (Observed)

- The homepage's public featured-work DTO has a **redacted `prompt` string, but no explicit permission field**. The database and owner/detail DTO have `showPromptPublic`; `SerializedFeaturedWork` and the gallery's local `Work` type omit it (`src/lib/prisma-mappers.ts:130`, `src/lib/prisma-mappers.ts:143`, `src/components/marketing/featured-gallery.tsx:20`).
- Hidden prompts become a nonempty placeholder, not `null`, an empty string, or an error. Its exact JavaScript string, escaped to keep this research file ASCII, is `"\u4f5c\u8005\u672a\u516c\u5f00\u63d0\u793a\u8bcd"` ("Author has not published the prompt"), with **no trailing punctuation** (`src/lib/prisma-mappers.ts:280`). Truthiness or string length cannot identify permission.
- `/create?prompt=...` already exists, but means **prefill the positive prompt of the conversation composer**, not clone the source image, model, negative prompt, parameters, or canvas. It does not automatically generate (`src/app/create/page.tsx:59`, `src/components/create/generator-studio.tsx:178`, `src/components/create/generator-studio.tsx:657`).
- Logged-out navigation does **not** preserve this prompt through login: `/create` redirects to bare `/login`, and successful password login/registration goes to bare `/create` or `/admin`; OAuth login goes to bare `/create` (`src/app/create/page.tsx:23`, `src/components/marketing/auth-form.tsx:102`, `src/app/api/auth/oauth/linuxdo/callback/route.ts:107`).
- `/works/[id]` supports public viewing and permission-gated prompt UI, but it is **not currently a safe server-redacted prompt lookup contract**: the image detail page passes the unredacted owner-shaped `SerializedWork` into a client component before that component hides the prompt. This is an existing server/client privacy-boundary concern, not a browser-verified finding and not changed by this research (`src/lib/prisma-mappers.ts:228`, `src/app/works/[id]/page.tsx:70`, `src/components/works/work-detail-panel.tsx:1`).

### 2. Files Found

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma:544` | Per-image showcase state and prompt-publication flag; video has analogous fields. |
| `src/lib/prisma-mappers.ts:110` | Owner/detail and public featured DTO types and serializers. |
| `src/lib/work-showcase.ts:83` | Publication-state transitions and detail/prompt visibility helpers. |
| `src/components/works/work-showcase-controls.tsx:182` | Author's explicit opt-in to publishing the full prompt. |
| `src/app/api/me/works/[id]/showcase/route.ts:23` | Owner-scoped publication mutation and featured-cache invalidation. |
| `src/lib/server/works.ts:234` | Featured query, viewer-specific likes, paging, and public serialization. |
| `src/app/page.tsx:48` | Initial featured data and current-user lookup; passes items directly to gallery. |
| `src/app/api/works/featured/route.ts:28` | Subsequent public/authenticated featured pages. |
| `src/components/marketing/featured-gallery.tsx:20` | Current client shape, prompt excerpt, detail links, and likes. No Copy/Remix implementation yet. |
| `src/app/works/[id]/page.tsx:14` | Detail access checks; image detail plus fallback video detail. |
| `src/components/works/work-detail-panel.tsx:50` | Owner/public prompt visibility and full-prompt modal. |
| `src/components/works/prompt-modal.tsx:21` | Existing clipboard success/failure UI. |
| `src/lib/prompt-preview.ts:1` | Shared excerpt and labeled main/negative clipboard formatter. |
| `src/components/prompts/prompt-library-board.tsx:98` | Existing raw-prompt copy and authenticated `/create?prompt=` links. |
| `src/app/create/page.tsx:22` | Authentication gate, prompt query parsing, and composer bootstrap. |
| `src/components/create/generator-studio.tsx:117` | Mount-only conversation prompt seed and independent generator defaults. |
| `src/components/create/hooks/use-studio-mode.ts:13` | Owner-qualified saved mode; may show canvas even when a conversation prompt is seeded. |
| `src/app/login/page.tsx:15` | Login query accepts OAuth error only; already-authenticated role redirect. |
| `src/app/register/page.tsx:15` | Registration query accepts error/invite code, not a continuation target. |
| `src/components/marketing/auth-form.tsx:50` | Password login/registration payloads and fixed success destinations. |
| `src/app/api/auth/login/route.ts:46` | Returns session cookie and user JSON, not a redirect destination. |
| `src/app/api/auth/oauth/linuxdo/route.ts:22` | OAuth start stores state/invite code only. |
| `src/app/api/auth/oauth/linuxdo/callback/route.ts:65` | OAuth linking returns to settings; unauthenticated login returns to create. |
| `src/lib/server/current-user.ts:9` | Session/current-user authority; deleted/banned accounts are treated as logged out. |

### 3. Public DTO and Data Flow (Observed)

```text
GenerationImage.showPromptPublic + GenerationJob.prompt
  -> listFeaturedWorksPage (FEATURED only, featuredAt not null)
  -> serializeFeaturedWork (redacts private prompt before public transfer)
  -> homepage initial props OR GET /api/works/featured JSON
  -> FeaturedGallery Work[]
  -> currently: 140-character excerpt + /works/{imageId} + like operation
```

`serializeFeaturedWork` returns exactly these fields (`src/lib/prisma-mappers.ts:270`):

| Public field | Source / semantics |
| --- | --- |
| `authorAvatar` | `work.job.user.avatarUrl`, nullable. |
| `authorName` | `work.job.user.nickname`, otherwise the anonymous-creator label. |
| `featuredAt` | ISO date string or `null`. |
| `id` | Individual generated-image ID, **not** the job ID. |
| `image` | `work.url`. |
| `likeCount` | `_count.likes`, default `0`. |
| `likedByMe` | Boolean existence of included viewer-filtered `likes`. |
| `prompt` | Full, unchanged `job.prompt` when `showPromptPublic`; otherwise the placeholder above. |
| `size` | `job.size`; image-layout metadata, not a Remix instruction. |
| `title` | `job.model`; **not** a curated artwork title or the prompt. |

No `showPromptPublic`, `canUsePrompt`, `showcaseStatus`, `ownerId`, `jobId`, `negativePrompt`, source images, seed, or generation settings are exposed in this DTO (`src/lib/prisma-mappers.ts:143`). The query reads more information on the server, but the serializer deliberately narrows it; adding raw job data to the client would bypass this boundary.

- The query's `viewerId` only filters the included like relation; it does not let an owner retrieve a hidden prompt from the public gallery (`src/lib/server/works.ts:290`). The serializer does not accept viewer identity and only checks the publication flag (`src/lib/prisma-mappers.ts:270`).
- The serializer itself does not check showcase status; the public service enforces `FEATURED` and a non-null `featuredAt` (`src/lib/server/works.ts:246`). Do not generalize it into an authorization check for arbitrary private records.
- Home initial data and subsequent pages share this serializer (`src/app/page.tsx:56`, `src/app/page.tsx:325`, `src/app/api/works/featured/route.ts:36`). A new permission field needs to survive **both** paths and appended pages, not just server-rendered cards.
- Anonymous pages use a 60-second cache/tag; the API uses public cache headers for anonymous requests and `private, no-store` for signed-in requests (`src/app/page.tsx:27`, `src/app/api/works/featured/route.ts:14`, `src/app/api/works/featured/route.ts:44`). Retain this separation; never put owner-only prompts in an anonymous/shared cache.
- The gallery's excerpt truncates at 140 characters; no transformation occurs in the public serializer. Copy/Remix should use the full permitted `work.prompt`, not `getPromptPreview`, `work.title`, or the prototype's demo strings (`src/components/marketing/featured-gallery.tsx:36`, `src/components/marketing/featured-gallery.tsx:53`).

### 4. Publication and Detail Permissions (Observed)

- `GenerationImage.showPromptPublic` defaults to `false` independently of `showcaseStatus` (`prisma/schema.prisma:552`). Publication is an author choice in the submission checkbox (`src/components/works/work-showcase-controls.tsx:182`). Both normal and auto-approved submission preserve it via `Boolean(...)` (`src/lib/work-showcase.ts:92`, `src/app/api/me/works/[id]/showcase/route.ts:36`). Merely being featured is not consent to disclose a prompt.
- Detail access is `isOwner || showcaseStatus === "FEATURED"`; other visitors get `notFound()`, not login escalation (`src/lib/work-showcase.ts:189`, `src/app/works/[id]/page.tsx:50`). `PRIVATE`, `PENDING`, and `TAKEDOWN_PENDING` are not public. No admin-role override exists in these helpers.
- Prompt UI access is `isOwner || (showcaseStatus === "FEATURED" && showPromptPublic)` (`src/lib/work-showcase.ts:196`). Signing in as a different user does not unlock a hidden prompt.

| Context | Image/detail visible? | Positive prompt available under intended UI contract? |
| --- | --- | --- |
| Anonymous or non-owner; FEATURED; flag true | Yes | Yes, without login. |
| Anonymous or non-owner; FEATURED; flag false | Yes | No; show hidden-prompt explanation. |
| Anonymous or non-owner; non-FEATURED | No public detail | No, even if flag true. |
| Owner on detail page | Yes, any showcase state | Yes, regardless of flag. |
| Owner browsing homepage featured feed; flag false | Yes | No owner exception in featured serializer. |

The image detail panel shows a 150-character normalized excerpt and a full-prompt modal when permitted; hidden mode has explanatory copy and no full-prompt button (`src/components/works/work-detail-panel.tsx:55`, `src/components/works/work-detail-panel.tsx:124`, `src/components/works/work-detail-panel.tsx:171`). The modal also receives `negativePrompt`, which the homepage DTO does not contain. There is no detail-page Remix link in this panel.

**Critical existing boundary caveat:** `getWorkById` returns `serializeWork(work)` (`src/lib/server/works.ts:362`); that serializer always includes both raw prompts (`src/lib/prisma-mappers.ts:228`). `WorkDetailPage` then passes the complete object to the `"use client"` panel (`src/app/works/[id]/page.tsx:70`). The panel's `canShowWorkPrompt` check protects rendered controls, not the server-to-client data transfer. Do not fetch/scrape this detail payload to enable gallery actions for hidden prompts or reuse `serializeWork` as the gallery DTO. Any remediation must redact before the public client boundary while preserving owner behavior; it is not implemented here.

Follow-up source inspection confirms that this same owner-shaped payload can also contain review-only fields: `workBaseInclude` selects the reviewer's email and ID (`src/lib/server/works.ts:38`), and `serializeWork` includes the review note, review identity and reviewer object (`src/lib/prisma-mappers.ts:231`). Rendering owner controls only when `isOwner` does not remove these fields from client props. Their presence depends on the record; no real work or account data was accessed. The user has now approved planning a non-owner-safe detail payload that excludes internal review metadata as well as unauthorized prompts, while preserving the existing author/admin flows. This observation and scope approval do not authorize implementation before final review.

Video scope note: the featured API supports `mediaType=video` and redacts video prompts similarly without an explicit public flag (`src/lib/prisma-mappers.ts:286`, `src/lib/prisma-mappers.ts:324`). The homepage currently calls the image service. The video detail fallback renders on the server and checks `video.showPromptPublic` directly, so it does not share the image owner's always-visible-prompt exception (`src/app/works/[id]/page.tsx:23`, `src/app/works/[id]/page.tsx:43`). Do not assume image and video reuse are interchangeable.

### 5. Existing Copy and Remix-Like Patterns (Observed)

- Prompt-library copy writes the raw `item.prompt`; it is not gated by `canCreate` (`src/components/prompts/prompt-library-board.tsx:98`). This is the closest existing match to homepage Copy Prompt, but its implementation lacks a clipboard rejection catch and starts an unmanaged feedback timeout; copy the data contract, not those omissions.
- `PromptModal` uses `navigator.clipboard.writeText` in a `try/catch`, shows success only after resolution, and on failure asks the user to copy manually (`src/components/works/prompt-modal.tsx:21`). Its displayed full text provides a fallback.
- `buildPromptClipboardText` produces a **labeled document** containing the positive prompt and optional trimmed negative prompt (`src/lib/prompt-preview.ts:10`). This format is suitable for the existing full detail modal. It should not be passed to `/create?prompt=` as if it were the raw positive prompt. For homepage raw-copy fidelity, writing the permitted `work.prompt` directly matches the prompt library and the reference.
- The library renders `/create?prompt=${encodeURIComponent(item.prompt)}` only when `canCreate` is true; otherwise it renders bare `/login` in all three action locations (`src/components/prompts/prompt-library-board.tsx:472`, `src/components/prompts/prompt-library-board.tsx:529`, `src/components/prompts/prompt-library-board.tsx:635`). `canCreate` means only `Boolean(user)` (`src/app/prompts/page.tsx:29`).
- Current gallery detail and like actions are independent: image link uses `/works/${work.id}`; like calls the real `PUT /api/works/${workId}/like` and redirects on `401` (`src/components/marketing/featured-gallery.tsx:168`, `src/components/marketing/featured-gallery.tsx:245`). Keep these functional for hidden-prompt cards; add Copy/Remix as independent controls rather than nesting buttons/links inside the existing detail link.
- The reference HTML's Copy reads a demo `data-prompt` and uses `document.execCommand('copy')`; Remix merely displays a toast using `data-title` and scrolls to the hero. There is no genuine parameter handoff to preserve from the prototype (`.trellis/tasks/10-30-homepage-warm-editorial-redesign/references/narra_image.html:1216`).

### 6. `/create?prompt=` and Login Journey (Observed)

`CreatePage` checks the current user **before** resolving `searchParams` (`src/app/create/page.tsx:23`). For an authenticated visit it awaits a Promise or accepts a plain params object, takes the first value if `prompt` is an array, accepts a string, and slices to 8,000 JavaScript string units; otherwise the initial prompt is empty (`src/app/create/page.tsx:59`). There is no manual second URL decode, no work-ID lookup, and no companion query import of other generation settings.

The studio uses `useState(initialPrompt)` once; the default mode is text-to-image, the negative prompt is empty, the model comes from the account's first active channel (fallback `gpt-image-2`), and size is `auto` (`src/components/create/generator-studio.tsx:178`). It may select the user's last/latest existing conversation instead of creating a new one; creation waits until the user actually sends (`src/components/create/generator-studio.tsx:258`). Thus Remix does not currently mean "new conversation" either.

- Same-owner refreshed props intentionally do not overwrite local drafts; changing only `initialPrompt` on an already-mounted studio is not a supported import command (`src/components/create/generator-studio.tsx:112`, `src/tests/unit/generator-studio-origins.test.tsx:251`). Homepage-to-create normally navigates between pages, but route-cache/back-navigation behavior was not browser-tested.
- A stored owner-qualified canvas preference can switch the visible workspace to canvas after mount, even with a nonempty `initialPrompt`. That prompt remains a conversation draft, not a canvas node (`src/components/create/hooks/use-studio-mode.ts:18`, `src/tests/unit/generator-studio-canvas.test.tsx:235`). A guaranteed immediately visible conversation prefill would need an explicit navigation/mode design; do not silently import it into canvas.
- Generation still requires user submission and existing validation; `generateSchema` trims the prompt, requires at least 2 characters, and uses the 8,000-character maximum (`src/lib/validators.ts:79`, `src/lib/generation/limits.ts:2`). Prefilling is not authorization to generate or charge credits.

| Navigation path | Actual destination / retained state |
| --- | --- |
| Signed-in user directly follows `/create?prompt=<encoded>` | Initial positive prompt reaches the conversation draft, subject to 8,000-unit limit and workspace lifecycle above. |
| Logged-out user follows that same URL | Server redirects to `/login` without carrying the query. No prompt is stashed by this path. |
| Logged-out prompt-library user presses Create | Link already points to `/login`; prompt never enters that URL. |
| Successful password login or registration | `AuthForm` pushes `/admin` for admin, `/create` otherwise, then refreshes; no continuation argument. |
| Already-signed-in user visits `/login` or `/register` | Role-based `/admin` or `/create`, without prompt. |
| Successful LinuxDo login while logged out | Session attached, redirect to `/create`, without prompt. |
| LinuxDo account linking while already signed in | Settings linking branch, not prompt reuse; retain this behavior if continuation support is ever added. |

Evidence: `src/app/create/page.tsx:23`, `src/app/login/page.tsx:15`, `src/app/register/page.tsx:15`, `src/components/marketing/auth-form.tsx:24`, `src/components/marketing/auth-form.tsx:102`, `src/app/api/auth/oauth/linuxdo/route.ts:22`, `src/app/api/auth/oauth/linuxdo/callback/route.ts:65`.

Search of `src/` and `scripts/` found no `returnTo`, `callbackUrl`, `redirectTo`, pending-Remix prompt store, or `sessionStorage` continuation implementation. OAuth currently carries only CSRF state and invite code. An encoded `next`/`returnTo` URL added to the homepage alone would be inert; existing login consumers do not read it. The user could manually revisit the original public work after login or copy/paste the prompt, but the automatic journey currently loses the handoff. Expired/deleted/banned sessions have the same gate outcome (`src/lib/server/current-user.ts:29`).

### 7. Selected Integration Direction

The coordinator selected the following direction in `design.md`, within the approved product boundaries. It remains unimplemented and subject to final planning review.

1. Add an explicit public availability flag to `SerializedFeaturedWork` from the existing `showPromptPublic` value; keep the redacted `prompt` behavior unchanged. Reuse the exported serialized type in the gallery rather than maintaining a second field list. This is an additive DTO change, not a database migration or a grant of new prompt access. Both initial and API pages must carry it. Missing flags from older/cached payloads should fail closed for Copy/Remix until refreshed.
2. Gate prompt expansion, Copy, and prompt-based Remix on that flag and nonempty usable text. A hidden card keeps its work link and like operation, displays a clear reason, and does not copy or seed the placeholder. Being logged in must not bypass a hidden flag.
3. Copy the full raw positive prompt from the clicked work, preserving whitespace, with awaited success, handled failure, and selectable/manual-copy fallback. Do not copy only the visible excerpt. Feedback and timers, if added, must stay associated with that card and be cleaned up.
4. For a permitted prompt, link to the existing encoded `/create?prompt=` route. Treat this as **reuse this prompt**, not "restore all lighting parameters" or automatic regeneration. No gallery action should call `/api/generate`, source-image import, or publication mutation.
5. Auth continuity is out of scope. Make the anonymous action explicitly a login prerequisite, with honest instructions to return/reselect or use Copy. Add the Home auth hint used by the gallery; the create page remains authoritative when that hint is stale. Do not promise that login resumes the selected prompt.

**Rejected alternative, no-DTO-change sentinel matching:** comparing against the exact placeholder and rejecting blank strings can avoid copying today's hidden marker, because the server already redacts. This is text-coupled and cannot distinguish a genuinely public prompt equal to that marker; it also breaks if the placeholder wording changes. The final design uses the explicit field instead; old cached records without it fail closed for prompt actions.

**Deferred alternative, now out of scope: seamless logged-out Remix.** If requested in a later task, plan it as an explicit cross-route addition, not just an `href` change. A validated internal continuation must survive create-page auth gating, login/register pages, form success navigation, and LinuxDo's state/callback handling; retain invite, Turnstile, error, and account-linking semantics. Reject external/protocol-relative destinations rather than creating an open redirect. Decide whether an explicit Remix destination overrides the usual admin landing page. A server-resolved public work ID could avoid carrying long prompt text through auth, but no such consumer exists and it would require a permission recheck plus deleted/withdrawn-work handling. A browser-global pending-prompt store is not an existing contract and would need lifetime/account/tab rules; do not invent one as an incidental UI change.

### 8. Tests Found and Gaps

Existing tests were **read, not run**:

| Test | Existing coverage / limitation |
| --- | --- |
| `src/tests/unit/prisma-mappers.test.ts:40` | Public prompt is raw; hidden prompt is the placeholder. Does not assert an explicit availability field or full DTO secrecy. |
| `src/tests/unit/work-showcase.test.ts:230` | Owner/public detail and prompt helper matrices; non-FEATURED visitor denial. Does not test the detail server/client payload. |
| `src/tests/unit/featured-works.test.ts:55` | SQL paging/filter/order/cursor and `hasMore`. No hidden/public + viewer matrix. |
| `src/tests/unit/featured-route.test.ts:23` | Anonymous service arguments, JSON envelope, public cache header. Service is mocked; not an end-to-end redaction check. |
| `src/tests/unit/featured-gallery.test.tsx:33` | Paging, dedupe, detail links, image fallback. No Copy, Remix, hidden prompt, or login-continuation tests. It counts **all** links, so new Remix links require more semantic detail-link assertions rather than retaining old total-link assumptions. |
| `src/tests/unit/prompt-preview.test.ts:4` | Excerpt and labeled positive/negative clipboard formatting. |
| `src/tests/unit/prompt-modal-copy.test.tsx:15` | Full formatted copy succeeds with clipboard stub; no rejection/unavailable-clipboard case. |
| `src/tests/unit/create-page-conversations.test.tsx:47` | Query prompt reaches initial props; `src/tests/unit/create-page-conversations.test.tsx:92` asserts bare `/login` before other loads. Does not cover array/long prompt or an actual login round-trip. |
| `src/tests/unit/generator-studio-canvas.test.tsx:189` | Seeded chat, canvas separation, and no automatic generation; saved canvas-mode restoration also covered. |
| `src/tests/unit/generator-studio-origins.test.tsx:251` | Refreshed same-owner initial prompt does not overwrite the current local draft. |
| `src/tests/unit/auth-form.test.tsx:13` | Invite prefill/OAuth invite links only; no success-destination or continuation assertions. |
| `src/tests/unit/featured-video-serialization.test.ts:46` | Video hidden-prompt placeholder, relevant only if media scope expands. |

Minimum proposed regression matrix:

- Serializer/service: public versus hidden, anonymous versus signed-in/owner viewer, identical permissions on initial and paginated data, no raw hidden prompt or negative prompt in public JSON, and explicit-field absence fails closed. Test a real public prompt equal to the placeholder to prove the UI uses the flag rather than text equality if the field is added.
- Gallery: click/keyboard/touch-accessible Copy uses the correct card's full prompt beyond 140 characters; failure/unavailable clipboard shows a usable fallback; hidden card cannot copy or navigate with a placeholder; work view and real like action remain independent.
- Remix: exact one-round-trip encoding of spaces, newlines, non-ASCII text, `&`, `?`, `#`, `+`, and `%`; route uses the prompt, not title; no generate request; login prerequisite is truthful. Test appended-page cards as well as initial cards.
- Create: plain/Promise search params, repeated `prompt` first value, absent/empty prompt, 8,000-unit boundary, and mounted-local-draft protection. If immediate chat visibility is required, test saved canvas preference explicitly instead of assuming query prefill changes mode.
- Deferred with cross-auth continuation, not a new feature in this task: logged-out create -> password login, register, OAuth success/failure, already-authenticated login, admin landing priority, unsafe return targets, expired session, and public-work withdrawal/deletion if a work-ID handoff is chosen later. Do not claim existing tests already cover an automatic continuation flow.
- For the approved minimum detail privacy fix: assert the **server-provided client props/RSC payload**, not just hidden DOM text, exclude both raw prompts for a non-owner hidden work and exclude internal review metadata for any non-owner public detail; assert public prompts remain available when authorized and author/admin flows still receive their permitted data.

Test patterns should follow existing Vitest + Testing Library mocks, with DB reads mocked. No development database is needed for these unit cases. Later browser verification is still needed for actual clipboard permissions, Next navigation/hydration, long encoded URLs, and saved-mode behavior; a mocked route or DOM test cannot establish those properties.

## Related Specs

- `.trellis/spec/frontend/directory-structure.md:24`: keep DB/auth reads in server pages; page-level auth uses `redirect()`.
- `.trellis/spec/frontend/type-safety.md:27`: validate new external query/continuation inputs; `.trellis/spec/frontend/type-safety.md:47` and `.trellis/spec/frontend/type-safety.md:59`: serialized DTO boundary and shared client types.
- `.trellis/spec/frontend/state-management.md:12`: server facts plus local UI state; `.trellis/spec/frontend/state-management.md:41`: initial props are not a continuous draft import stream; `.trellis/spec/frontend/state-management.md:108`: no direct client DB imports.
- `.trellis/spec/frontend/component-guidelines.md:71`: accessible action labels, proper status/error roles, and explicit button type.
- `.trellis/spec/frontend/canvas-studio.md:35`: owner isolation, post-mount preferences, empty new canvas, no automatic draft import/generation on mode switch.
- `.trellis/spec/frontend/quality-guidelines.md:18`: unit/component/route test organization and mocks; `.trellis/spec/frontend/quality-guidelines.md:65`: never connect tests to a development/production DB.
- `.trellis/spec/guides/cross-layer-thinking-guide.md:21`: map transforms and check round-trips; `.trellis/spec/guides/code-reuse-thinking-guide.md:30`: reuse existing formatters/contracts instead of introducing divergent copies.
- No dedicated public-work prompt/reuse or post-login continuation spec was found; the source and tests above are the concrete current contract.

## External References / Versions

- No external documentation, network lookup, or browser checks were performed.
- Local declared versions only: Next `16.2.4` (`package.json:49`), React `19.2.4` (`package.json:51`), Prisma client `^7.7.0` (`package.json:40`), Zod `^4.3.6` (`package.json:54`), Vitest `^4.1.5` (`package.json:73`), Testing Library React `^16.3.2` (`package.json:59`), pnpm `10.32.1` (`package.json:6`). Installed/resolved versions were not verified.

## Final Design Handoff

- `design.md` selects the additive `showPromptPublic` flag, raw positive-prompt copying and independent view/like actions. These are technical selections within the approved scope, not a claim of passing implementation.
- `design.md` section 8 specifies the allowlisted non-owner detail contract and the server-side projection before client props. Owner/admin serializers stay intact; R6 never authorizes using private detail data for gallery reuse.

## Caveats / Not Found

- Source inspection only: no application startup, tests/builds, browser interaction, external requests, package installation, git operation, or development DB access. Initial research wrote only this document; continuation updates only planning artifacts and rechecks the relevant source.
- The task explicitly remains in planning; findings describe the current worktree, which already contains others' changes. Line numbers are an inspection snapshot.
- The public DTO lacks an explicit permission field; hidden prompts must never be treated as reusable merely because `prompt` is nonempty. Login does not grant access to another author's hidden prompt.
- The automatic logged-out handoff currently loses the prompt. There is no discovered return-target parser or pending-prompt mechanism to reuse; the user approved an explicit login-then-return/reselect journey rather than adding either mechanism in this task.
- Detail UI visibility is not equivalent to redaction before a client boundary; R6 now covers this existing transfer issue, which remains unfixed until implementation and verification.
- No browser/server URL-length limit was measured. An 8,000-unit prompt can become a much larger percent-encoded URL; do not claim that every maximum-length prompt works across deployment proxies without validation.
