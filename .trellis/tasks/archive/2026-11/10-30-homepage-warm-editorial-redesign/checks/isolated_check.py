"""Task-only credential-free launcher; never run Node before cleaning its environment."""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import time


CHECKS = Path(__file__).resolve().parent
PROJECT = CHECKS.parents[3]
RUNTIME = CHECKS / ".runtime"
OWNER_KIND = "homepage-warm-editorial-redesign-g0-v1"
SOURCE_DIRECTORIES = ("src", "public", "prisma", "contracts", "scripts", "worker", ".github")
SOURCE_FILES = (
    ".dockerignore", ".env.example", ".gitignore", "Dockerfile", "LICENSE", "README.md",
    "THIRD_PARTY_NOTICES.md", "docker-compose.yml", "docker-compose.e2e.yml", "package.json",
    "pnpm-lock.yaml", "tsconfig.json", "next-env.d.ts", "next.config.ts", "postcss.config.mjs",
    "eslint.config.mjs", "prisma.config.ts", "vitest.config.ts",
)
EXCLUDED_NAMES = {
    ".git", ".trellis", ".agents", ".codex", ".claude", ".pi", ".serena", ".worktrees",
    "node_modules", ".next", ".cache", ".vite", ".vite-temp", "__pycache__", "coverage",
    ".npmrc", ".yarnrc", ".yarnrc.yml", ".pypirc", ".netrc", "credentials", "AGENTS.md",
}
SYSTEM_KEYS = {
    "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "SYSTEMDRIVE", "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS",
}
STAGES = {
    "test": ("node_modules/vitest/vitest.mjs", ["run", "--testTimeout=30000"], "test", 300),
    "lint": ("node_modules/eslint/bin/eslint.js", ["."], "test", 180),
    "types": ("node_modules/typescript/bin/tsc", ["--noEmit"], "test", 180),
    "prisma": ("node_modules/prisma/build/index.js", ["generate"], "build", 120),
    "build": ("node_modules/next/dist/bin/next", ["build"], "build", 600),
}


def timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def native_path(path: Path) -> str:
    absolute = os.path.abspath(path)
    if os.name != "nt" or absolute.startswith("\\\\?\\"):
        return absolute
    if absolute.startswith("\\\\"):
        return "\\\\?\\UNC\\" + absolute[2:]
    return "\\\\?\\" + absolute


def is_link(path: Path) -> bool:
    path = Path(native_path(path))
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def canonical(path: Path) -> Path:
    resolved = os.path.realpath(native_path(path))
    if resolved.startswith("\\\\?\\UNC\\"):
        resolved = "\\\\" + resolved[8:]
    elif resolved.startswith("\\\\?\\"):
        resolved = resolved[4:]
    return Path(resolved)


def within(path: Path, parent: Path, *, allow_same: bool = False) -> bool:
    absolute = canonical(path)
    base = canonical(parent)
    return (allow_same or absolute != base) and absolute.is_relative_to(base)


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def node_executable(override: str | None = None) -> Path:
    node = Path(override or shutil.which("node") or "__node_missing__").resolve()
    if not node.is_file() or node.name.lower() not in {"node", "node.exe"}:
        raise ValueError("An explicitly installed Node executable is required; no download fallback")
    return node


def os_environment(node: Path, home: Path, temp: Path) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key.upper() in SYSTEM_KEYS}
    system_root = Path(env.get("SystemRoot", env.get("SYSTEMROOT", "C:/Windows")))
    path_parts = [str(node.parent)]
    if os.name == "nt":
        path_parts.extend([str(system_root / "System32"), str(system_root)])
    else:
        path_parts.extend(["/usr/bin", "/bin"])
    env.update({
        "PATH": os.pathsep.join(path_parts), "HOME": str(home), "USERPROFILE": str(home),
        "APPDATA": str(home / "AppData/Roaming"), "LOCALAPPDATA": str(home / "AppData/Local"),
        "TEMP": str(temp), "TMP": str(temp), "TMPDIR": str(temp),
        "XDG_CONFIG_HOME": str(home / ".config"), "XDG_CACHE_HOME": str(home / ".cache"),
        "npm_config_userconfig": str(home / "empty.npmrc"),
        "npm_config_cache": str(home / "npm-cache"), "COREPACK_HOME": str(home / "corepack"),
        "NEXT_TELEMETRY_DISABLED": "1", "PRISMA_HIDE_UPDATE_MESSAGE": "1", "NO_COLOR": "1",
    })
    if os.name == "nt":
        env["HOMEDRIVE"] = home.drive
        env["HOMEPATH"] = str(home)[len(home.drive):]
    return env


def validate_workspace(workspace: Path) -> tuple[Path, dict]:
    workspace = Path(os.path.abspath(workspace))
    if is_link(workspace) or workspace.name != "app" or not within(workspace, RUNTIME):
        raise ValueError("Workspace must be a non-linked app beneath this task's .runtime")
    owner_root = workspace.parent
    if is_link(owner_root) or owner_root.parent != RUNTIME or owner_root.resolve() != owner_root:
        raise ValueError("Workspace owner path is not a direct, real task runtime child")
    owner = json.loads((owner_root / "owner.json").read_text(encoding="utf-8"))
    if owner.get("kind") != OWNER_KIND or owner.get("workspace") != str(workspace):
        raise ValueError("Workspace owner marker mismatch")
    if not re.fullmatch(r"[a-f0-9]{24}", owner.get("token", "")):
        raise ValueError("Workspace token is invalid")
    return owner_root, owner


def clean_environment(workspace: Path, lane: str, node: Path) -> dict[str, str]:
    owner_root, _ = validate_workspace(workspace)
    if lane not in {"test", "build", "browser"}:
        raise ValueError("Unknown environment lane")
    home, temp = owner_root / "home", owner_root / "temp"
    env = os_environment(node, home, temp)
    example = workspace / ".env.example"
    if is_link(example) or not example.is_file() or example.resolve() != example:
        raise ValueError("Only the exact copied regular public .env.example may be readable")
    env.update({
        "NODE_ENV": "test" if lane == "test" else "production",
        "AUTH_SECRET": "homepage-check-only-no-live-identity-4c81b1a68a0f",
        "DATABASE_URL": "postgresql://homepage_fake:homepage_fake@127.0.0.1:1/homepage_never_connect",
        "NARRA_CHECK_ROOT": str(workspace), "NARRA_CHECK_OWNER_ROOT": str(owner_root),
        "NARRA_CHECK_PUBLIC_ENV_SHA256": digest(example),
        "NODE_OPTIONS": f'--require "{(owner_root / "tools/deny_env.cjs").as_posix()}"',
    })
    if lane != "test":
        env["APP_URL"] = "https://homepage-validation.invalid"
    return env


def excluded(name: str) -> bool:
    lowered = name.lower()
    return name in EXCLUDED_NAMES or lowered == ".env" or lowered.startswith(".env.") \
        or lowered.endswith((".pem", ".key", ".pfx", ".p12", ".tsbuildinfo"))


def source_files(project: Path = PROJECT) -> list[Path]:
    result = []
    for name in SOURCE_FILES:
        item = project / name
        if item.exists():
            if is_link(item) or not item.is_file():
                raise ValueError(f"Expected a regular public source file: {name}")
            result.append(item)
    for name in SOURCE_DIRECTORIES:
        directory = project / name
        if not directory.exists():
            continue
        if is_link(directory):
            raise ValueError(f"Source directory is unexpectedly linked: {name}")
        for current, dirs, files in os.walk(directory, followlinks=False):
            for child in dirs[:]:
                target = Path(current) / child
                if excluded(child):
                    dirs.remove(child)
                elif is_link(target):
                    raise ValueError(f"Linked source directory is not allowed: {target.relative_to(project)}")
            for child in files:
                if excluded(child):
                    continue
                target = Path(current) / child
                if is_link(target):
                    raise ValueError(f"Linked source file is not allowed: {target.relative_to(project)}")
                result.append(target)
    return sorted(result)


def capture_source(workspace: Path, *, project: Path = PROJECT) -> dict:
    records = {}
    for source in source_files(project):
        relative = source.relative_to(project)
        destination = workspace / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        source_hash = digest(source)
        if digest(destination) != source_hash:
            raise ValueError(f"Source changed during snapshot: {relative}")
        records[relative.as_posix()] = {"sha256": source_hash, "bytes": source.stat().st_size}
    return {"capturedAt": timestamp(), "sourceRoot": str(project), "files": records}


def copy_dependencies(source: Path, destination: Path) -> dict:
    if not source.is_dir() or is_link(source):
        raise ValueError("Installed node_modules must be a real directory")
    Path(native_path(destination)).mkdir(exist_ok=True)
    links = []
    file_count = 0
    byte_count = 0
    walk_root = Path(native_path(source))
    for current, dirs, files in os.walk(walk_root, followlinks=False):
        relative = Path(current).relative_to(walk_root)
        Path(native_path(destination / relative)).mkdir(parents=True, exist_ok=True)
        for name in dirs[:]:
            item = Path(current) / name
            if name in {".cache", ".vite", ".vite-temp"}:
                dirs.remove(name)
            elif is_link(item):
                resolved = canonical(item)
                if not within(resolved, source):
                    raise ValueError(f"Dependency link escapes installed node_modules: {item}")
                links.append((item.relative_to(walk_root), resolved.relative_to(source), True))
                dirs.remove(name)
        for name in files:
            if name.lower() == ".env" or name.lower().startswith(".env.") or name in {".npmrc", ".yarnrc", ".yarnrc.yml"}:
                continue
            item = Path(current) / name
            if is_link(item):
                resolved = canonical(item)
                if not within(resolved, source):
                    raise ValueError(f"Dependency file link escapes installed node_modules: {item}")
                links.append((item.relative_to(walk_root), resolved.relative_to(source), False))
            else:
                try:
                    shutil.copy2(native_path(item), native_path(destination / relative / name))
                except OSError as error:
                    raise ValueError(f"Dependency copy failed: {item} -> {destination / relative / name}: {error}") from error
                file_count += 1
                byte_count += item.stat().st_size
    for relative, target_relative, directory in links:
        target = destination / target_relative
        link = destination / relative
        if not Path(native_path(target)).exists():
            raise ValueError(f"Copied dependency link target missing: {target_relative}")
        if os.name == "nt" and directory:
            import _winapi
            _winapi.CreateJunction(str(target), native_path(link))
        else:
            os.symlink(target, link, target_is_directory=directory)
    audit_dependencies(destination)
    return {"regularFiles": file_count, "bytes": byte_count, "internalLinks": len(links), "source": str(source)}


def audit_dependencies(directory: Path) -> None:
    if not directory.is_dir() or is_link(directory):
        raise ValueError("Copied dependency root must be a real directory")
    for current, dirs, files in os.walk(native_path(directory), followlinks=False):
        for name in dirs[:]:
            item = Path(current) / name
            if is_link(item):
                if not within(item, directory):
                    raise ValueError(f"Copied dependency link escapes workspace: {item}")
                dirs.remove(name)
        for name in files:
            item = Path(current) / name
            if is_link(item) and not within(item, directory):
                raise ValueError(f"Copied dependency file link escapes workspace: {item}")


def prepare_workspace(label: str, node: Path, *, copy_modules: bool = True) -> tuple[Path, dict]:
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,35}", label):
        raise ValueError("Use a short lowercase label without path separators")
    RUNTIME.mkdir(exist_ok=True)
    if is_link(RUNTIME) or RUNTIME.resolve() != RUNTIME:
        raise ValueError("Runtime root may not be a reparse point")
    token = secrets.token_hex(12)
    owner_root = RUNTIME / f"{label}-{token[:8]}"
    owner_root.mkdir()
    workspace = owner_root / "app"
    workspace.mkdir()
    owner = {"kind": OWNER_KIND, "token": token, "workspace": str(workspace), "createdAt": timestamp(), "node": str(node)}
    write_json(owner_root / "owner.json", owner)
    for name in ["home", "home/AppData/Roaming", "home/AppData/Local", "temp", "tools", "receipts"]:
        (owner_root / name).mkdir(parents=True, exist_ok=True)
    (owner_root / "home/empty.npmrc").write_text("", encoding="utf-8")
    shutil.copy2(CHECKS / "deny_env.cjs", owner_root / "tools/deny_env.cjs")
    manifest = capture_source(workspace)
    write_json(owner_root / "source-manifest.json", manifest)
    print(f"[homepage-check] Copied {len(manifest['files'])} source files; copying installed dependencies", file=sys.stderr, flush=True)
    if copy_modules:
        dependency_report = copy_dependencies(PROJECT / "node_modules", workspace / "node_modules")
        write_json(owner_root / "dependencies.json", dependency_report)
    probe = subprocess.run([str(node), "--version"], env=clean_environment(workspace, "test", node), cwd=workspace,
                           text=True, capture_output=True, timeout=10, **hidden_process_options())
    if probe.returncode != 0:
        raise ValueError(f"Installed Node probe failed: {probe.stderr}")
    report = {**owner, "sourceFiles": len(manifest["files"]), "nodeVersion": probe.stdout.strip(),
              "requiredNodeVersion": "v24.22.1", "pinnedRuntimeParity": probe.stdout.strip() == "v24.22.1"}
    write_json(owner_root / "preparation.json", report)
    return workspace, report


def hidden_process_options() -> dict:
    return {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}


@contextlib.contextmanager
def workspace_lock(workspace: Path):
    owner_root, _ = validate_workspace(workspace)
    lock = owner_root / "active.lock"
    with lock.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps({"pid": os.getpid(), "startedAt": timestamp()}))
    try:
        yield
    finally:
        lock.unlink()


def source_state(workspace: Path, paths: list[str]) -> dict:
    return {name: digest(workspace / name) if (workspace / name).is_file() else None for name in paths}


def terminate_tree(process: subprocess.Popen, env: dict[str, str]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        system_root = Path(env.get("SystemRoot", env.get("SYSTEMROOT", "C:/Windows")))
        subprocess.run([str(system_root / "System32/taskkill.exe"), "/PID", str(process.pid), "/T", "/F"],
                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
                       **hidden_process_options())
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=2)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def run_bounded(workspace: Path, command: list[str], env: dict[str, str], timeout_seconds: int,
                label: str) -> dict:
    owner_root, _ = validate_workspace(workspace)
    if not 0 < timeout_seconds <= 1800:
        raise ValueError("Checks require a finite deadline of at most 1800 seconds")
    receipt_id = f"{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S')}-{label}-{secrets.token_hex(3)}"
    receipt_root = owner_root / "receipts"
    stdout_path = receipt_root / f"{receipt_id}.stdout.log"
    stderr_path = receipt_root / f"{receipt_id}.stderr.log"
    started = time.monotonic()
    timed_out = False
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        process = subprocess.Popen(command, cwd=workspace, env=env, stdin=subprocess.DEVNULL,
                                   stdout=stdout, stderr=stderr, **hidden_process_options())
        try:
            code = process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            timed_out = True
            terminate_tree(process, env)
            process.wait(timeout=15)
            code = 124
        except BaseException:
            terminate_tree(process, env)
            raise
    report = {"id": receipt_id, "command": command, "cwd": str(workspace), "finishedAt": timestamp(),
              "exitCode": code, "timedOut": timed_out, "timeoutSeconds": timeout_seconds,
              "durationSeconds": round(time.monotonic() - started, 3),
              "stdout": str(stdout_path), "stderr": str(stderr_path),
              "environmentKeys": sorted(env), "nodeEnv": env.get("NODE_ENV"),
              "buildOnlyAppUrl": env.get("APP_URL"), "inheritedCallerConfiguration": False}
    write_json(receipt_root / f"{receipt_id}.json", report)
    return report


def run_stage(workspace: Path, stage: str, node: Path, targets: list[str]) -> dict:
    owner_root, _ = validate_workspace(workspace)
    if stage not in STAGES:
        raise ValueError("Unknown fixed validation stage")
    if targets and stage != "test":
        raise ValueError("Only the focused test stage accepts additional file targets")
    for target in targets:
        if not re.fullmatch(r"src/tests/[A-Za-z0-9_./{}-]+\.test\.tsx?", target) or ".." in Path(target).parts:
            raise ValueError(f"Only exact repository test file targets are allowed: {target}")
        if not (workspace / target).is_file():
            raise ValueError(f"Missing requested test file: {target}")
    entry, args, lane, deadline = STAGES[stage]
    if not (workspace / entry).is_file():
        raise ValueError(f"Installed stage entry is missing: {entry}")
    with workspace_lock(workspace):
        audit_dependencies(workspace / "node_modules")
        manifest = json.loads((owner_root / "source-manifest.json").read_text(encoding="utf-8"))
        before = source_state(workspace, list(manifest["files"]))
        command = [str(node), str(workspace / entry), *args, *targets]
        report = run_bounded(workspace, command, clean_environment(workspace, lane, node), deadline, stage)
        after = source_state(workspace, list(manifest["files"]))
        report["sourceBefore"] = before
        report["sourceAfter"] = after
        report["sourceChanges"] = [name for name in before if before[name] != after[name]]
        report["snapshotModifications"] = [name for name, item in manifest["files"].items() if before[name] != item["sha256"]]
        report["sourceManifest"] = str(owner_root / "source-manifest.json")
        audit_dependencies(workspace / "node_modules")
        write_json(owner_root / "receipts" / f"{report['id']}.json", report)
        return report


def refresh_workspace(workspace: Path) -> dict:
    owner_root, _ = validate_workspace(workspace)
    with workspace_lock(workspace):
        old = json.loads((owner_root / "source-manifest.json").read_text(encoding="utf-8"))
        current = source_state(workspace, list(old["files"]))
        modified = [name for name in old["files"] if current[name] != old["files"][name]["sha256"] and name != "next-env.d.ts"]
        if modified:
            raise ValueError(f"Refusing to overwrite fixture/other snapshot modifications: {modified[:8]}")
        new = capture_source(workspace)
        for name in old["files"].keys() - new["files"].keys():
            target = workspace / name
            if not within(target, workspace) or is_link(target):
                raise ValueError("Refusing to remove an escaped former snapshot input")
            target.unlink(missing_ok=True)
        write_json(owner_root / "source-manifest.json", new)
        return {"workspace": str(workspace), "sourceFiles": len(new["files"]), "capturedAt": new["capturedAt"]}


def cleanup_workspace(workspace: Path) -> None:
    owner_root, _ = validate_workspace(workspace)
    if (owner_root / "active.lock").exists():
        raise ValueError("Refusing cleanup while an owned command is running")
    # Audit every reparse point before the one native Python recursive removal.
    for current, dirs, files in os.walk(owner_root, followlinks=False):
        for name in dirs[:]:
            target = Path(current) / name
            if is_link(target):
                if not within(target, owner_root):
                    raise ValueError("Refusing cleanup because a reparse point escapes the owner root")
                dirs.remove(name)
        for name in files:
            target = Path(current) / name
            if is_link(target) and not within(target, owner_root):
                raise ValueError("Refusing cleanup because a linked file escapes the owner root")
    if not within(owner_root, RUNTIME) or owner_root.parent != RUNTIME or is_link(owner_root):
        raise ValueError("Owner cleanup target failed its final absolute path check")
    shutil.rmtree(owner_root)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", help="Explicit installed Node executable; never installed automatically")
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--label", required=True)
    refresh = commands.add_parser("refresh")
    refresh.add_argument("--workspace", type=Path, required=True)
    run = commands.add_parser("run")
    run.add_argument("--workspace", type=Path, required=True)
    run.add_argument("--stage", choices=STAGES, required=True)
    run.add_argument("targets", nargs="*")
    script = commands.add_parser("script")
    script.add_argument("--workspace", type=Path, required=True)
    script.add_argument("--script", type=Path, required=True)
    script.add_argument("--lane", choices=["test", "build", "browser"], default="browser")
    script.add_argument("--timeout-seconds", type=int, required=True)
    script.add_argument("arguments", nargs=argparse.REMAINDER)
    cleanup = commands.add_parser("cleanup")
    cleanup.add_argument("--workspace", type=Path, required=True)
    options = parser.parse_args()
    node = node_executable(options.node)
    if options.command == "prepare":
        _, report = prepare_workspace(options.label, node)
    elif options.command == "refresh":
        report = refresh_workspace(options.workspace)
    elif options.command == "run":
        report = run_stage(options.workspace, options.stage, node, options.targets)
    elif options.command == "script":
        executable = options.script.resolve()
        if not within(executable, CHECKS) or within(executable, RUNTIME) or executable.suffix not in {".mjs", ".cjs"}:
            raise ValueError("Only a task-owned checked-in .mjs/.cjs helper is allowed")
        if not executable.is_file():
            raise ValueError("Task helper does not exist")
        with workspace_lock(options.workspace):
            arguments = options.arguments[1:] if options.arguments[:1] == ["--"] else options.arguments
            report = run_bounded(options.workspace, [str(node), str(executable), *arguments],
                                 clean_environment(options.workspace, options.lane, node),
                                 options.timeout_seconds, "script")
    else:
        cleanup_workspace(options.workspace)
        report = {"removed": str(options.workspace.parent)}
    print(json.dumps({key: value for key, value in report.items() if key not in {"sourceBefore", "sourceAfter"}}, ensure_ascii=False, indent=2))
    return report.get("exitCode", 0)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"[homepage-check] {error}", file=sys.stderr)
        raise SystemExit(2)
