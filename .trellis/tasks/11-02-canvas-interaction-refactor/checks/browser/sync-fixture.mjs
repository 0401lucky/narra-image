import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { helperIdentity, ownedApp, repository, sha, writeJson } from "./identity.mjs";

const { app, ownerRoot } = await ownedApp();
const file = path.join(app, "canvas-fixture-manifest.json");
const manifest = JSON.parse(await readFile(file, "utf8"));
for (const [name, hash] of Object.entries(manifest.fixtureInputs)) assert.equal(sha(await readFile(path.join(app, name))), hash, `Fixture shell changed: ${name}`);
for (const [name, oldHash] of Object.entries(manifest.production)) {
  assert.equal(sha(await readFile(path.join(app, name))), oldHash, `Unexpected copied mutation: ${name}`);
  const bytes = await readFile(path.join(repository, name));
  await mkdir(path.dirname(path.join(app, name)), { recursive: true });
  await writeFile(path.join(app, name), bytes);
  manifest.production[name] = sha(bytes);
}
manifest.helperInputs = await helperIdentity();
manifest.syncedAt = new Date().toISOString();
await writeJson(file, manifest);
await writeJson(path.join(ownerRoot, `fixture-sync-${Date.now()}.json`), { at: manifest.syncedAt, productionCount: Object.keys(manifest.production).length, helperInputs: manifest.helperInputs });
console.log(JSON.stringify({ app, productionCount: Object.keys(manifest.production).length, syncedAt: manifest.syncedAt }));
