"""Prepare the approved official font package without build-time network access."""

import argparse
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import time
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener


TASK = Path(__file__).resolve().parents[2]
ROOT = TASK.parents[2]
EVIDENCE = TASK / "research/asset-evidence"
OUTPUT = Path(__file__).resolve().parent / "font-package"
FAMILIES = {
    "Cormorant Garamond": ("NarraHomeCormorant", "cormorant-garamond"),
    "Noto Serif SC": ("NarraHomeNotoSerifSC", "noto-serif-sc"),
    "Plus Jakarta Sans": ("NarraHomeJakarta", "plus-jakarta-sans"),
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def valid_woff2(data):
    return (
        len(data) >= 48
        and data[:4] == b"wOF2"
        and struct.unpack(">I", data[8:12])[0] == len(data)
    )


def download(entry):
    url, filename = entry
    destination = OUTPUT / filename
    if destination.is_file():
        data = destination.read_bytes()
        if not valid_woff2(data):
            raise ValueError(f"Invalid existing font: {filename}")
    else:
        # Deliberately do not inherit proxy/auth configuration for public downloads.
        opener = build_opener(ProxyHandler({}))
        for attempt in range(3):
            try:
                with opener.open(
                    Request(url, headers={"User-Agent": "Narra-asset-preparation/1.0"}),
                    timeout=30,
                ) as response:
                    if urlsplit(response.geturl()).hostname != "fonts.gstatic.com":
                        raise ValueError("Unexpected font download redirect")
                    data = response.read(2 * 1024 * 1024 + 1)
                if len(data) > 2 * 1024 * 1024 or not valid_woff2(data):
                    raise ValueError(f"Invalid or oversized WOFF2: {filename}")
                destination.write_bytes(data)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
    return {"url": url, "file": filename, "bytes": len(data), "sha256": sha256(data)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish", action="store_true")
    arguments = parser.parse_args()
    css_source = EVIDENCE / "google-fonts.css"
    css = css_source.read_text(encoding="utf-8")
    entries = {}
    counts = {}
    for block in re.findall(r"@font-face\s*\{[^}]+\}", css):
        match = re.search(r"font-family:\s*'([^']+)'", block)
        if not match or match[1] not in FAMILIES:
            raise ValueError("Unexpected family in approved CSS")
        family = match[1]
        counts[family] = counts.get(family, 0) + 1
        for url in re.findall(r"url\((https://[^)]+)\)", block):
            parsed = urlsplit(url)
            if parsed.hostname != "fonts.gstatic.com" or not parsed.path.endswith(".woff2"):
                raise ValueError("Unexpected font source")
            entries[url] = f"{FAMILIES[family][1]}-{sha256(url.encode())[:16]}.woff2"
    if len(entries) != 115 or counts != {
        "Cormorant Garamond": 25,
        "Noto Serif SC": 303,
        "Plus Jakarta Sans": 16,
    }:
        raise ValueError(f"Approved stylesheet changed: {counts}, {len(entries)} URLs")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        files = list(executor.map(download, entries.items()))
    local_css = css
    for family, (alias, _) in FAMILIES.items():
        local_css = local_css.replace(f"font-family: '{family}'", f"font-family: '{alias}'")
    for url, filename in entries.items():
        local_css = local_css.replace(url, f"/marketing/home/fonts/{filename}")
    if "https://" in local_css or local_css.count("font-display: swap") != 344:
        raise ValueError("Incomplete local font conversion")
    (OUTPUT / "fonts.css").write_text(local_css, encoding="utf-8", newline="\n")
    licenses = []
    for _, prefix in FAMILIES.values():
        source = EVIDENCE / f"{prefix}-OFL.txt"
        target = OUTPUT / source.name
        shutil.copyfile(source, target)
        licenses.append({"file": source.name, "sha256": sha256(target.read_bytes())})
    manifest = {
        "preparedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "sourceCss": str(css_source.relative_to(ROOT)).replace("\\", "/"),
        "sourceCssSha256": sha256(css_source.read_bytes()),
        "cssBlocks": counts,
        "uniqueBinaries": len(files),
        "totalBinaryBytes": sum(entry["bytes"] for entry in files),
        "aliases": {name: alias for name, (alias, _) in FAMILIES.items()},
        "files": sorted(files, key=lambda entry: entry["file"]),
        "licenses": licenses,
        "binaryPolicy": "Official WOFF2 files unmodified; CSS aliases and source paths only.",
    }
    (OUTPUT.parent / "font-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    if arguments.publish:
        public = ROOT / "public/marketing/home/fonts"
        css_target = ROOT / "src/components/marketing/homepage/fonts.css"
        public.mkdir(parents=True, exist_ok=True)
        css_target.parent.mkdir(parents=True, exist_ok=True)
        for entry in [*files, *licenses]:
            source = OUTPUT / entry["file"]
            target = public / entry["file"]
            if target.exists() and target.read_bytes() != source.read_bytes():
                raise ValueError(f"Refusing to overwrite an unrelated asset: {target}")
            shutil.copyfile(source, target)
        if css_target.exists() and css_target.read_text(encoding="utf-8") != local_css:
            raise ValueError("Refusing to overwrite existing font declarations")
        css_target.write_text(local_css, encoding="utf-8", newline="\n")
    print(json.dumps({
        "prepared": len(files),
        "totalBinaryBytes": manifest["totalBinaryBytes"],
        "published": arguments.publish,
    }))


if __name__ == "__main__":
    main()
