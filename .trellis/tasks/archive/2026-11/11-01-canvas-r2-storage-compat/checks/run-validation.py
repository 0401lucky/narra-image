"""Task-local validation against a source copy, without live service settings."""

import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


CHECKS = Path(__file__).resolve().parent
ROOT = next(parent for parent in CHECKS.parents if (parent / "package.json").is_file() and (parent / "contracts/canvas/v1").is_dir())
OWNER = json.loads((CHECKS / "verification-workspace.json").read_text(encoding="utf-8"))
APP = Path(OWNER["workspace"]).resolve()
RUNTIME = APP.parent
NODE = Path(OWNER["node"])
GO = Path("C:/Program Files/Go/bin/go.exe")
REFERENCE = ROOT / ".trellis/tasks/archive/2026-11/10-30-homepage-warm-editorial-redesign/checks"
assert APP.name == "app" and RUNTIME.parent == Path("D:/code/_tmp").resolve()
assert RUNTIME.name.startswith("narra-canvas-r2-verify-")
assert json.loads((RUNTIME / "owner.json").read_text(encoding="utf-8"))["token"] == OWNER["token"]


def capture():
    spec = importlib.util.spec_from_file_location("existing_capture", REFERENCE / "isolated_check.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    helper.SOURCE_FILES = (*helper.SOURCE_FILES, ".gitattributes")
    report = helper.capture_source(APP, project=ROOT)
    label = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    (RUNTIME / f"source-capture-{label}.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    shutil.copy2(REFERENCE / "deny_env.cjs", RUNTIME / "tools/deny_env.cjs")
    print(json.dumps({"captured_files": len(report["files"]), "workspace": str(APP)}), flush=True)


def environment(stage):
    system_keys = {
        "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "SYSTEMDRIVE", "TEMP", "TMP",
        "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "HOME",
        "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "GOCACHE", "GOMODCACHE", "GOPATH",
    }
    env = {key: value for key, value in os.environ.items() if key.upper() in system_keys}
    env["PATH"] = os.pathsep.join([str(NODE.parent), str(GO.parent), env.get("PATH", "")])
    guarded_root = ROOT if stage == "lint" else APP
    env.update({
        "CI": "1", "NODE_ENV": "production" if stage in {"prisma", "build"} else "test",
        "AUTH_SECRET": "canvas-r2-validation-only-no-live-identity-20261101",
        "DATABASE_URL": "postgresql://canvas_fake:canvas_fake@127.0.0.1:1/canvas_never_connect",
        "NEXT_TELEMETRY_DISABLED": "1", "PRISMA_HIDE_UPDATE_MESSAGE": "1", "NO_COLOR": "1",
        "AWS_CONFIG_FILE": str(RUNTIME / "empty-aws-config"),
        "AWS_SHARED_CREDENTIALS_FILE": str(RUNTIME / "empty-aws-config"),
        "AWS_EC2_METADATA_DISABLED": "true", "AWS_SDK_LOAD_CONFIG": "false",
        "npm_config_userconfig": str(RUNTIME / "empty-aws-config"),
        "npm_config_globalconfig": str(RUNTIME / "empty-aws-config"),
        "NARRA_CHECK_ROOT": str(guarded_root),
        "NARRA_CHECK_PUBLIC_ENV_SHA256": hashlib.sha256((guarded_root / ".env.example").read_bytes()).hexdigest(),
        "NODE_OPTIONS": f'--require "{(RUNTIME / "tools/deny_env.cjs").as_posix()}"',
    })
    if stage in {"prisma", "build"}:
        env["APP_URL"] = "https://canvas-validation.invalid"
    return env


def run(stage, extra):
    stages = {
        "prisma": ([str(NODE), "node_modules/prisma/build/index.js", "generate"], 120),
        "types": ([str(NODE), "node_modules/typescript/bin/tsc", "--noEmit"], 180),
        "lint": ([str(NODE), str(APP / "node_modules/eslint/bin/eslint.js"), "."], 180),
        "test": ([str(NODE), "node_modules/vitest/vitest.mjs", "run", "--reporter=dot", "--testTimeout=30000", "--maxWorkers=2"], 360),
        "build": ([str(NODE), "node_modules/next/dist/bin/next", "build"], 600),
        "go-test": ([str(GO), "-C", "worker", "test", "-count=1", "-timeout=90s", "./..."], 180),
        "go-vet": ([str(GO), "-C", "worker", "vet", "./..."], 180),
        "go-build": ([str(GO), "-C", "worker", "build", "./..."], 180),
    }
    command, deadline = stages[stage]
    if extra:
        assert stage == "test", "Only the test stage accepts explicit target files"
        command.extend(extra)
    label = stage + "-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    start = time.monotonic()
    env = environment(stage)
    cwd = ROOT if stage == "lint" else APP
    process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=deadline)
    except subprocess.TimeoutExpired:
        timed_out = True
        subprocess.run([str(Path(env.get("SYSTEMROOT", "C:/Windows")) / "System32/taskkill.exe"),
                        "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=15, env=env)
        stdout, stderr = process.communicate(timeout=15)
    code = 124 if timed_out else process.returncode
    (CHECKS / f"{label}.stdout.log").write_bytes(stdout)
    (CHECKS / f"{label}.stderr.log").write_bytes(stderr)
    report = {"stage": stage, "command": command, "cwd": str(cwd), "exit_code": code,
              "seconds": round(time.monotonic() - start, 3), "timeout_seconds": deadline,
              "dotenv_guard": True, "source_capture": str(max(RUNTIME.glob("source-capture*.json"), key=lambda path: path.stat().st_mtime_ns))}
    (CHECKS / f"{label}.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report), flush=True)
    print(stdout.decode("utf-8", "replace")[-5000:], flush=True)
    if stderr:
        print(stderr.decode("utf-8", "replace")[-3000:], flush=True)
    return code


if __name__ == "__main__":
    if sys.argv[1] == "capture":
        capture()
    else:
        sys.exit(run(sys.argv[1], sys.argv[2:]))
