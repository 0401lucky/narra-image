"""Reproduce the hosted fixture prerequisite without ambient auth/database values."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys


EVIDENCE = Path(__file__).resolve().parent
CHECKS = EVIDENCE.parents[1]
sys.path.insert(0, str(CHECKS))
import isolated  # noqa: E402


checks = isolated.checks
FIXTURE = "src/tests/unit/canvas-e2e-runtime-fixture.test.ts"
TARGETS = {
    "fixture": [FIXTURE],
    "related": [
        FIXTURE,
        "src/tests/unit/canvas-e2e-http-fixture.test.ts",
        "src/tests/unit/canvas-http.test.ts",
        "src/tests/unit/parse-generate-request.test.ts",
        "src/tests/unit/env-security.test.ts",
    ],
}
original_environment = checks.clean_environment


def absent_environment(workspace, lane, node):
    env = original_environment(workspace, lane, node)
    if lane != "test":
        raise ValueError("This follow-up permits test-lane checks only")
    env.pop("AUTH_SECRET", None)
    env.pop("DATABASE_URL", None)
    if env.get("APP_URL") or env.get("NODE_ENV") != "test" or not env.get("NODE_OPTIONS"):
        raise ValueError("The credential-deny test lane must remain intact")
    return env


checks.clean_environment = absent_environment
entry, args, lane, _ = checks.STAGES["test"]
checks.STAGES["test"] = (entry, args, lane, 57)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--stage", choices=[*TARGETS, "lint", "types"], required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--revert-fixture", action="store_true")
    options = parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,35}", options.label):
        raise ValueError("Use a short evidence label without path separators")
    summary_path = EVIDENCE / f"{options.label}.json"
    if summary_path.exists():
        raise ValueError("Use a new label; never overwrite a prior receipt")
    workspace = options.workspace.resolve()
    owner_root, _ = checks.validate_workspace(workspace)
    node = checks.node_executable(str(isolated.PINNED_NODE))
    if options.refresh:
        checks.refresh_workspace(workspace)
    if (owner_root / "active.lock").exists():
        raise ValueError("Another check owns this snapshot")

    fixture = workspace / FIXTURE
    original = fixture.read_bytes()
    if options.revert_fixture:
        if options.stage != "fixture":
            raise ValueError("Reversion is restricted to the focused fixture check")
        fixture.write_bytes((EVIDENCE / "canvas-e2e-runtime-fixture.test.ts.before").read_bytes())
    try:
        tested_hash = checks.digest(fixture)
        stage = "test" if options.stage in TARGETS else options.stage
        report = checks.run_stage(workspace, stage, node, TARGETS.get(options.stage, []))
    finally:
        if options.revert_fixture:
            fixture.write_bytes(original)

    raw_receipt = owner_root / "receipts" / f"{report['id']}.json"
    logs = {}
    for stream in ["stdout", "stderr"]:
        copied = EVIDENCE / f"{options.label}.{stream}.log"
        shutil.copy2(report[stream], copied)
        logs[stream] = {"path": copied.name, "sha256": checks.digest(copied)}
    source_identity = hashlib.sha256(json.dumps(report["sourceBefore"], sort_keys=True).encode()).hexdigest()
    summary = {
        **{key: value for key, value in report.items() if key not in {"sourceBefore", "sourceAfter"}},
        "rawReceiptSha256": checks.digest(raw_receipt),
        "sourceIdentitySha256": source_identity,
        "testedFixtureSha256": tested_hash,
        "worktreeFixtureSha256": checks.digest(checks.PROJECT / FIXTURE),
        "restoredSnapshotFixtureSha256": checks.digest(fixture),
        "revertedFixtureOnly": options.revert_fixture,
        "absentBeforeNodeStartup": ["AUTH_SECRET", "DATABASE_URL"],
        "sourceManifestSha256": checks.digest(Path(report["sourceManifest"])),
        "launcherSha256": checks.digest(Path(__file__)),
        "logs": logs,
    }
    checks.write_json(summary_path, summary)
    print(json.dumps(summary, indent=2))
    return report["exitCode"]


if __name__ == "__main__":
    raise SystemExit(main())
