"""Task-local validation using copied dependencies and a credential-deny process."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys

import isolation_base as checks


TOOLCHAIN = checks.RUNTIME / "toolchain"
NODE = TOOLCHAIN / "node-v24.22.1-win-x64/node.exe"
GO = TOOLCHAIN / "go/bin/go.exe"
PNPM_SOURCE = checks.PROJECT / ".trellis/tasks/11-04-ghcr-image-release/checks/.runtime/release-integration-5781d68e/tools/pnpm"
DOCKER = Path("C:/Users/Administrator/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe")
DOCKER_HOST = "npipe:////./pipe/dockerDesktopLinuxEngine"
original_environment = checks.clean_environment
original_source_files = checks.source_files
checks.STAGES["node-tests"] = (None, ["--test"], "test", 180)
checks.STAGES["next-types"] = (".trellis/tasks/11-12-image-storage-foundation/checks/next-types.mjs", [], "build", 180)


def source_files(project=checks.PROJECT):
    return [path for path in original_source_files(project)
            if not (path.is_relative_to(project / ".trellis/tasks")
                    and "evidence" in path.relative_to(project).parts)]


def environment(workspace, lane, node):
    env = original_environment(workspace, lane, node)
    owner_root, _ = checks.validate_workspace(workspace)
    if lane == "test":
        env.pop("AUTH_SECRET", None)
        env.pop("DATABASE_URL", None)
        env["NODE_OPTIONS"] += " --max-semi-space-size=4"
    if lane == "build":
        config = workspace / "node_modules/next/dist/server/config-shared.js"
        if config.exists() and "Number(process.env.CIRCLE_NODE_TOTAL)" not in config.read_text(encoding="utf-8"):
            raise ValueError("Re-audit the installed Next local build concurrency setting")
        env["CIRCLE_NODE_TOTAL"] = "2"
        env["NODE_OPTIONS"] += " --max-old-space-size=1536 --max-semi-space-size=4"
    paths = [str(owner_root / "tools"), str(GO.parent)]
    if DOCKER.is_file():
        paths.append(str(DOCKER.parent))
        env["DOCKER_HOST"] = DOCKER_HOST
    paths.append(env["PATH"])
    env["PATH"] = os.pathsep.join(paths)
    env.update({
        "GOENV": "off", "GOTOOLCHAIN": "local", "GOWORK": "off",
        "GOCACHE": str(TOOLCHAIN / "go-build-cache"),
        "GOMODCACHE": str(TOOLCHAIN / "go-mod-cache"),
        "GOPATH": str(owner_root / "home/go"),
        "GOPROXY": "https://proxy.golang.org,direct", "GOSUMDB": "sum.golang.org",
    })
    return env


checks.clean_environment = environment
checks.source_files = source_files


def install_workspace_tools(workspace):
    owner_root, _ = checks.validate_workspace(workspace)
    destination = owner_root / "tools/pnpm"
    package = PNPM_SOURCE / "package.json"
    if not package.is_file() or json.loads(package.read_text(encoding="utf-8")).get("version") != "10.32.1":
        raise ValueError("Previously installed pnpm10.32.1 is required")
    if not destination.exists():
        shutil.copytree(PNPM_SOURCE, destination)
    checks.audit_dependencies(destination)
    (owner_root / "tools/pnpm.cmd").write_text(
        '@"' + str(NODE) + '" "%~dp0pnpm\\bin\\pnpm.cjs" %*\n', encoding="utf-8")


def fixed_stage(workspace, stage, targets):
    owner_root, _ = checks.validate_workspace(workspace)
    if stage in checks.STAGES:
        return checks.run_stage(workspace, stage, NODE, targets)
    if targets:
        raise ValueError("Additional targets are allowed only for focused unit-test stages")
    commands = {
        "ci": ([str(NODE), str(workspace / "scripts/verify-ci.mjs")], 1500),
        "ci-bounded": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/ci-bounded.mjs")], 1500),
        "worker-db": ([str(NODE), str(workspace / "scripts/verify-worker-contracts.mjs"), "db"], 900),
        "canvas-db": ([str(NODE), str(workspace / "scripts/verify-canvas-contracts-db.mjs")], 450),
        "gateway-db": ([str(NODE), str(workspace / "scripts/verify-gateway.mjs"), "db"], 900),
        "migrations": ([str(NODE), str(workspace / "scripts/verify-migrations.mjs")], 1200),
        "e2e": ([str(NODE), str(workspace / "scripts/verify-e2e.mjs")], 2460),
        "history-topologies": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-history-migration/checks/topologies.mjs")], 2460),
        "history-integrated-e2e": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-history-migration/checks/integrated-e2e.mjs")], 2460),
        "history-linux-tests": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-history-migration/checks/linux-history-tests.mjs")], 280),
        "go-tests": ([str(GO), "-C", "worker", "test", "-count=1", "-timeout=50s", "./..."], 120),
        "history-go-tests": ([str(GO), "-C", "worker", "test", "-count=1", "-timeout=50s", "-run", "TestImageHistory|TestImageMaintenance", "./internal/worker", "./cmd/image-history"], 180),
        "go-vet": ([str(GO), "-C", "worker", "vet", "./..."], 120),
        "go-build": ([str(GO), "-C", "worker", "build", "./..."], 180),
        "previous-worker-linux": ([str(GO), "-C", "worker", "build", "-trimpath", "-o", str(owner_root / "c2-worker-linux"), "./cmd/worker"], 300),
        "media-db-smoke": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/media-db-smoke.mjs")], 450),
        "media-canvas-db-smoke": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/media-db-smoke.mjs"), "--canvas"], 450),
        "schema-diff": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/media-db-smoke.mjs"), "--schema-diff"], 450),
        "retention-catalog": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/media-db-smoke.mjs"), "--latest", "--canvas", "--catalog-only"], 450),
        "retention-schema": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/media-db-smoke.mjs"), "--latest", "--schema-diff", "--catalog-only"], 450),
        "history-catalog": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/media-db-smoke.mjs"), "--latest", "--canvas", "--catalog-only"], 450),
        "history-schema": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/media-db-smoke.mjs"), "--latest", "--schema-diff", "--catalog-only"], 450),
        "local-crossprocess": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/local-crossprocess.mjs")], 360),
        "local-http": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/local-http.mjs")], 550),
        "retention-http": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-storage-foundation/checks/local-http.mjs"), "--retention"], 550),
        "linux-next-build": ([str(NODE), str(workspace / ".trellis/tasks/11-12-image-retention-management/checks/linux-next-build.mjs")], 1560),
        "go-local-io": ([str(GO), "-C", "worker", "test", "-count=1", "-timeout=50s",
                         "internal/worker/image_contract.go", "internal/worker/canvas_storage_location.go", "internal/worker/image_local_store.go",
                         "internal/worker/image_local_store_test.go"], 180),
    }
    if stage not in commands:
        raise ValueError("Unknown fixed validation stage")
    command, timeout = commands[stage]
    if not Path(command[0]).is_file():
        raise ValueError("Prepared toolchain executable is missing")
    with checks.workspace_lock(workspace):
        checks.audit_dependencies(workspace / "node_modules")
        manifest = json.loads((owner_root / "source-manifest.json").read_text(encoding="utf-8"))
        before = checks.source_state(workspace, list(manifest["files"]))
        env = environment(workspace, "test", NODE)
        if stage == "previous-worker-linux":
            if (owner_root / "c2-worker-linux").exists():
                raise ValueError("Preserved C2 Worker already exists; cannot overwrite the old-revision evidence")
            env.update({"GOOS": "linux", "GOARCH": "amd64", "CGO_ENABLED": "0"})
        report = checks.run_bounded(workspace, command, env, timeout, stage)
        after = checks.source_state(workspace, list(manifest["files"]))
        report.update({
            "sourceBefore": before, "sourceAfter": after,
            "sourceChanges": [name for name in before if before[name] != after[name]],
            "sourceManifest": str(owner_root / "source-manifest.json"),
            "snapshotModifications": [name for name, item in manifest["files"].items() if before[name] != item["sha256"]],
        })
        checks.audit_dependencies(workspace / "node_modules")
        checks.write_json(owner_root / "receipts" / (report["id"] + ".json"), report)
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "refresh", "run"])
    parser.add_argument("--label", default="images")
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--stage")
    parser.add_argument("targets", nargs="*")
    args = parser.parse_intermixed_args()
    checks.node_executable(str(NODE))
    if args.command == "prepare":
        workspace, report = checks.prepare_workspace(args.label, NODE)
        install_workspace_tools(workspace)
    elif args.workspace is None:
        raise ValueError("A task-owned --workspace is required")
    elif args.command == "refresh":
        report = checks.refresh_workspace(args.workspace.resolve())
    else:
        report = fixed_stage(args.workspace.resolve(), args.stage, args.targets)
    print(json.dumps({key: value for key, value in report.items() if key not in {"sourceBefore", "sourceAfter"}}, ensure_ascii=False, indent=2))
    return report.get("exitCode", 0)


if __name__ == "__main__":
    raise SystemExit(main())
