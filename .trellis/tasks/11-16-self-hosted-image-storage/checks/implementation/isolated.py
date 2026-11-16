"""Reuse the audited isolation launcher with task-local paths and current Node."""

import importlib.util
from pathlib import Path

CHECKS = Path(__file__).resolve().parent
PROJECT = CHECKS.parents[4]
SOURCE = PROJECT / ".trellis/tasks/11-04-ghcr-image-release/checks/isolation_base.py"
spec = importlib.util.spec_from_file_location("narra_previous_isolation", SOURCE)
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)
checks.CHECKS = CHECKS
checks.PROJECT = PROJECT
checks.RUNTIME = CHECKS / ".runtime"
checks.OWNER_KIND = "self-hosted-image-storage-implementation-v1"
checks.STAGES["test"] = ("node_modules/vitest/vitest.mjs", ["run", "--testTimeout=30000", "--maxWorkers=2"], "test", 57)
checks.STAGES["worker-ts"] = ("scripts/verify-worker-contracts.mjs", ["ts"], "test", 65)
checks.SOURCE_DIRECTORIES = (
    "src", "public", "prisma", "contracts", "scripts", "worker", "docs", ".github",
    ".trellis/tasks/11-16-self-hosted-image-storage",
)

if __name__ == "__main__":
    raise SystemExit(checks.main())
