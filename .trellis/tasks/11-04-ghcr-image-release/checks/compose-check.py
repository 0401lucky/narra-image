"""Daemon-free merged Compose checks with explicit synthetic configuration."""

import argparse
import json
from pathlib import Path

import isolated


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--workspace", type=Path, required=True)
args = parser.parse_args()
checks = isolated.checks
workspace = args.workspace.resolve()
owner, _ = checks.validate_workspace(workspace)
docker = Path("C:/Users/Administrator/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe")
plugins = docker.parents[1] / "cli-plugins"
config = owner / "compose-check-config"
config.mkdir(exist_ok=True)
checks.write_json(config / "config.json", {"auths": {}, "cliPluginsExtraDirs": [str(plugins)]})
env = checks.os_environment(isolated.PINNED_NODE, owner / "home", owner / "temp")
env["DOCKER_CONFIG"] = str(config)
env_file = owner / "compose-check.env"
env_file.write_text("DATABASE_URL=postgresql://fixture:fixture@db:5432/narra_fixture\nAUTH_SECRET=fixture-only-compose-auth-secret-not-live\nAPP_URL=https://fixture.invalid\nPOSTGRES_PASSWORD=fixture-only-password\nWORKER_METRICS_TOKEN=fixture-only-metrics-token\n", encoding="utf-8", newline="\n")
images = {
    "APP_IMAGE": "ghcr.io/0401lucky/narra-image-app:sha-" + "a" * 40,
    "WORKER_IMAGE": "ghcr.io/0401lucky/narra-image-worker:sha-" + "a" * 40,
}
prefix = [str(docker), "--config", str(config), "compose", "--env-file", str(env_file), "--project-directory", str(workspace), "-p", "narra-release-config-check", "-f", str(workspace / "docker-compose.yml")]
reports = []


def model(label, overlay, extra):
    command = [*prefix, *(["-f", str(workspace / "docker-compose.images.yml")] if overlay else []), "config", "--format", "json"]
    report = checks.run_bounded(workspace, command, {**env, **extra}, 30, label)
    reports.append(report)
    return report, json.loads(Path(report["stdout"]).read_text(encoding="utf-8")) if report["exitCode"] == 0 else None


with checks.workspace_lock(workspace):
    base_report, base = model("compose-base", False, images)
    assert base_report["exitCode"] == 0
    merged_report, merged = model("compose-images", True, images)
    assert merged_report["exitCode"] == 0
    assert set(merged["services"]) == set(base["services"])
    for name, service in merged["services"].items():
        assert not service.get("build"), name
        expected = {key: value for key, value in base["services"][name].items() if key != "build"}
        assert service == expected, f"Image overlay changed runtime service contract: {name}"
    for name in ["volumes", "networks"]:
        assert merged.get(name) == base.get(name), name
    assert merged["services"]["app"]["image"] == merged["services"]["migrate"]["image"] == images["APP_IMAGE"]
    assert merged["services"]["worker"]["image"] == images["WORKER_IMAGE"]
    for missing in images:
        report, _ = model("compose-missing-" + missing.lower(), True, {key: value for key, value in images.items() if key != missing})
        assert report["exitCode"] != 0, f"Missing {missing} silently accepted"
        assert missing in Path(report["stderr"]).read_text(encoding="utf-8")
checks.write_json(checks.CHECKS / "compose-validation.json", {"passed": True, "sourceHashes": {name: checks.digest(workspace / name) for name in ["docker-compose.yml", "docker-compose.images.yml"]}, "runtimeContractsPreserved": True, "missingImagesRejected": list(images), "noDaemonMutation": True, "receipts": reports})
print("PASS merged image-only Compose, runtime service/volume parity, both missing image-selector negatives")
