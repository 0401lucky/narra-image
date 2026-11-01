import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const app = await realpath(process.cwd());
const runtime = await realpath(path.resolve(here, "../.runtime"));
assert(path.relative(runtime, app) && !path.relative(runtime, app).startsWith("..") && path.basename(app) === "app");
const file = path.join(app, "homepage-fixture-manifest.json");
const manifest = JSON.parse(await readFile(file, "utf8"));
assert.equal(manifest.mode, "final", "Baseline/privacy inputs must remain fixed");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const next = {};
async function readSources(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) await readSources(name);
    else {
      assert(entry.isFile(), `Source links are not copied: ${name}`);
      next[name] = await readFile(path.join(root, name));
    }
  }
}
await readSources("src");
await readSources("public");
for (const name of ["next.config.ts", "package.json", "pnpm-lock.yaml", "tsconfig.json", "postcss.config.mjs"]) next[name] = await readFile(path.join(root, name));
const changes = [];
for (const [name, previous] of Object.entries(manifest.production)) {
  if (manifest.replacements[name]) continue;
  const target = path.join(app, name);
  assert.equal(sha(await readFile(target)), previous, `Unexpected snapshot changes: ${name}`);
  if (!(name in next)) { await unlink(target); changes.push({ file: name, from: previous, to: null }); }
}
for (const [name, data] of Object.entries(next)) {
  const hash = sha(data);
  if (manifest.production[name] !== hash) changes.push({ file: name, from: manifest.production[name] ?? null, to: hash });
  if (manifest.replacements[name]) continue;
  await mkdir(path.dirname(path.join(app, name)), { recursive: true });
  await writeFile(path.join(app, name), data);
}
manifest.production = Object.fromEntries(Object.entries(next).map(([name, data]) => [name, sha(data)]));
manifest.preparedAt = new Date().toISOString();
manifest.previousVerdictsInvalidated = true;
await writeFile(file, JSON.stringify(manifest, null, 2));
const receipt = path.join(here, "evidence", `sync-${Date.now()}.json`);
await writeFile(receipt, JSON.stringify({ time: manifest.preparedAt, app, changes, note: "Controlled production-source refresh. All prior build/browser verdicts invalid until rebuilt and rerun." }, null, 2));
console.log(JSON.stringify({ receipt, changes: changes.length }));
