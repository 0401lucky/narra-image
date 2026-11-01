"""Capture existing mobile inputs without reading real environment files."""

import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


TASK = Path(__file__).resolve().parents[1]
REPO = TASK.parents[2]
BASELINE = TASK / "research/planning-source-baseline-2026-10-30.json"
LABEL = sys.argv[1] if len(sys.argv) > 1 else "pre-implementation-2026-10-30"
if not re.fullmatch(r"pre-implementation-2026-10-30(?:-[a-z0-9]+)?", LABEL):
    raise RuntimeError("A task-owned pre-implementation label is required")
OUTPUT = TASK / "checks" / LABEL
UI_TASK = ".trellis/tasks/10-30-homepage-warm-editorial-redesign/"


def git(*args):
    return subprocess.check_output(["git", "--no-optional-locks", *args], cwd=REPO)


def identity(relative):
    path = REPO / relative
    if path.name.lower() == ".env" or (
        path.name.lower().startswith(".env.")
        and path.name.lower() != ".env.example"
    ):
        raise RuntimeError("Real environment files must not enter this audit")
    if not path.exists():
        return {"path": relative, "kind": "absent"}
    data = path.read_bytes()
    return {
        "path": relative,
        "kind": "file",
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def main():
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    original = {entry["path"]: entry for entry in baseline["identities"]}
    changed = [path for path, entry in original.items() if identity(path) != entry]
    current_paths = sorted(
        set(git("ls-files", "-c", "-o", "--exclude-standard", "-z")
            .decode("utf-8").split("\0")) - {""}
    )
    own_prefix = TASK.relative_to(REPO).as_posix() + "/"
    additions = [path for path in current_paths
                 if path not in original and not path.startswith(own_prefix)]
    allowed = [path for path in additions if path.startswith(UI_TASK)]
    unexpected = [path for path in additions if not path.startswith(UI_TASK)]
    head = git("rev-parse", "HEAD").decode().strip()
    index_path = Path(git("rev-parse", "--git-path", "index").decode().strip())
    if not index_path.is_absolute():
        index_path = REPO / index_path
    index_hash = hashlib.sha256(index_path.read_bytes()).hexdigest()
    index_entries = sorted(git("ls-files", "--stage", "-z").decode().split("\0")[:-1])
    head_entries = []
    for entry in git("ls-tree", "-r", "-z", "HEAD").decode().split("\0")[:-1]:
        fields, relative = entry.split("\t", 1)
        mode, _, object_id = fields.split(" ")
        head_entries.append(f"{mode} {object_id} 0\t{relative}")
    report = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "scope": "approved pre-edit provenance, not application verification",
        "head": head,
        "head_matches_planning": head == baseline["head"],
        "index_sha256": index_hash,
        "index_matches_planning": index_hash == baseline["index_sha256"],
        "index_entries_match_unchanged_head": index_entries == sorted(head_entries),
        "index_entries_sha256": hashlib.sha256(
            "\n".join(index_entries).encode("utf-8")
        ).hexdigest(),
        "raw_index_hash_note": "git status may refresh stat metadata; entries are authoritative",
        "staged_paths": git("diff", "--cached", "--name-only").decode().splitlines(),
        "baseline_identities": len(original),
        "changed_baseline_paths": changed,
        "authorized_concurrent_ui_additions": allowed,
        "unexpected_additions": unexpected,
        "status": git("status", "--porcelain=v1").decode().splitlines(),
        "real_environment_files_read": False,
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report_path = OUTPUT / "preservation.json"
    if report_path.exists():
        raise RuntimeError("Pre-edit provenance already captured; do not overwrite")
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if (changed or unexpected or report["staged_paths"]
            or not report["head_matches_planning"]
            or not report["index_entries_match_unchanged_head"]):
        raise RuntimeError("Unexpected preserved-work change; coordinate before editing")
    snapshots = []
    for relative in current_paths:
        if not relative.startswith(("src/components/create/", "src/tests/unit/")):
            continue
        entry = identity(relative)
        snapshots.append(entry)
        if entry["kind"] == "file":
            target = OUTPUT / "source" / (relative + ".before")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((REPO / relative).read_bytes())
    (OUTPUT / "source-identities.json").write_text(
        json.dumps(snapshots, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({
        "preserved_baseline_identities": len(original),
        "authorized_ui_additions": len(allowed),
        "source_snapshots": len(snapshots),
        "head_and_index_entries_unchanged": True,
        "output": OUTPUT.relative_to(REPO).as_posix(),
    }, indent=2))


if __name__ == "__main__":
    main()
