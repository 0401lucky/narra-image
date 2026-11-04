"""Independent, bounded no-ambient review; shared isolation helpers stay unchanged."""

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
PROBE = "src/tests/unit/ci-fixture-review-restoration.test.ts"
FIXED_SHA256 = "c76bb69cd11c903ff73c0e7c9bd32dae245d0c9bca369d2f4ae1c09ee3e22ac1"
BASELINE_SHA256 = "2d7b585870c2ab7a9f953138c8b6d1b182736690d5cd0f81a0354c0e5b4f1748"
NODE_TESTS = [f"scripts/tests/{name}.test.mjs" for name in (
    "migration-safety", "release-startup", "image-release", "ci-prerequisites",
)]
STAGES = ("preflight", "focused", "reverted", "restore-absent", "restore-present",
          "cleanup-negative", "full", "node", "lint", "types")


def absent_environment(workspace, node, stage):
    env = checks.clean_environment(workspace, "test", node)
    for name in ("AUTH_SECRET", "DATABASE_URL"):
        env.pop(name, None)
    forbidden = {"AUTH_SECRET", "DATABASE_URL", "APP_URL", "NODE_PATH", "HTTP_PROXY",
                 "HTTPS_PROXY", "ALL_PROXY", "GITHUB_TOKEN", "GH_TOKEN"}
    if forbidden.intersection(key.upper() for key in env):
        raise ValueError("Forbidden ambient configuration in spawned environment")
    owner, _ = checks.validate_workspace(workspace)
    expected_options = f'--require "{(owner / "tools/deny_env.cjs").as_posix()}"'
    if env.get("NODE_ENV") != "test" or env.get("NODE_OPTIONS") != expected_options:
        raise ValueError("The original credential-deny lane must stay intact")
    if stage in {"restore-absent", "restore-present", "cleanup-negative"}:
        env["NARRA_REVIEW_RESTORE_MODE"] = "present" if stage == "restore-present" else "absent"
    return env


def stage_command(workspace, node, stage):
    if stage == "preflight":
        return [str(node), str(EVIDENCE / "environment-probe.cjs")], 57
    if stage == "node":
        return [str(node), "--test", *NODE_TESTS], 57
    if stage in {"lint", "types"}:
        entry, args, _, timeout = checks.STAGES[stage]
        return [str(node), str(workspace / entry), *args], timeout
    entry, args, _, _ = checks.STAGES["test"]
    targets = [] if stage == "full" else [PROBE if stage.startswith("restore-") or stage == "cleanup-negative" else FIXTURE]
    return [str(node), str(workspace / entry), *args, *targets], 300 if stage == "full" else 57


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--stage", choices=STAGES, required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--refresh", action="store_true")
    options = parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,35}", options.label):
        raise ValueError("Use a short evidence label without path separators")
    output = EVIDENCE / f"{options.label}.json"
    if output.exists():
        raise ValueError("Never overwrite earlier evidence; use a new label")
    workspace = options.workspace.resolve()
    owner, _ = checks.validate_workspace(workspace)
    node = checks.node_executable(str(isolated.PINNED_NODE))
    if checks.digest(checks.PROJECT / FIXTURE) != FIXED_SHA256:
        raise ValueError("Worktree fixture changed after the source freeze")
    if checks.digest(owner / "tools/deny_env.cjs") != checks.digest(CHECKS / "deny_env.cjs"):
        raise ValueError("Owned preload does not match the audited shared guard")
    if options.refresh:
        checks.refresh_workspace(workspace)

    with checks.workspace_lock(workspace):
        checks.audit_dependencies(workspace / "node_modules")
        manifest_file = owner / "source-manifest.json"
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        if not (EVIDENCE / "source-inputs.json").exists():
            checks.write_json(EVIDENCE / "source-inputs.json", manifest)
        original_state = checks.source_state(workspace, list(manifest["files"]))
        if any(original_state[name] != item["sha256"] for name, item in manifest["files"].items()):
            raise ValueError("Unexpected modified snapshot input before review")
        fixture, probe = workspace / FIXTURE, workspace / PROBE
        if checks.is_link(fixture) or not checks.within(fixture, workspace) or probe.exists():
            raise ValueError("Refusing a foreign fixture or pre-existing probe")
        original = fixture.read_bytes()
        if checks.digest(fixture) != FIXED_SHA256:
            raise ValueError("Snapshot fixture differs from frozen source")
        command, timeout = stage_command(workspace, node, options.stage)
        changed_fixture = False
        created_probe = False
        try:
            if options.stage == "reverted":
                baseline = EVIDENCE.parent / "implementation/canvas-e2e-runtime-fixture.test.ts.before"
                if checks.digest(baseline) != BASELINE_SHA256:
                    raise ValueError("Baseline before-image changed")
                fixture.write_bytes(baseline.read_bytes())
                changed_fixture = True
            if options.stage in {"restore-absent", "restore-present", "cleanup-negative"}:
                probe.write_bytes((EVIDENCE / "restore-probe.ts.before").read_bytes())
                created_probe = True
            if options.stage == "cleanup-negative":
                cleanup = b"  afterEach(() => {\n    vi.unstubAllEnvs();\n  });\n"
                if original.count(cleanup) != 1:
                    raise ValueError("Expected one exact cleanup hook")
                fixture.write_bytes(original.replace(cleanup, b"", 1))
                changed_fixture = True
            before = checks.source_state(workspace, list(manifest["files"]))
            probe_hash = checks.digest(probe) if created_probe else None
            report = checks.run_bounded(workspace, command,
                                       absent_environment(workspace, node, options.stage),
                                       timeout, options.stage)
            after = checks.source_state(workspace, list(manifest["files"]))
        finally:
            if changed_fixture:
                fixture.write_bytes(original)
            if created_probe:
                if checks.is_link(probe) or not checks.within(probe, workspace):
                    raise ValueError("Refusing to remove an escaped review probe")
                probe.unlink()
        restored = checks.source_state(workspace, list(manifest["files"]))
        if restored != original_state or checks.digest(checks.PROJECT / FIXTURE) != FIXED_SHA256:
            raise ValueError("Source or restored snapshot changed during review")
        checks.audit_dependencies(workspace / "node_modules")
        report.update({
            "sourceBefore": before, "sourceAfter": after,
            "sourceChanges": [name for name in before if before[name] != after[name]],
            "snapshotModifications": [name for name in before if before[name] != original_state[name]],
            "sourceManifest": str(manifest_file),
        })
        raw_receipt = owner / "receipts" / f"{report['id']}.json"
        checks.write_json(raw_receipt, report)
        logs = {}
        for stream in ("stdout", "stderr"):
            copy = EVIDENCE / f"{options.label}.{stream}.log"
            shutil.copy2(report[stream], copy)
            logs[stream] = {"path": copy.name, "sha256": checks.digest(copy)}
        summary = {
            **{key: value for key, value in report.items() if key not in {"sourceBefore", "sourceAfter"}},
            "rawReceiptSha256": checks.digest(raw_receipt),
            "sourceIdentitySha256": hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(),
            "sourceManifestSha256": checks.digest(manifest_file),
            "testedFixtureSha256": before[FIXTURE],
            "restoredSnapshotFixtureSha256": checks.digest(fixture),
            "worktreeFixtureSha256": checks.digest(checks.PROJECT / FIXTURE),
            "probeSha256": probe_hash,
            "temporaryProbeRemoved": not probe.exists(),
            "launcherSha256": checks.digest(Path(__file__)),
            "preloadSha256": checks.digest(owner / "tools/deny_env.cjs"),
            "absentBeforeNodeStartup": ["AUTH_SECRET", "DATABASE_URL", "APP_URL"],
            "logs": logs,
        }
        checks.write_json(output, summary)
    print(json.dumps(summary, indent=2))
    return report["exitCode"]


if __name__ == "__main__":
    raise SystemExit(main())
