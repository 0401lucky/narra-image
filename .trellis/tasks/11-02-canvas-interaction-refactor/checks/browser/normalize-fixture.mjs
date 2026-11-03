import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { helperIdentity, ownedApp, repository, sha, writeJson } from "./identity.mjs";

const { app, ownerRoot } = await ownedApp();
const file = path.join(app, "canvas-fixture-manifest.json");
const manifest = JSON.parse(await readFile(file, "utf8"));
const before = { compilerOptions: { target: "ES2022", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "react-jsx", incremental: true, plugins: [{ name: "next" }], paths: { "@/*": ["./src/*"] } }, include: ["next-env.d.ts", "src/app/**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] };
const after = { ...before, include: [...before.include, ".next/dev/types/**/*.ts"] };
assert.equal(manifest.fixtureInputs["tsconfig.json"], sha(JSON.stringify(before, null, 2)), "Only the original fixture configuration can be normalized");
const bytes = await readFile(path.join(app, "tsconfig.json"));
assert.deepEqual(JSON.parse(bytes), after, "Accept only Next's known dev-type include addition");
for (const [name, hash] of Object.entries(manifest.production)) {
  assert.equal(sha(await readFile(path.join(app, name))), hash, `Copied production input changed: ${name}`);
  assert.equal(sha(await readFile(path.join(repository, name))), hash, `Current production input changed: ${name}`);
}
for (const [name, hash] of Object.entries(manifest.fixtureInputs)) {
  if (name !== "tsconfig.json") assert.equal(sha(await readFile(path.join(app, name))), hash, `Other fixture input changed: ${name}`);
}
const normalization = { at: new Date().toISOString(), file: "tsconfig.json", previousSha256: manifest.fixtureInputs["tsconfig.json"], nextSha256: sha(bytes), reason: "Next 16 added only .next/dev/types/**/*.ts to the copied fixture; production source is unchanged. Rebuild with this exact rebound input." };
manifest.fixtureInputs["tsconfig.json"] = normalization.nextSha256;
manifest.helperInputs = await helperIdentity();
manifest.normalization = normalization;
await writeJson(file, manifest);
await writeJson(path.join(ownerRoot, "fixture-normalization.json"), normalization);
console.log(JSON.stringify(normalization));
