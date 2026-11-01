import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export const FIXED_GUARD_SHA256 = "bd9ec3da5da5787ffc8378f8ed97835428d4b5a9c80a21a099ccca2c4d077e55";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function filesBelow(root, directory, include, result = {}) {
  for (const entry of (await readdir(path.join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(directory, entry.name);
    if (!include(name, entry.isDirectory())) continue;
    if (entry.isDirectory()) await filesBelow(root, name, include, result);
    else if (entry.isSymbolicLink() && name.startsWith(".next/node_modules/")) {
      const resolved = await realpath(path.join(root, name));
      const relative = path.relative(path.join(root, "node_modules"), resolved);
      assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `Next external dependency link escaped the owned physical copy: ${name}`);
      result[name] = { linkTarget: path.relative(root, resolved).split(path.sep).join("/") };
    }
    else {
      assert(entry.isFile(), `Identity inputs cannot escape through a link: ${name}`);
      const bytes = await readFile(path.join(root, name));
      result[name] = { bytes: bytes.length, sha256: sha256(bytes) };
    }
  }
  return result;
}

export function helperIdentity(here) {
  return filesBelow(here, "", (name, directory) => directory ? name === "fixtures" : name.endsWith(".mjs") || name.endsWith(".fixture"));
}

export async function buildIdentity(app) {
  // Next's image/data caches and traces are runtime outputs, not immutable bundles.
  const files = await filesBelow(app, ".next", (name) => !name.startsWith(".next/cache") && !name.startsWith(".next/trace"));
  assert(files[".next/BUILD_ID"], "A real completed Next build is required");
  return { files, sha256: sha256(JSON.stringify(files)), exclusions: [".next/cache/**", ".next/trace*"] };
}
