"""Current-task launcher with clean startup and copied dependency ownership."""

import sys
from pathlib import Path

import isolation_base as checks

PINNED_NODE = Path("C:/Users/Administrator/AppData/Local/Temp/narra-history-cleanup-20261029/node-v24.22.1-win-x64/node.exe")
checks.STAGES["node-tests"] = (None, ["--test"], "test", 180)
original_files = checks.source_files
original_environment = checks.clean_environment


def source_files(project=checks.PROJECT):
    return [file for file in original_files(project)
            if not (file.is_relative_to(project / ".trellis/tasks") and "evidence" in file.relative_to(project).parts)]


def environment(workspace, lane, node):
    env = original_environment(workspace, lane, node)
    if lane == "build":
        config = workspace / "node_modules/next/dist/server/config-shared.js"
        if config.exists() and "Number(process.env.CIRCLE_NODE_TOTAL)" not in config.read_text(encoding="utf-8"):
            raise ValueError("Re-audit installed Next CPU setting before bounding local build concurrency")
        env["CIRCLE_NODE_TOTAL"] = "3"
    return env


checks.source_files = source_files
checks.clean_environment = environment

if __name__ == "__main__":
    if "--node" not in sys.argv:
        sys.argv[1:1] = ["--node", str(PINNED_NODE)]
    raise SystemExit(checks.main())
