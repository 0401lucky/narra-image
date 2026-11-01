# Homepage Asset Evidence

## Current Continuation

The interrupted source session had already produced successful images after
the user repaired the external account-pool proxy. The older failure history
below is retained for provenance; it is no longer the current asset blocker.

The continuation visually inspected and published the unchanged original
`bookshop-light-v1.png`, `lantern-fox-v1.png` and `jiangnan-rain-v2.png` under
`public/marketing/home/`. All three decode as 1448x1086 PNGs (4:3), not the
requested 1536x1152. The first rain candidate was rejected for a corner emblem;
the independently generated second candidate is selected without pixel edits.

`image-manifest.json` records each public/source path, successful provider
receipt, full prompt, actual dimensions, byte count, SHA-256 and visual review.
No new external request, credential reuse, site generation or provider change
occurs in this continuation. The 14-case real asset contract and focused checks
pass; refreshed browser and final full-scope checks are pending. Publication
alone is not a final acceptance verdict.

## Fonts

`prepare_fonts.py --publish` completed on 2026-10-31. The prepared official
Google Fonts CSS contains 344 declarations and 115 distinct WOFF2 files
(6,348,964 bytes). Every binary passes the WOFF2 signature/declared-length
check; all original style, weight and Unicode-range declarations remain.

Production destinations:

- `public/marketing/home/fonts/`: 115 unmodified font binaries and three OFL notices.
- `src/components/marketing/homepage/fonts.css`: local URLs and unique family aliases.
- `THIRD_PARTY_NOTICES.md`: append-only font license inventory.

`font-manifest.json` records every source URL, byte count and SHA-256. Only
unauthenticated public font downloads were used, with inherited proxy settings
disabled. No production build/runtime font download is introduced. File-level
checks do not by themselves prove rendered glyph coverage or font performance.
The final browser lane separately confirms custom glyph rendering by all three
families: the cold desktop requests eight font files, 418,652 transferred bytes
(416,252 decoded bytes). See `../browser/evidence/full-1793413804860/result.json`.
This measurement is not the entire package size or a general performance SLA.

## Historical Built-In Generation Failure

All three built-in image-generation calls failed before producing output:

```text
HTTP 400: no model to draw with: Codex's provider has no matching image model
and magpie's Settings > Images > Image generation has none enabled
```

The user was asked to enable a host image model. There is no generated image to
inspect, copy or hash. `image-prompts.json` preserves the three exact requested
reference prompts and complete production prompts for a later retry after that
external setting changes. No image CLI, site provider, private API key, stock
substitute or misleading generation record was used.

G2 and the real-image portions of G6 remain incomplete. Components may test
their explicit image-failure path; mocked decoder tests cannot complete the
three-scene delivery or visual-fidelity acceptance criteria.

## Historical External API Failure Before Proxy Repair

The user subsequently authorized `https://chatgpt2api.204152.xyz/` and the
provider model alias `gpt-image-2.5-sunburst`, including request-header research.
The exact supplied key authenticates successfully and the requested alias is
in `/v1/models`. Only the key-free generation endpoint/schema is recorded in
`provider-contract.json`; this is a third-party alias, not a claim about an
official OpenAI model name.

Two bounded `POST /v1/images/generations` attempts for the bookshop scene both
return HTTP 503, code `no_available_account`. The second adds ordinary browser
Origin/Referer/language/fetch metadata and returns the same application error.
Bearer authentication, JSON content type and a browser User-Agent are present.
No redirects, proxies, TLS-verification bypass, automatic retries or model
fallback are used. The call uses PowerShell/.NET HttpClient; no bundled image
script is modified and no one-off SDK runner or dependency is installed.

No image bytes were returned, so the fox/rain scenes were not submitted and no
production asset was published. The service needs an available account for
this model, or an explicitly authorized alternative. Provider receipts under
`provider-output/` contain prompts and error codes, never credential values.
This changes the external blocker, not the still-incomplete asset acceptance.
