"""Audit the reviewed mobile delta without reading private environment files."""

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


TASK = Path(__file__).resolve().parents[1]
REPO = TASK.parents[2]
CHECKS = TASK / "checks"
SPEC_PATHS = {
    ".trellis/spec/frontend/canvas-studio.md",
    ".trellis/spec/frontend/index.md",
    ".trellis/spec/frontend/quality-guidelines.md",
    ".trellis/spec/frontend/state-management.md",
}
REVIEW_FIXES = {
    "src/components/create/parts/canvas-node-inspector.tsx":
        "8724ee0db77a35d70617c0a7326c7336fa1ed18447a1d6e2ff8935c4dee11e35",
    "src/components/create/parts/canvas-runtime-dialog.tsx":
        "9697a8181344b5f1880a8c537e87a9e86acc0cb6dd052824b63e56c3034bc73c",
    "src/components/create/parts/canvas-stage.tsx":
        "4f8697f5abe5467d72b5b12cd98571ce17c94cc32dc52c8835598ecadcd9ba09",
    "src/tests/unit/canvas-node-editor.test.tsx":
        "4fc432a37f831ce06af728714b5b68c56fbc16d4e9314e8d37c15e347d3f2152",
}


def git(*args):
    return subprocess.check_output(
        ["git", "--no-optional-locks", *args], cwd=REPO
    ).decode("utf-8")


def identity(relative, base=REPO):
    target = base / relative
    name = target.name.lower()
    if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
        raise RuntimeError("Private environment inputs are forbidden")
    if not target.exists():
        return {"path": relative, "kind": "absent"}
    data = target.read_bytes()
    return {
        "path": relative,
        "kind": "file",
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("label")
    parser.add_argument("--with-specs", action="store_true")
    parser.add_argument("--expected", type=Path)
    args = parser.parse_args()
    if not args.label or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-"
                             for c in args.label):
        raise RuntimeError("A unique evidence label is required")
    baseline = json.loads((TASK / "research/planning-source-baseline-2026-10-30.json")
                          .read_text(encoding="utf-8"))
    freeze = json.loads((CHECKS / "source-freeze-before-review-2026-10-30.json")
                        .read_text(encoding="utf-8"))
    expected = {entry["path"]: entry["sha256"]
                for entry in freeze["current_mobile_identities"]}
    expected.update(REVIEW_FIXES)
    if args.expected:
        checkpoint = json.loads(args.expected.read_text(encoding="utf-8"))
        replacement = {entry["path"]: entry["sha256"]
                       for entry in checkpoint["current_mobile_identities"]}
        if set(replacement) != set(expected):
            raise RuntimeError("Expected checkpoint must retain exactly the owned scope")
        expected = replacement
    original = {entry["path"]: entry for entry in baseline["identities"]}
    current = [identity(relative) for relative in sorted(expected)]
    source_mismatches = [entry["path"] for entry in current
                         if entry.get("sha256") != expected[entry["path"]]]
    changed = [relative for relative, entry in original.items()
               if identity(relative) != entry]
    allowed = set(expected) | (SPEC_PATHS if args.with_specs else set())
    unexpected_changes = [relative for relative in changed if relative not in allowed]
    paths = set(git("ls-files", "-c", "-o", "--exclude-standard", "-z").split("\0")) - {""}
    task_prefix = TASK.relative_to(REPO).as_posix() + "/"
    additions = sorted(relative for relative in paths
                       if relative not in original and not relative.startswith(task_prefix))
    ui_additions = [relative for relative in additions
                    if relative.startswith(".trellis/tasks/10-30-homepage-warm-editorial-redesign/")]
    unexpected_additions = [relative for relative in additions
                            if relative not in allowed and relative not in ui_additions]
    index_entries = sorted(git("ls-files", "--stage", "-z").split("\0")[:-1])
    head_entries = []
    for entry in git("ls-tree", "-r", "-z", "HEAD").split("\0")[:-1]:
        fields, relative = entry.split("\t", 1)
        mode, _, object_id = fields.split(" ")
        head_entries.append(f"{mode} {object_id} 0\t{relative}")
    snapshot_root = CHECKS / "pre-implementation-2026-10-30-02"
    snapshots = json.loads((snapshot_root / "source-identities.json").read_text(encoding="utf-8"))
    snapshot_mismatches = []
    for entry in snapshots:
        if entry["kind"] != "file":
            continue
        actual = identity(entry["path"] + ".before", snapshot_root / "source")
        if (actual.get("sha256"), actual.get("bytes")) != (entry["sha256"], entry["bytes"]):
            snapshot_mismatches.append(entry["path"])
    staged = git("diff", "--cached", "--name-only").splitlines()
    report = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "scope": "Reviewed-source and preserved-work provenance, not MA/device/service acceptance",
        "head": git("rev-parse", "HEAD").strip(),
        "baseline_identities": len(original),
        "index_entries_match_unchanged_head": index_entries == sorted(head_entries),
        "staged_paths": staged,
        "current_mobile_identities": current,
        "mobile_changed_baseline_paths": [p for p in changed if p in expected],
        "main_spec_changes": [p for p in changed if p in SPEC_PATHS and args.with_specs],
        "authorized_ui_additions": ui_additions,
        "unexpected_baseline_changes": unexpected_changes,
        "unexpected_additions": unexpected_additions,
        "source_mismatches": source_mismatches,
        "preserved_snapshot_copies": sum(e["kind"] == "file" for e in snapshots),
        "snapshot_mismatches": snapshot_mismatches,
        "real_dotenv_read": False,
    }
    report["pass"] = (
        report["head"] == baseline["head"]
        and report["index_entries_match_unchanged_head"]
        and not any((staged, unexpected_changes, unexpected_additions,
                     source_mismatches, snapshot_mismatches))
    )
    output = CHECKS / ("preservation-" + args.label + ".json")
    with output.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items()
                      if key != "current_mobile_identities"}, indent=2))
    if not report["pass"]:
        raise RuntimeError("Preservation/source mismatch: coordinate before further edits")


if __name__ == "__main__":
    main()
