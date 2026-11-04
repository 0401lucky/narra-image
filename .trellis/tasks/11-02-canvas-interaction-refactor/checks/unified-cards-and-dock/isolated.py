"""Revision-2 entry point using the audited task isolation primitives."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("canvas_isolation_base", HERE.parent / "isolated_check.py")
assert spec and spec.loader
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)
checks.OWNER_KIND = "canvas-unified-cards-dock-v2"
PINNED_NODE = Path("C:/Users/Administrator/AppData/Local/Temp/narra-history-cleanup-20261029/node-v24.22.1-win-x64/node.exe")

base_files = checks.source_files
base_environment = checks.clean_environment


def revision_files(project=checks.PROJECT):
    # Include authored task tools in lint, not historical machine/browser receipts.
    return [file for file in base_files(project)
            if not (file.is_relative_to(project / ".trellis/tasks")
                    and "evidence" in file.relative_to(project).parts)]


def environment(workspace, lane, node):
    env = base_environment(workspace, lane, node)
    if lane == "build":
        installed = workspace / "node_modules/next/dist/server/config-shared.js"
        if installed.exists():
            formula = installed.read_text(encoding="utf-8")
            if "Number(process.env.CIRCLE_NODE_TOTAL)" not in formula:
                raise ValueError("Re-audit installed Next worker configuration before bounding concurrency")
        env["CIRCLE_NODE_TOTAL"] = "3"
    return env


checks.source_files = revision_files
checks.clean_environment = environment

if __name__ == "__main__":
    if "--node" not in sys.argv:
        sys.argv[1:1] = ["--node", str(PINNED_NODE)]
    raise SystemExit(checks.main())
