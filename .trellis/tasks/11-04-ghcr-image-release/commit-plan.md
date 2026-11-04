# Release Delivery Batches

Original batch: approved in the original session on 2026-11-04 at 13:06:01 UTC
and delivered after session recovery as `d530132` then `651f12a`, with ordinary
main push verified. See `checks/delivery-approval.md`. The fixture correction
batch at the end of this document was separately approved on 2026-11-04.

## 1. feat(release): publish verified GHCR images

- `.github/workflows/verify.yml`
- `Dockerfile`
- `worker/Dockerfile`
- `docker-compose.images.yml`
- `scripts/verify-ci.mjs`
- `scripts/lib/disposable-postgres.mjs`
- `scripts/lib/image-release.mjs`
- `scripts/publish-images.mjs`
- `scripts/tests/ci-prerequisites.test.mjs`
- `scripts/tests/image-release.test.mjs`
- `README.md`
- `docs/production-operations.md`
- `.trellis/spec/operations/index.md`
- `.trellis/spec/operations/release-hardening.md`
- `.trellis/spec/operations/image-publishing.md`

This is one integrated change: the CI prerequisite fixes enable the guarded
publication job, and the Compose/docs/specs consume the same release contract.

## 2. chore(trellis): record GHCR release verification

- `.trellis/tasks/11-04-ghcr-image-release/` authored planning, research,
  approval, verification, review, isolated-check helpers and nonsecret receipts.
- Includes the task-local `.gitattributes` preserving machine receipt bytes.
- Excludes all ignored runtime snapshots, installed dependencies, credentials,
  test databases, raw stdout/stderr captures and image artifacts. Do not use
  `git add --force` or include the prior canvas task/journal.

Unrecognized dirty files: none at the local handoff. Recheck immediately before
staging, retain any new foreign changes, and ask if ownership is uncertain.

## Approved Delivery Actions After Confirmation

1. Recheck current HEAD, dirty ownership, reviewed source hashes and whitespace.
2. Stage the explicit first group, verify the staged diff and commit normally.
3. Stage only the current task's nonignored records, check and commit normally.
4. Push main without force. If remote main advanced, do not overwrite it.
5. Track the exact pushed SHA's verify:ci, migrations, E2E and publisher results.
6. If first packages are private, report the two Public settings and rerun only
   after the owner completes setup. Verify anonymous digest/platform identity.

No production server/database/volume operation, automatic deployment, branch
protection change, PAT creation, force push, task archive or journal auto-commit
is included in this delivery batch.

## Approved Follow-up: fix(test): isolate canvas runtime fixture environment

Approval status: explicitly approved by the user on 2026-11-04; see
`checks/ci-followup/delivery-approval.md`. The original delivery is already
complete; this corrects the newly exposed CI fixture prerequisite.

- `src/tests/unit/canvas-e2e-runtime-fixture.test.ts`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/tasks/11-04-ghcr-image-release/commit-plan.md`
- `.trellis/tasks/11-04-ghcr-image-release/implement.md`
- `.trellis/tasks/11-04-ghcr-image-release/task.json`
- `.trellis/tasks/11-04-ghcr-image-release/verification.md`
- `.trellis/tasks/11-04-ghcr-image-release/checks/first-hosted-run.json`
- `.trellis/tasks/11-04-ghcr-image-release/checks/hosted-ci-followup.md`
- `.trellis/tasks/11-04-ghcr-image-release/checks/ci-followup/` nonignored
  reproduction/review helpers, exact before-image, receipts and retrospective.

Scope: the fixture owns and restores synthetic auth/database inputs. No business
logic, production environment, workflow gate, timeout or test assertion changes.
Independent full non-DB (1,824), Node (32), lint and types pass without ambient
AUTH_SECRET/DATABASE_URL/APP_URL. No unrecognized dirty paths are included.

After approval, recheck ownership/HEAD/remote main, stage only this explicit
group, verify whitespace and raw evidence blobs, commit once and push main
normally, then track the new exact SHA's three gates and publisher. Exclude all
ignored stdout/stderr, runtime snapshots, credentials and the older canvas task.
The original production/permission/archive boundaries remain unchanged.
