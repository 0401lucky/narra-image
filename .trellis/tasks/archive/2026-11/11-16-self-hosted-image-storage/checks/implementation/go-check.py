"""Bounded Go checks without inherited deployment configuration."""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

CHECKS = Path(__file__).resolve().parent
PROJECT = CHECKS.parents[4]
STAGES = {
    "opt-in-before": ["test", "-count=1", "-timeout=50s", "-run", "TestPersistImageProductionDatabaseStorage|TestPersistImageFromURLProductionDatabaseStorage|TestNormalizeGeneratedImageProductionDatabaseStorage", "./internal/worker"],
    "go-test": ["test", "-count=1", "-timeout=50s", "./internal/worker/..."],
    "go-vet": ["vet", "./..."],
    "go-build": ["build", "./..."],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=STAGES)
    stage = parser.parse_args().stage
    go = Path(shutil.which("go") or "__missing_go__").resolve()
    if not go.is_file():
        raise ValueError("Installed Go executable required")
    keep = {"SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "SYSTEMDRIVE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "TEMP", "TMP"}
    env = {k: v for k, v in os.environ.items() if k.upper() in keep}
    user = Path(os.environ["USERPROFILE"])
    windows = Path(os.environ["SystemRoot"])
    env.update(
        PATH=os.pathsep.join([str(go.parent), str(windows / "System32"), str(windows)]),
        GOENV="off", GOPROXY="off", GOMODCACHE=str(user / "go/pkg/mod"),
        GOCACHE=str(Path(os.environ["LOCALAPPDATA"]) / "go-build"),
    )
    command = [str(go), "-C", "worker", *STAGES[stage]]
    label = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + stage
    start = time.monotonic()
    timed_out = False
    try:
        result = subprocess.run(command, cwd=PROJECT, env=env, capture_output=True, timeout=60)
        code, stdout, stderr = result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired as error:
        code, stdout, stderr, timed_out = 124, error.stdout or b"", error.stderr or b"", True
    stdout_path, stderr_path = CHECKS / (label + ".stdout.log"), CHECKS / (label + ".stderr.log")
    stdout_path.write_bytes(stdout)
    stderr_path.write_bytes(stderr)
    report = {
        "command": command, "cwd": str(PROJECT), "exitCode": code,
        "durationSeconds": round(time.monotonic() - start, 3), "timeoutSeconds": 60,
        "timedOut": timed_out, "stdout": str(stdout_path), "stderr": str(stderr_path),
        "configuration": "OS allowlist; GOENV/GOPROXY off; no database/provider settings",
    }
    (CHECKS / (label + ".json")).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))
    if code:
        print(json.dumps({"stdoutTail": stdout.decode("utf-8", errors="replace")[-4500:], "stderrTail": stderr.decode("utf-8", errors="replace")[-1000:]}))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
