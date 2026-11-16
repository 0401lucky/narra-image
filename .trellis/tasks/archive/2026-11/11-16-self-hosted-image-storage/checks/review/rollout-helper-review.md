# Rollout Helper Review

## Scope and Verdict

Only `deployment/apply_release.py` was reviewed and changed. Helper quality gate: **PASS**.

Final SHA256: `3652f9672a1188610fae77ec81512f68ca3de655d100aedc5ec849848bc163b9`.

## Findings Fixed

- Baseline validation now checks native Compose service config hash and fixed project-directory/config-file labels. This prevents pending unrelated service settings from silently entering the image-only rollout. Main independently confirmed the server's old service hash equals the running container's `96d21af8d22463b7e3e15fda428edb7bc83d8b9b39089106efdf7ba9b8f1e341`.
- Rollback no longer treats every inspect failure as an absent container. A successful, exact-name container listing must establish absence; list/inspect failures stop rollback rather than starting an unknown competing application.
- Atomic replacement now detects observed uid/gid/mode/inode/timestamp changes while preparing the replacement. It retains original uid/gid/mode and blocks concurrent metadata edits; rollback checks metadata before its preflight/stop actions.
- Readiness tracks container ID across polling and checks it again after success, alongside the required image and database-storage flag. Rollback compares the original actual container flag, including image-provided defaults.
- `.env` symlink changes are rejected at mutation/readiness/rollback guard points.

## Verified Contracts

- CLI selectors are restricted to the fixed `ghcr.io/0401lucky/narra-image-app@sha256:<64 lowercase hex>` and a 40-hex source revision; image platform/source/revision/license are verified.
- Docker uses an empty private config and the pinned local Unix socket, with a clean child environment. Captured command failures reach the report only as stable codes; Compose/env contents and credentials are not printed.
- Renderer preserves unrelated bytes, comments, line endings and existing flag comments. Parsed semantic comparison permits only `services.narra.image` and the explicit database-image flag.
- Backups are exclusive-created at mode 0600; replacement is flushed, fsynced and renamed atomically. Observed concurrent edits stop the operation rather than overwriting unrelated content.
- Application stop is graceful 45 seconds; startup is app-only with `--no-deps`, `--no-build`, `--pull=never`. Readiness is bounded and verifies both health and readiness response semantics.
- Rollback uses the new release's read-only preflight and the original image/config, and does not delete volumes, repair schema, alter database records, or call generation endpoints.

## Verification

- `python -m py_compile deployment/apply_release.py`: PASS on final bytes.
- 17 focused pure/mock fixtures: PASS for LF/CRLF and comments, existing-flag replacement, image/flag-only semantic diff and unrelated DB change rejection, fixed labels, native-hash format/mismatch, genuine absence versus list/inspect failure, container replacement during readiness, and concurrent metadata changes.
- Final execute-path fixture on final bytes: PASS; an observed uid change after forward stop failure blocks rollback before its preflight/stop commands.
- No services started, no SSH calls, no production/database writes, no paid generation requests. Linux filesystem ownership propagation and the actual CLI execution remain main-session deployment verification; fixture checks do not claim those physical operations ran here.

No unresolved findings within this helper's reviewed scope. Production application remains the main session's explicitly authorized action; dry-run must pass before apply.
