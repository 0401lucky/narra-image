"""Build a candidate in owned scratch without modifying a production container."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time


ROOT = Path(__file__).resolve().parent
LABEL = "io.narra.database-image-storage.owner"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if ROOT.parent != Path("/tmp") or not re.fullmatch(r"narra-db-storage-[a-f0-9]{12}", ROOT.name) or ROOT.is_symlink():
        raise ValueError("Expected task-owned /tmp scratch")
    manifest = json.loads((ROOT / "manifest.json").read_text())
    if ROOT.name != "narra-db-storage-" + manifest["source_sha256"][:12]:
        raise ValueError("Source identity does not match scratch")
    for name, expected in manifest["source_files"].items():
        if digest(ROOT / "payload" / name) != expected:
            raise ValueError("Source digest mismatch")
    for name, info in manifest["binaries"].items():
        if digest(ROOT / name) != info["sha256"]:
            raise ValueError("Binary digest mismatch")

    config = ROOT / "docker-config"
    config.mkdir(mode=0o700, exist_ok=True)
    config_file = config / "config.json"
    if config_file.exists() and json.loads(config_file.read_text()) != {"auths": {}}:
        raise ValueError("Build Docker configuration must be empty")
    config_file.write_text('{"auths":{}}\n')
    env = {k: os.environ[k] for k in ("PATH", "HOME", "LANG") if k in os.environ}
    env.update({"DOCKER_BUILDKIT": "0"})
    docker = ["docker", "--host", "unix:///var/run/docker.sock", "--config", str(config)]

    def run(args: list[str], timeout: int = 60) -> str:
        return subprocess.check_output([*docker, *args], env=env, text=True, timeout=timeout)

    original = json.loads(run(["inspect", "narra-app"]))[0]
    base = json.loads(run(["image", "inspect", manifest["base_image"]]))[0]
    if original["Image"] != base["Id"] or base["Os"] != "linux" or base["Architecture"] != "amd64":
        raise ValueError("Production baseline/base platform changed")
    for name, expected in manifest["dependency_hashes"].items():
        if run(["exec", "narra-app", "sha256sum", f"/app/{name}"]).split()[0] != expected:
            raise ValueError("Base dependency/schema mismatch")

    owner = manifest["source_sha256"]
    started = time.time()
    subprocess.run([*docker, "build", "--pull=false", "--network=none", "--force-rm", "--memory=2g", "--memory-swap=2g", "--cpu-period=100000", "--cpu-quota=200000", "--label", f"{LABEL}={owner}", "--build-arg", f"BASE_IMAGE={base['Id']}", "--build-arg", f"SOURCE_SHA256={owner}", "-t", manifest["image_tag"], str(ROOT)], env=env, check=True, timeout=600)
    image = json.loads(run(["image", "inspect", manifest["image_tag"]]))[0]
    if image["Os"] != "linux" or image["Architecture"] != "amd64" or image["Config"]["Labels"].get(LABEL) != owner:
        raise ValueError("Candidate image identity mismatch")
    for name in ("narra-worker", "narra-prompt-sync", "narra-rollback-preflight"):
        got = run(["run", "--pull=never", "--rm", "--network=none", "--label", f"{LABEL}={owner}", "--entrypoint", "sha256sum", image["Id"], f"/app/{name}"])
        if got.split()[0] != manifest["binaries"][name]["sha256"]:
            raise ValueError("Candidate runtime binary mismatch")
    tests = run(["run", "--pull=never", "--rm", "--network=none", "--label", f"{LABEL}={owner}", "--env", "NODE_ENV=test", "--mount", f"type=bind,src={ROOT / 'worker-tests'},dst=/checks/worker-tests,readonly", "--entrypoint", "/checks/worker-tests", image["Id"], "-test.run=TestPersistImage|TestIsProductionEnvironment|TestNormalizeGeneratedImageProductionDatabaseStorage|TestDatabaseImageStorageConfig", "-test.timeout=50s", "-test.v"], timeout=65)
    (ROOT / "linux-storage-tests.log").write_text(tests)
    now = json.loads(run(["inspect", "narra-app"]))[0]
    if now["Id"] != original["Id"] or now["Image"] != original["Image"]:
        raise ValueError("Production container changed independently during preparation")
    report = {"image_tag": manifest["image_tag"], "image_id": image["Id"], "source_sha256": owner, "platform": "linux/amd64", "build_seconds": round(time.time() - started, 3), "base_image_id": base["Id"], "binaries_verified": True, "linux_storage_tests": "passed", "production_container_id": original["Id"], "production_container_modified": False, "registry_push": False}
    (ROOT / "build-result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
