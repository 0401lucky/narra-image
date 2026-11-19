# GHCR Implementation Handoff

## Status And Ownership

Implementation is complete and product/test edits are stopped. Baseline main is
`66a4d0273f9fd3229336945ed06d87d1995943dd`; prior dirty files were main's new task
artifacts. Main-owned task/isolation/config-check changes were preserved.
`handoff-source.json` records the 12 exact product/docs/test byte identities.
No staging, commit, push, registry publication, visibility changes, dependency
installation, production deployment or real credential/database operation occurs.

## Changes

- `.github/workflows/verify.yml`: read-only default permissions; one original
  repository main-push publisher needing all three successful checks; exact SHA
  checkout; job-only package write; serialized noncancelling execution; official
  pinned Docker actions; separate App/Worker cache scopes and fixed SHA builds;
  public pair verification and latest promotion only at the end.
- `scripts/lib/image-release.mjs` and `scripts/publish-images.mjs`: validated
  repository/SHA/digest boundaries, authenticated immutable-tag probe, exact
  missing versus denied/error states, platform/source/revision/license checks,
  OCI index handling, bounded metadata requests/bodies, anonymous public check,
  current-main fencing and exact-manifest alias writes. Status output includes
  both source tags/digest pins and pull commands, never registry credentials.
- `scripts/verify-ci.mjs`: explicit Prisma generation precedes tsc; failed
  generation stops the existing stage runner. Synthetic Next production build
  environment is stage-specific, not inherited by preceding default-env tests.
- Shared disposable PostgreSQL readiness: explicit container loopback TCP:5432
  skips the official image's initialization-only Unix-socket server. Existing
  20s/1s deadlines, owner guards, Docker isolation and cleanup remain unchanged.
- `docker-compose.images.yml`: small explicit-image overlay removes inherited
  build sections while reusing existing base services/volumes/environment.
- README/production operations guide: image names, fixed version pairing,
  first Public-setting prerequisite, no-build pull/update/migrate/start flow,
  health verification, graceful stop, backups and existing rollback preflight.
- Both Dockerfiles minimally copy LICENSE/THIRD_PARTY_NOTICES into final images,
  as requested during main's R1 license review. No base/runtime/schema redesign.

## Tests

New `scripts/tests/image-release.test.mjs` and `ci-prerequisites.test.mjs`
cover trusted gate rejection, immutable reuse, missing/auth/network/malformed
metadata, platform/source/license mismatch, anonymous-versus-authenticated checks,
strict redirect allowlist with bearer removal, response bounds, stale main,
partial alias promotion, non-destructive failure, workflow guards and pins,
Compose overlay selectors, final-image license copies, CI generation order and
failure propagation, and temporary-socket/final-TCP readiness with bounded failure.

All gates run through main's fresh credential-isolated copied dependency runtime,
pinned Node24.22.1. Complete final receipts/stdout/stderr are copied here.

| Gate | Receipt | Result |
| --- | --- | --- |
| All Node release/startup/migration suites | `20261104T092428-node-tests-1fd53e` | PASS, 31 tests |
| Relevant Vitest Docker/E2E/runtime-env | `20261104T092447-test-895bf4` | PASS, 3 files / 55 tests |
| Root ESLint | `20261104T092507-lint-833241` | PASS, 0 errors / 9 existing warnings |
| Strict TypeScript | `20261104T092540-types-f94325` | PASS |
| Whitespace | `git diff --check` | PASS |

Main separately reports actual merged Compose validation, three fresh owned
PostgreSQL TCP-ready/create-database/cleanup cycles, and clean-copy negative tsc
then generate/positive tsc plus no-DATABASE_URL Prisma generation. Those are
main's evidence, not implementer-performed live validation.

## Action Pin Evidence

Public GitHub commit GETs resolve the major action tags used by the publisher:

- docker/setup-buildx-action v3: `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f`
- docker/login-action v3: `c94ce9fb468520275223c153574b00df6fe4bcc9`
- docker/build-push-action v6: `10e90e3645eae34f1e60eeb005ba3a3d33f178e8`
- actions/checkout v4: `11d5960a326750d5838078e36cf38b85af677262`
- actions/setup-node v4: `49933ea5288caeca8642d1e84afbd3f7d6820020`

## Review And Remaining Boundaries

Independent full-scope review, full non-DB tests and final app/image/remote
validation remain main/checker-owned. Examine original-repo guard and GITHUB_TOKEN
scope, first-ever registry authentication/missing-tag behavior, metadata digest
identity, partial alias failures, and exact public visibility. Real GHCR pushes
have not been attempted, so unit mocks are not public publication evidence.

The publisher deliberately keeps fixed image tags after partial/first-private
publication. Operators may need to set both packages Public once and rerun the
failed job; authenticated push alone never marks public availability. Latest
updates across packages are not atomic. Matching source tags/digest pins are
the deployment contract. No images are deleted and no production updater is added.

Main identified that mapping any anonymous HTTP error to Public advice would
misdiagnose an outage. This was corrected before final gates: only denied/404
responses get access/visibility instructions; anonymous503 remains a distinct
registry failure with zero alias writes. The regression retains that distinction.

Spec updates should capture new helper signatures/errors, workflow token/gate
and fixed-tag policies, the first-Public prerequisite, image-only Compose and
the two CI prerequisite contracts. Main owns those spec edits.
