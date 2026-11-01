# Final Planning Review

- Task: `.trellis/tasks/10-30-homepage-warm-editorial-redesign`
- Status: Awaiting the user's approval of the latest complete planning summary.
- Scope decisions are approved; implementation, asset generation and product checks have not started.

## Confirmed Decisions

| ID | Decision | Requirement |
| --- | --- | --- |
| D1 | Closely reproduce the warm editorial HTML, real fonts, six motion groups and four capability miniatures; remove review-only decorations | R1-R3 |
| D2 | Fixed hero independent of live works, with newly prepared bookshop/fox/rainy-lane illustrations replacing broken or mismatched original URLs | R3 |
| D3 | Desktop four-column 4:5 gallery, centered thumbnail cropping, unchanged originals/detail views | R4 |
| D4 | Keep actual paging and Load More, 16 per page / 72 shown; no new classifications or public-gallery destination | R4 |
| D5 | Public-positive-prompt-only remix; guests log in then return/reselect; keep saved canvas preference and manual chat switch; no automatic generation or import | R4 |
| D6 | Minimum image-detail privacy fix before client transfer; preserve public prompts, authors, admin behavior and access rules | R6 |
| D7 | Reference-like footer composition with actual routes/sections/GitHub, without invented model/policy/status pages | R4 |

The early exact-source hero-image choice is superseded by D2. The original session and asset research remain available as evidence; they must not override the latest approved requirement.

## Convergence Gate

- Goal and product value: reference-faithful homepage with real business interactions and safe detail data.
- In/out boundaries: explicit in PRD and design, including no canvas/auth/backend-gallery expansion, no production environment/CI changes and no unauthorized commit/deployment.
- Acceptance: all AC1-AC14 describe observable outcomes and remain unchecked pending actual implementation evidence.
- User-owned choices: resolved. No blocking product question remains.
- Technical risks: font glyph/rendering, image production, Next navigation/cache behavior and safe fixture/tool prerequisites have specific implementation and validation gates, not assumed passing results.
- PRD convergence: historical decisions moved to research, superseded/open questions removed, original source anchors retained, requirements/acceptance mappings preserved, design/checklist details kept in their own artifacts.
- Scope isolation: this task owns neither mobile-canvas source/resources nor the rest of the dirty worktree.

## Acceptance Trace

| Acceptance | Planned evidence | Execution gate |
| --- | --- | --- |
| AC1 | Loaded fonts, local assets, desktop/mobile reference comparisons, no prototype-only elements | G2, G3, G6 |
| AC2 | All six live motion groups and four miniatures, counters only under the hero | G3, G6 |
| AC3 | Account, likes, routes and public-prompt action regressions | G1, G4, G6 |
| AC4 | Empty/error/guest/keyboard/touch behavior and real failure feedback | G3, G4, G6 |
| AC5 | Reduced motion/pause, rapid switching, cleanup and stale callbacks | G3, G4, G6 |
| AC6 | Default header/theme and create/works/settings/admin route baselines | G3, G6 |
| AC7 | Three matching local scenes, live-feed independence and exact full copy | G2, G3, G6 |
| AC8 | Four-column 4:5 grid with original images/detail preserved | G4, G6 |
| AC9 | Paging races, retry/exhaustion/cap, no fake classifications or browse-all | G4, G6 |
| AC10 | Explicit public permission, correct positive-prompt handoff and zero automatic mutations | G1, G4, G6 |
| AC11 | Guest instruction/copy and saved canvas/manual conversation behavior | G4, G6 |
| AC12 | Allowlisted actual client props and raw Next HTML/RSC sentinels | G1, G6 |
| AC13 | Owner/admin compatibility, authorized public prompts and non-owner 404 | G1, G6 |
| AC14 | Real footer routes/anchors and correct permission-sensitive entries | G3, G6 |

G5 covers lint, type-check, full non-DB Vitest and the unmodified-source build for the entire task. Independent `trellis-check` review follows the last implementation iteration.

## Artifact And Evidence Status

- `prd.md`: final requirements and 14 unchecked acceptance criteria.
- `design.md`: selected architecture, exact public detail contract, visual/state lifecycles, compatibility and rollback.
- `implement.md`: ordered G0-G6 work/check gates and independent review, with exact existing command interfaces and safe-environment prerequisites.
- `implement.jsonl`: 15 real spec/research entries; `check.jsonl`: 14. Neither contains source files or seed-only entries.
- `checks/planning-baseline.json`: original PRD source anchors and pre-convergence hashes of 18 relevant product files.
- `checks/planning-validation.json`: generated results for document/context validity, reference evidence hashes and unchanged product-file hashes.

Documentation checks do not count as application tests, a passing build, rendered visual approval or a fixed privacy leak. No final images, product modifications, browser session, live DB/provider/storage operation, staging, commit, push or deployment occurs in this planning turn. The active task pointer remains unset until approval and `task.py start`.

## Final Approval Boundary

The next user-facing summary must state the goal, scope, exclusions, key choices, acceptance strategy, relevant risks/deferred real-service checks and artifact readiness, then ask whether implementation may start. Only a subsequent approval of that complete summary permits activation; any material revision repeats this review.
