import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The image mount path is fixed by the owner-checked E2E overlay. This helper
// reads actual Linux files; it cannot initialize, repair or delete the volume.
export function inspectImageHistoryVolume(source = process.env) {
  assert.equal(source.E2E_FIXTURE_APP_HTTP, "1");
  assert.match(source.E2E_OWNER_TOKEN ?? "", /^[a-f0-9-]{36}$/);
  const volumeId = source.E2E_IMAGE_VOLUME_ID;
  assert.match(volumeId ?? "", /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const directory = "/data/images";
  assert(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  const marker = path.join(directory, ".narra-image-volume-v1");
  assert(lstatSync(marker).isFile() && !lstatSync(marker).isSymbolicLink());
  assert.equal(readFileSync(marker, "utf8"), `narra-image-volume-v1\n${volumeId}\n`);
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    if (name === ".narra-image-volume-v1" || /^\.narra-image-probe-[a-f0-9-]+(?:\.linked)?$/.test(name)) continue;
    assert.match(name, /^image-[a-f0-9]{64}\.bin$/, "Only complete registered image files may survive the fixture");
    const filename = path.join(directory, name);
    const stat = lstatSync(filename);
    assert(stat.isFile() && !stat.isSymbolicLink());
    assert(stat.size > 0 && stat.size <= 50 * 1024 * 1024);
    assert.equal(stat.mode & 0o777, 0o600);
    const bytes = readFileSync(filename);
    files.push({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return { volumeId, uid: process.getuid(), files };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(inspectImageHistoryVolume())); }
  catch { console.error("Owned image volume content verification failed"); process.exitCode = 1; }
}
