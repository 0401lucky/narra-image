"""Retain exact isolated receipts, without browser profiles or private inputs."""

import argparse
import hashlib
import json
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path


CHECKS = Path(__file__).resolve().parent
RUNNER = Path("C:/Users/Administrator/AppData/Local/Temp/narra-canvas-v1-"
              "e9e6cb3e34884a1cbeada1b036cfffea/react-flow-spike/logs")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("label")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9-]+", args.label):
        raise RuntimeError("A unique capture label is required")
    config = json.loads((CHECKS / "mobile-browser-tooling.json").read_text(encoding="utf-8"))
    root = Path(config["root"]).resolve()
    if root.parent != Path(tempfile.gettempdir()).resolve():
        raise RuntimeError("Only the uniquely owned temporary fixture is readable")
    if root.name != "narra-mobile-canvas-20261030-" + config["owner"]:
        raise RuntimeError("Fixture root identity mismatch")
    marker = json.loads((root / "mobile-fixture-owner.json").read_text(encoding="utf-8"))
    if marker["owner"] != config["owner"]:
        raise RuntimeError("Fixture owner marker mismatch")
    entries = []

    def retain(source, destination):
        data = source.read_bytes()
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            if destination.read_bytes() != data:
                raise RuntimeError("Retained evidence changed: " + str(destination))
        else:
            with destination.open("xb") as handle:
                handle.write(data)
        entries.append({
            "original": str(source),
            "copy": destination.relative_to(CHECKS).as_posix(),
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })

    for source in sorted(RUNNER.glob("mobile-*")):
        if source.is_file() and source.name.endswith((".json", ".stdout.log", ".stderr.log")):
            retain(source, CHECKS / "receipts" / source.name)
    for attempt in sorted(root.glob("mobile-browser-*")):
        if not attempt.is_dir() or not re.fullmatch(r"mobile-browser-[a-z0-9-]+", attempt.name):
            continue
        if attempt.resolve().parent != root:
            raise RuntimeError("Browser evidence escapes its owned root")
        for source in sorted(attempt.iterdir()):
            if source.is_file() and source.name.endswith((".png", ".json", ".log")):
                retain(source, CHECKS / "browser-evidence" / attempt.name / source.name)
            elif source.is_dir() and source.name.endswith("-downloads"):
                for download in sorted(source.iterdir()):
                    if download.is_file() and not download.name.endswith(".crdownload"):
                        retain(download, CHECKS / "browser-evidence" / attempt.name
                               / source.name / download.name)
    report = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "fixture_root": str(root),
        "scope": "Exact isolated raw evidence; excludes browser profiles/caches and real environment files",
        "files": entries,
    }
    output = CHECKS / ("evidence-capture-" + args.label + ".json")
    with output.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"files": len(entries), "manifest": output.name}, indent=2))


if __name__ == "__main__":
    main()
