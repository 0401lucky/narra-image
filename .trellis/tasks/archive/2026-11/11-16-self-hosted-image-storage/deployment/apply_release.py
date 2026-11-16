"""Switch only the pinned narra app image and explicit database-image opt-in."""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

PROJECT = Path("/home/ubuntu/apps/narra")
COMPOSE = PROJECT / "compose.yml"
ENV_FILE = PROJECT / ".env"
SOURCE = "https://github.com/0401lucky/narra-image"
IMAGE_PATTERN = r"ghcr\.io/0401lucky/narra-image-app@sha256:[a-f0-9]{64}"
FLAG = "ENABLE_DATABASE_IMAGE_STORAGE"


class ReleaseError(Exception):
    """Only stable, credential-free codes may reach the operator."""


def render_compose(original: bytes, image: str) -> bytes:
    lines = original.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if re.fullmatch(rb"  narra:[ \t]*(?:\r?\n)?", line)]
    if len(starts) != 1:
        raise ReleaseError("COMPOSE_SERVICE_SHAPE_CHANGED")
    start = starts[0]
    end = next((i for i in range(start + 1, len(lines)) if re.match(rb"  [^ \t#].*:", lines[i])), len(lines))
    images = [i for i in range(start + 1, end) if lines[i].startswith(b"    image:")]
    fallbacks = [i for i in range(start + 1, end) if lines[i].startswith(b"      ENABLE_LOCAL_IMAGE_FALLBACK:")]
    flags = [i for i in range(start + 1, end) if lines[i].startswith(b"      ENABLE_DATABASE_IMAGE_STORAGE:")]
    if len(images) != 1 or len(fallbacks) != 1 or len(flags) > 1:
        raise ReleaseError("COMPOSE_SETTING_SHAPE_CHANGED")

    def replace_value(line: bytes, key: bytes, value: bytes) -> bytes:
        pattern = rb"([ \t]+" + key + rb":[ \t]*)(\"[^\"]*\"|'[^']*'|[^ \t\r\n]+)([ \t]*(?:#[^\r\n]*)?)(\r?\n)?"
        match = re.fullmatch(pattern, line)
        if not match:
            raise ReleaseError("COMPOSE_VALUE_SHAPE_CHANGED")
        return match[1] + value + match[3] + (match[4] or b"")

    lines[images[0]] = replace_value(lines[images[0]], b"image", image.encode("ascii"))
    if flags:
        lines[flags[0]] = replace_value(lines[flags[0]], FLAG.encode(), b"'true'")
    else:
        anchor = lines[fallbacks[0]]
        newline = b"\r\n" if anchor.endswith(b"\r\n") else b"\n"
        lines.insert(fallbacks[0], b"      ENABLE_DATABASE_IMAGE_STORAGE: 'true'" + newline)
    return b"".join(lines)


def assert_semantic_diff(old: dict, new: dict, image: str) -> None:
    service = old.get("services", {}).get("narra", {})
    if old.get("name") != "narra" or service.get("container_name") != "narra-app" or service.get("build"):
        raise ReleaseError("COMPOSE_IDENTITY_CHANGED")
    expected = copy.deepcopy(old)
    expected["services"]["narra"]["image"] = image
    expected["services"]["narra"].setdefault("environment", {})[FLAG] = "true"
    if new != expected:
        raise ReleaseError("UNEXPECTED_COMPOSE_DIFFERENCE")


def write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def metadata_signature(metadata: os.stat_result) -> tuple:
    return (metadata.st_dev, metadata.st_ino, metadata.st_uid, metadata.st_gid,
            metadata.st_mode, metadata.st_mtime_ns, metadata.st_ctime_ns)


def atomic_replace(expected: bytes, replacement: bytes, metadata: os.stat_result) -> None:
    if COMPOSE.is_symlink() or COMPOSE.read_bytes() != expected:
        raise ReleaseError("CONCURRENT_COMPOSE_EDIT")
    observed = COMPOSE.stat()
    if not stat.S_ISREG(observed.st_mode) or (observed.st_uid, observed.st_gid, stat.S_IMODE(observed.st_mode)) != (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)):
        raise ReleaseError("CONCURRENT_COMPOSE_METADATA_EDIT")
    fd, name = tempfile.mkstemp(prefix=".narra-release-", dir=PROJECT)
    path = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(metadata.st_mode))
            stream.write(replacement)
            stream.flush()
            os.fsync(stream.fileno())
        if COMPOSE.is_symlink() or COMPOSE.read_bytes() != expected:
            raise ReleaseError("CONCURRENT_COMPOSE_EDIT")
        if metadata_signature(COMPOSE.stat()) != metadata_signature(observed):
            raise ReleaseError("CONCURRENT_COMPOSE_METADATA_EDIT")
        os.replace(path, COMPOSE)
    finally:
        path.unlink(missing_ok=True)


class Rollout:
    def __init__(self, scratch: Path):
        config = scratch / "docker-config"
        config.mkdir(mode=0o700)
        write_private(config / "config.json", b'{"auths":{}}\n')
        home = scratch / "home"
        home.mkdir(mode=0o700)
        self.env = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": str(home), "LANG": "C.UTF-8"}
        self.docker = ["docker", "--host", "unix:///var/run/docker.sock", "--config", str(config)]

    def run(self, args: list[str], code: str, timeout: int = 20) -> bytes:
        try:
            result = subprocess.run([*self.docker, *args], env=self.env, cwd=PROJECT, capture_output=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            raise ReleaseError(code) from None
        if result.returncode:
            raise ReleaseError(code)
        return result.stdout

    def compose(self, file: Path, args: list[str], code: str, timeout: int = 30) -> bytes:
        return self.run(["compose", "--project-directory", str(PROJECT), "--env-file", str(ENV_FILE), "-p", "narra", "-f", str(file), *args], code, timeout)

    def inspect(self, selector: str) -> dict:
        return json.loads(self.run(["inspect", selector], "CONTAINER_INSPECT_FAILED"))[0]

    def inspect_app_if_present(self) -> dict | None:
        ids = self.run(["container", "ls", "--all", "--no-trunc", "--filter", "name=^/narra-app$", "--format", "{{.ID}}"], "CONTAINER_LIST_FAILED").strip().splitlines()
        if not ids:
            return None
        if len(ids) != 1 or not re.fullmatch(rb"[a-f0-9]{64}", ids[0]):
            raise ReleaseError("CONTAINER_IDENTITY_CHANGED")
        container = self.inspect(ids[0].decode("ascii"))
        if container.get("Id") != ids[0].decode("ascii"):
            raise ReleaseError("CONTAINER_IDENTITY_CHANGED")
        return container

    @staticmethod
    def assert_container(container: dict, image_id: str) -> None:
        labels = container.get("Config", {}).get("Labels", {})
        if container.get("Name") != "/narra-app" or container.get("Image") != image_id or labels.get("com.docker.compose.project") != "narra" or labels.get("com.docker.compose.service") != "narra" or labels.get("com.docker.compose.project.working_dir") != str(PROJECT) or labels.get("com.docker.compose.project.config_files") != str(COMPOSE):
            raise ReleaseError("CONTAINER_IDENTITY_CHANGED")

    @staticmethod
    def assert_service_config_hash(container: dict, raw: bytes) -> None:
        match = re.fullmatch(rb"(?:narra[ \t]+)?([a-f0-9]{64})", raw.strip())
        labels = container.get("Config", {}).get("Labels", {})
        if not match or labels.get("com.docker.compose.config-hash") != match[1].decode("ascii"):
            raise ReleaseError("PRODUCTION_CONFIG_BASELINE_CHANGED")

    def ready(self, image_id: str, flag: str | None) -> dict:
        probe = "(async()=>{for(const p of ['/api/healthz','/api/readyz']){const r=await fetch('http://127.0.0.1:3000'+p,{redirect:'error',signal:AbortSignal.timeout(2500)});const b=await r.json();if(r.status!==200||(p.endsWith('readyz')?(b.status!=='ready'||b.code!=='READY'):b.status!=='ok'))process.exit(1)}process.exit(0)})().catch(()=>process.exit(1))"
        deadline = time.monotonic() + 150
        observed_id = None
        while time.monotonic() < deadline:
            container = self.inspect("narra-app")
            self.assert_container(container, image_id)
            if observed_id is not None and container["Id"] != observed_id:
                raise ReleaseError("CONCURRENT_CONTAINER_REPLACEMENT")
            observed_id = container["Id"]
            env = dict(value.split("=", 1) for value in container["Config"].get("Env", []) if "=" in value)
            if env.get(FLAG) != flag:
                raise ReleaseError("CONTAINER_STORAGE_FLAG_MISMATCH")
            if container.get("State", {}).get("Running"):
                try:
                    self.run(["exec", container["Id"], "node", "-e", probe], "APP_NOT_READY", timeout=8)
                    return container
                except ReleaseError:
                    pass
            time.sleep(2)
        raise ReleaseError("APP_READINESS_TIMEOUT")


def execute(image: str, sha: str, apply: bool) -> tuple[dict, int]:
    scratch = Path(tempfile.mkdtemp(prefix="narra-image-release-", dir="/tmp"))
    write_private(scratch / "owner.json", json.dumps({"task": "self-hosted-image-storage", "sha": sha, "image": image}).encode())
    report = {"mode": "apply" if apply else "dry_run", "sha": sha, "image": image, "scratch": str(scratch), "production_modified": False, "rollback": "not_needed"}
    original = rendered = env_bytes = None
    metadata = old_container = old_config = new_image = None
    try:
        if COMPOSE.is_symlink() or ENV_FILE.is_symlink() or not COMPOSE.is_file() or not ENV_FILE.is_file():
            raise ReleaseError("PROJECT_CONFIG_SHAPE_CHANGED")
        original, env_bytes, metadata = COMPOSE.read_bytes(), ENV_FILE.read_bytes(), COMPOSE.stat()
        rendered = render_compose(original, image)
        old_file, new_file = scratch / "old-compose.yml", scratch / "new-compose.yml"
        write_private(old_file, original)
        write_private(new_file, rendered)
        runner = Rollout(scratch)
        old_config = json.loads(runner.compose(old_file, ["config", "--format", "json"], "COMPOSE_PARSE_FAILED"))
        new_config = json.loads(runner.compose(new_file, ["config", "--format", "json"], "COMPOSE_PARSE_FAILED"))
        assert_semantic_diff(old_config, new_config, image)
        old_container = runner.inspect("narra-app")
        old_image = old_config["services"]["narra"]["image"]
        if not re.fullmatch(IMAGE_PATTERN, old_image) or old_container["Config"]["Image"] != old_image or not old_container["State"]["Running"]:
            raise ReleaseError("PRODUCTION_BASELINE_CHANGED")
        runner.assert_container(old_container, old_container["Image"])
        runner.assert_service_config_hash(old_container, runner.compose(old_file, ["config", "--hash", "narra"], "COMPOSE_HASH_FAILED"))
        new_image = json.loads(runner.run(["image", "inspect", image], "RELEASE_IMAGE_NOT_LOCAL"))[0]
        labels = new_image.get("Config", {}).get("Labels", {})
        if new_image.get("Os") != "linux" or new_image.get("Architecture") != "amd64" or labels.get("org.opencontainers.image.source") != SOURCE or labels.get("org.opencontainers.image.revision") != sha or labels.get("org.opencontainers.image.licenses") != "AGPL-3.0-only":
            raise ReleaseError("RELEASE_IMAGE_IDENTITY_MISMATCH")
        report.update(old_image=old_image, new_image_id=new_image["Id"], semantic_difference=["services.narra.image", "services.narra.environment." + FLAG])
        if apply:
            preflight = json.loads(runner.run(["exec", old_container["Id"], "/app/narra-rollback-preflight"], "ROLLBACK_PREFLIGHT_FAILED", timeout=20))
            if preflight.get("code") != "ROLLBACK_SAFE" or preflight.get("status") != "safe":
                raise ReleaseError("ROLLBACK_PREFLIGHT_UNSAFE")
            if ENV_FILE.is_symlink() or ENV_FILE.read_bytes() != env_bytes or runner.inspect("narra-app")["Id"] != old_container["Id"] or metadata_signature(COMPOSE.stat()) != metadata_signature(metadata):
                raise ReleaseError("CONCURRENT_PRODUCTION_CHANGE")
            backup = PROJECT / ("compose.yml.bak-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-database-images")
            write_private(backup, original)
            report["backup"] = str(backup)
            atomic_replace(original, rendered, metadata)
            report["production_modified"] = True
            runner.run(["stop", "--time", "45", old_container["Id"]], "APP_STOP_FAILED", timeout=60)
            if COMPOSE.read_bytes() != rendered or ENV_FILE.read_bytes() != env_bytes:
                raise ReleaseError("CONCURRENT_PRODUCTION_CHANGE")
            runner.compose(COMPOSE, ["up", "-d", "--no-deps", "--no-build", "--pull=never", "narra"], "APP_START_FAILED", timeout=90)
            ready = runner.ready(new_image["Id"], "true")
            if COMPOSE.read_bytes() != rendered or ENV_FILE.is_symlink() or ENV_FILE.read_bytes() != env_bytes or runner.inspect("narra-app")["Id"] != ready["Id"]:
                raise ReleaseError("CONCURRENT_PRODUCTION_CHANGE")
            report.update(status="applied", code="RELEASE_READY", container_id=ready["Id"], app_healthz="passed", app_readyz="passed")
        else:
            report.update(status="dry_run_ready", code="DRY_RUN_READY")
        exit_code = 0
    except (ReleaseError, OSError, ValueError, KeyError, IndexError) as error:
        report.update(status="failed", code=str(error) if isinstance(error, ReleaseError) else "ROLLOUT_CHECK_FAILED")
        exit_code = 1
        if report["production_modified"]:
            try:
                if COMPOSE.is_symlink() or COMPOSE.read_bytes() != rendered or ENV_FILE.is_symlink() or ENV_FILE.read_bytes() != env_bytes:
                    raise ReleaseError("ROLLBACK_BLOCKED_CONCURRENT_CONFIG")
                current_metadata = COMPOSE.stat()
                if not stat.S_ISREG(current_metadata.st_mode) or (current_metadata.st_uid, current_metadata.st_gid, stat.S_IMODE(current_metadata.st_mode)) != (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)):
                    raise ReleaseError("ROLLBACK_BLOCKED_CONCURRENT_CONFIG")
                # Use the new release's read-only preflight even if its app never became ready.
                preflight = json.loads(runner.compose(new_file, ["run", "--rm", "--no-deps", "--pull=never", "--entrypoint", "/app/narra-rollback-preflight", "narra"], "ROLLBACK_PREFLIGHT_FAILED", timeout=30))
                if preflight.get("code") != "ROLLBACK_SAFE" or preflight.get("status") != "safe":
                    raise ReleaseError("ROLLBACK_PREFLIGHT_UNSAFE")
                current = runner.inspect_app_if_present()
                if current:
                    if current["Id"] != old_container["Id"]:
                        runner.assert_container(current, new_image["Id"])
                    runner.run(["stop", "--time", "45", current["Id"]], "ROLLBACK_STOP_FAILED", timeout=60)
                atomic_replace(rendered, original, metadata)
                if ENV_FILE.read_bytes() != env_bytes:
                    raise ReleaseError("ROLLBACK_BLOCKED_CONCURRENT_CONFIG")
                runner.compose(COMPOSE, ["up", "-d", "--no-deps", "--no-build", "--pull=never", "narra"], "ROLLBACK_START_FAILED", timeout=90)
                old_flag = dict(value.split("=", 1) for value in old_container["Config"].get("Env", []) if "=" in value).get(FLAG)
                runner.ready(old_container["Image"], old_flag)
                report["rollback"] = "restored_and_ready"
            except (ReleaseError, OSError, ValueError, KeyError, IndexError) as rollback_error:
                report["rollback"] = str(rollback_error) if isinstance(rollback_error, ReleaseError) else "ROLLBACK_FAILED"
                exit_code = 2
    write_private(scratch / "rollout-result.json", (json.dumps(report, indent=2) + "\n").encode())
    return report, exit_code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--apply", action="store_true", help="Apply; otherwise only inspect and render")
    args = parser.parse_args()
    if not re.fullmatch(IMAGE_PATTERN, args.image) or not re.fullmatch(r"[a-f0-9]{40}", args.sha):
        parser.error("INVALID_RELEASE_SELECTOR")
    try:
        report, code = execute(args.image, args.sha, args.apply)
    except (OSError, ValueError):
        report, code = {"status": "failed", "code": "ROLLOUT_SETUP_FAILED"}, 1
    print(json.dumps(report, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
