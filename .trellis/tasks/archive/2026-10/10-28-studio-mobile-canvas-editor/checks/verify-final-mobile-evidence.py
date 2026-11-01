"""Verify retained mobile receipts and exact source applicability, not devices."""

import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


CHECKS = Path(__file__).resolve().parent
TASK = CHECKS.parent
REPO = TASK.parents[2]
PASS_LABELS = (
    "mobile-zoom-focused-01", "mobile-zoom-full-01", "mobile-zoom-types-01",
    "mobile-zoom-lint-01", "mobile-main-final-types-01", "mobile-main-final-lint-01",
    "mobile-final-build-02", "mobile-final-worker-ts-01", "mobile-fixture-build-04",
    "mobile-browser-07", "mobile-fixture-audit-prebuild-04",
    "mobile-fixture-audit-postbuild-04", "mobile-fixture-audit-prebrowser-07",
    "mobile-fixture-audit-postbrowser-07",
)


def read_json(target):
    return json.loads(target.read_text(encoding="utf-8"))


def digest(target):
    return hashlib.sha256(target.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("label")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9-]+", args.label):
        raise RuntimeError("A unique evidence label is required")
    spec_record = next(target for target in (
        CHECKS / "spec-sync-final-02-2026-10-31.json",
        CHECKS / "spec-sync-final-2026-10-31.json",
        CHECKS / "spec-sync-2026-10-31.json",
    ) if target.exists())
    spec = read_json(spec_record)
    browser_dir = CHECKS / "browser-evidence/mobile-browser-07"
    report = read_json(browser_dir / "results.json")
    assert report["pass"] is True and len(report["results"]) == 27
    assert all(result["pass"] is True for result in report["results"])
    assert not report["apiErrors"]
    for browser in report["browsers"]:
        assert browser["chrome"] == "Chrome/156.0.8078.74"
        assert not browser["exceptions"]
        if browser["name"] == "lazy-network":
            assert len(browser["consoleErrors"]) == 1
            assert len(browser["blocked"]) == 1
            assert browser["blocked"][0]["reason"] == "intentional lazy chunk failure"
        else:
            assert not browser["consoleErrors"] and not browser["blocked"]
    for entry in report["harnessIdentities"]:
        assert digest(CHECKS / entry["path"]) == entry["sha256"]
    evidence = read_json(CHECKS / "mobile-fixture-source-04.json")
    assert report["sourceEvidence"] == evidence
    assert len(evidence["identities"]) == 224
    for entry in evidence["identities"]:
        assert digest(REPO / entry["path"]) == entry["sha256"]
        assert digest(Path(evidence["fixture"]) / entry["path"]) == entry["sha256"]
    for phase in ("prebuild", "postbuild", "prebrowser-07", "postbrowser-07"):
        audit = read_json(CHECKS / ("mobile-fixture-audit-04-" + phase + ".json"))
        assert audit["pass"] is True and not audit["changed"]
        assert all(entry["equal"] for entry in audit["packageLinks"])
    freeze = read_json(CHECKS / "source-freeze-after-zoom-2026-10-30.json")
    assert len(freeze["current_mobile_identities"]) == 35
    for entry in freeze["current_mobile_identities"]:
        assert digest(REPO / entry["path"]) == entry["sha256"]
    gates = []
    for label in PASS_LABELS:
        receipt_path = CHECKS / "receipts" / (label + ".json")
        receipt = read_json(receipt_path)
        assert receipt["code"] == 0 and receipt["timedOut"] is False
        logs = []
        for suffix, key in ((".stdout.log", "stdoutPath"), (".stderr.log", "stderrPath")):
            retained = CHECKS / "receipts" / (label + suffix)
            assert retained.read_bytes() == Path(receipt[key]).read_bytes()
            logs.append({"path": retained.relative_to(TASK).as_posix(),
                         "sha256": digest(retained), "bytes": retained.stat().st_size})
        gates.append({"label": label, "receipt_sha256": digest(receipt_path),
                      "code": receipt["code"], "duration_ms": receipt["durationMs"],
                      "timeout_ms": receipt["timeoutMs"], "logs": logs})
    for manifest_path in CHECKS.glob("evidence-capture-*.json"):
        for entry in read_json(manifest_path)["files"]:
            assert digest(CHECKS / entry["copy"]) == entry["sha256"]
    for identity in read_json(CHECKS / "tooling-identity-2026-10-30.json")["identities"]:
        assert digest(Path(identity["path"])) == identity["sha256"]
    for entry in spec["frontend_spec_identities"]:
        assert digest(REPO / entry["path"]) == entry["final_sha256"]
    task = read_json(TASK / "task.json")
    assert task["status"] == "in_progress" and task["priority"] == "P3"
    assert task["meta"]["physical_device_acceptance"] == "pending"
    prd = (TASK / "prd.md").read_text(encoding="utf-8")
    assert len(re.findall(r"^- \[ \] MA[1-4] /", prd, re.MULTILINE)) == 4
    whitespace = subprocess.run(
        ["git", "--no-optional-locks", "diff", "--check"], cwd=REPO,
        text=True, capture_output=True, encoding="utf-8"
    )
    assert whitespace.returncode == 0
    staged = subprocess.check_output(
        ["git", "--no-optional-locks", "diff", "--cached", "--name-only"], cwd=REPO
    ).decode("utf-8").splitlines()
    assert not staged
    checked_paths = [TASK / name for name in ("prd.md", "design.md", "implement.md",
                                              "verification.md", "handoff.md", "task.json",
                                              "implement.jsonl", "check.jsonl")]
    checked_paths += [REPO / entry["path"] for entry in freeze["current_mobile_identities"]]
    checked_paths += [REPO / entry["path"] for entry in spec["frontend_spec_identities"]]
    for target in checked_paths:
        assert not any(line.rstrip(" \t") != line
                       for line in target.read_text(encoding="utf-8").splitlines())
    record = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "scope": "Retained final automated receipts/source/spec identities; physical/native/services/actual CI remain unperformed",
        "pass": True,
        "gates": gates,
        "browser_groups": len(report["results"]),
        "browser_engine": report["browsers"][0]["chrome"],
        "exact_production_fixture_inputs": len(evidence["identities"]),
        "frozen_product_test_paths": len(freeze["current_mobile_identities"]),
        "task_status": task["status"],
        "final_spec_identity_record": spec_record.name,
        "ma1_ma4_checked": False,
        "staged_paths": staged,
        "git_diff_check": {"code": whitespace.returncode,
                           "stdout": whitespace.stdout, "stderr": whitespace.stderr},
        "task_artifact_identities": [{"path": str(target.relative_to(REPO)),
                                      "sha256": digest(target)}
                                     for target in checked_paths[:8]],
    }
    output = CHECKS / ("final-evidence-audit-" + args.label + ".json")
    with output.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"pass": True, "browser_groups": 27,
                      "source_inputs": 224, "product_test_paths": 35,
                      "final_pass_receipts": len(gates), "output": output.name}, indent=2))


if __name__ == "__main__":
    main()
