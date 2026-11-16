"""Prepare an offline, credential-free source bundle and Linux hotfix binaries."""

from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile


DEPLOYMENT = Path(__file__).resolve().parent
PROJECT = DEPLOYMENT.parents[3]
BASE_IMAGE = "ghcr.io/0401lucky/narra-image-app@sha256:53417173c98e66c2f8d0033a6501f305e8807b39c063f3efcd3f122eabf17be1"
DIRECTORIES = ("src", "public", "prisma", "contracts", "scripts", "worker")
FILES = (
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json",
    "next-env.d.ts", "next.config.ts", "postcss.config.mjs", "prisma.config.ts",
    "LICENSE", "THIRD_PARTY_NOTICES.md", ".env.example", "README.md",
    "vitest.config.ts", "eslint.config.mjs", "docker-compose.yml",
)
DEPENDENCY_HASHES = {
    "package.json": "af404da2a44b7b994016bfc7e67bfc4cf945e16d80b8698df2a44b7943d2144b",
    "pnpm-lock.yaml": "5201950763cc0d98b0a08473efd4cbbb1e4900f641e4edf36313e51e25cd6283",
    "pnpm-workspace.yaml": "d8403ee8e009f3a1ba6830959723e486e1e26d81d6c126f638817b933a17a737",
    "prisma/schema.prisma": "947a50293dab8c2ae79e6933a1b5e8849273da50d850fc01fa07b54270256fe9",
}
EXCLUDED = {"node_modules", ".next", ".git", ".cache", "__pycache__", ".npmrc", ".pnpmrc", ".yarnrc", ".yarnrc.yml", ".netrc"}
SYSTEM_KEYS = {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "NUMBER_OF_PROCESSORS"}


def excluded(name: str) -> bool:
    lower = name.lower()
    return name in EXCLUDED or lower == ".env" or lower.startswith(".env.") or lower.endswith((".pem", ".key", ".pfx", ".p12", ".tsbuildinfo"))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_files() -> list[Path]:
    files = [PROJECT / name for name in FILES]
    for name in DIRECTORIES:
        for current, directories, names in os.walk(PROJECT / name, followlinks=False):
            directories[:] = [d for d in directories if not excluded(d)]
            for directory in directories:
                if (Path(current) / directory).is_symlink():
                    raise ValueError("Source directory links are not accepted")
            files.extend(Path(current) / n for n in names if not excluded(n))
    for path in files:
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(PROJECT):
            raise ValueError(f"Expected regular source: {path.relative_to(PROJECT)}")
    return sorted(files)


def add_bytes(archive: tarfile.TarFile, name: str, data: bytes, mode: int = 0o644) -> None:
    if name.startswith("/") or ".." in Path(name).parts:
        raise ValueError("Unsafe bundle member")
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    info.uid = info.gid = 0
    archive.addfile(info, io.BytesIO(data))


def main() -> None:
    if not (PROJECT / "worker/go.mod").is_file():
        raise ValueError("Project root mismatch")
    for name, expected in DEPENDENCY_HASHES.items():
        if digest((PROJECT / name).read_bytes().replace(b"\r\n", b"\n")) != expected:
            raise ValueError(f"Re-audit base dependency/schema compatibility: {name}")

    sources = {path.relative_to(PROJECT).as_posix(): path.read_bytes() for path in source_files()}
    worker_sources = {}
    for path in sorted((PROJECT / "worker").rglob("*")):
        if path.is_file() and path.suffix in {".go", ".mod", ".sum"}:
            worker_sources[path.relative_to(PROJECT).as_posix()] = digest(path.read_bytes())
    hashes = {name: digest(data) for name, data in sources.items()}
    snapshot = digest(json.dumps({"app": hashes, "worker": worker_sources}, sort_keys=True).encode())
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    artifact = DEPLOYMENT / "artifacts" / f"{stamp}-{snapshot[:12]}"
    artifact.mkdir(parents=True, mode=0o700)

    go = shutil.which("go")
    if not go:
        raise ValueError("Installed Go is required")
    env = {k: v for k, v in os.environ.items() if k.upper() in SYSTEM_KEYS}
    env.update({"GOOS": "linux", "GOARCH": "amd64", "CGO_ENABLED": "0", "GOPROXY": "off", "GOSUMDB": "off", "GOTOOLCHAIN": "local"})
    binaries = {}
    for name, command in (("narra-worker", "worker"), ("narra-prompt-sync", "prompt-sync"), ("narra-rollback-preflight", "rollback-preflight")):
        target = artifact / name
        subprocess.run([go, "-C", "worker", "build", "-trimpath", "-o", str(target), f"./cmd/{command}"], cwd=PROJECT, env=env, check=True, timeout=180)
        data = target.read_bytes()
        if not data.startswith(b"\x7fELF"):
            raise ValueError("Expected Linux ELF binary")
        binaries[name] = {"sha256": digest(data), "bytes": len(data)}
    test_binary = artifact / "worker-tests"
    subprocess.run([go, "-C", "worker", "test", "-c", "-trimpath", "-o", str(test_binary), "./internal/worker"], cwd=PROJECT, env=env, check=True, timeout=180)
    binaries["worker-tests"] = {"sha256": digest(test_binary.read_bytes()), "bytes": test_binary.stat().st_size}

    current_hashes = {path.relative_to(PROJECT).as_posix(): digest(path.read_bytes()) for path in source_files()}
    current_worker = {path.relative_to(PROJECT).as_posix(): digest(path.read_bytes()) for path in (PROJECT / "worker").rglob("*") if path.is_file() and path.suffix in {".go", ".mod", ".sum"}}
    if current_hashes != hashes or current_worker != worker_sources:
        raise ValueError("Source changed during compilation; prepare a fresh candidate")
    manifest = {"source_sha256": snapshot, "created_at": stamp, "base_image": BASE_IMAGE, "dependency_hashes": DEPENDENCY_HASHES, "source_files": hashes, "worker_source_files": worker_sources, "binaries": binaries, "image_tag": f"narra-image-app:db-storage-{snapshot[:12]}", "production_container_modified": False}
    manifest_data = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    (artifact / "manifest.json").write_bytes(manifest_data)
    bundle = artifact / "candidate.tar.gz"
    with tarfile.open(bundle, "w:gz") as archive:
        for name, data in sources.items():
            add_bytes(archive, f"payload/{name}", data)
        for name in binaries:
            add_bytes(archive, name, (artifact / name).read_bytes(), 0o755)
        add_bytes(archive, "Dockerfile", (DEPLOYMENT / "Dockerfile.candidate").read_bytes())
        add_bytes(archive, "build_candidate.py", (DEPLOYMENT / "build_candidate.py").read_bytes())
        add_bytes(archive, "manifest.json", manifest_data)
    report = {"artifact_directory": str(artifact), "bundle": str(bundle), "bundle_sha256": digest(bundle.read_bytes()), "bundle_bytes": bundle.stat().st_size, "image_tag": manifest["image_tag"], "source_sha256": snapshot, "binaries": binaries}
    (DEPLOYMENT / "candidate.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
