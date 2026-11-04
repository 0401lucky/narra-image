import assert from "node:assert/strict";
import { mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { helperIdentity, ownedApp, productionIdentity, repository, sha, within, writeJson } from "./identity.mjs";

const { app, ownerRoot } = await ownedApp();
const file = path.join(app, "canvas-fixture-manifest.json");
const manifest = JSON.parse(await readFile(file, "utf8"));
for (const [name, hash] of Object.entries(manifest.fixtureInputs)) assert.equal(sha(await readFile(path.join(app, name))), hash, `Fixture shell changed: ${name}`);
for (const [name, hash] of Object.entries(manifest.production)) assert.equal(sha(await readFile(path.join(app, name))), hash, `Unexpected copied mutation: ${name}`);
const next = await productionIdentity();
for (const [name, hash] of Object.entries(next)) {
  const target = path.resolve(app, name);
  assert(within(target, app));
  const bytes = await readFile(path.join(repository, name));
  assert.equal(sha(bytes), hash, `Source changed while synchronizing: ${name}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
for (const name of Object.keys(manifest.production).filter((name) => !(name in next))) {
  const target = path.resolve(app, name);
  assert(within(await realpath(target), app), "Final removed input path must remain in snapshot");
  await unlink(target);
}
manifest.production = next;
manifest.helperInputs = await helperIdentity();
manifest.syncedAt = new Date().toISOString();
await writeJson(file, manifest);
await writeJson(path.join(ownerRoot, `fixture-sync-${Date.now()}.json`), { at: manifest.syncedAt, productionCount: Object.keys(next).length, helperInputs: manifest.helperInputs });
console.log(JSON.stringify({ app, productionCount: Object.keys(next).length, syncedAt: manifest.syncedAt }));
