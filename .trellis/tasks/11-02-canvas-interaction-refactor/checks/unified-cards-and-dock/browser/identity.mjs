import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(here, "../../../../../..");
export const checks = path.resolve(here, "../..");
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + "\n");
export function within(file, root) {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function ownedApp() {
  const app = await realpath(process.cwd());
  const runtime = await realpath(path.join(checks, ".runtime"));
  assert(within(app, runtime) && path.basename(app) === "app");
  const ownerRoot = path.dirname(app);
  const owner = JSON.parse(await readFile(path.join(ownerRoot, "owner.json"), "utf8"));
  assert.equal(owner.kind, "canvas-unified-cards-dock-v2");
  assert.equal(path.resolve(owner.workspace), app);
  assert.equal(path.resolve(process.env.NARRA_CHECK_ROOT), app);
  assert.equal(process.version, "v24.22.1");
  const require = createRequire(path.join(app, "package.json"));
  const packages = {};
  for (const name of ["next", "react", "react-dom", "@xyflow/react"]) {
    const file = await realpath(require.resolve(name + "/package.json"));
    assert(within(file, path.join(app, "node_modules")), `Package escaped dependency copy: ${name}`);
    packages[name] = { path: file, version: JSON.parse(await readFile(file, "utf8")).version, sha256: sha(await readFile(file)) };
  }
  const guard = path.join(ownerRoot, "tools/deny_env.cjs");
  assert.equal(sha(await readFile(guard)), sha(await readFile(path.join(checks, "deny_env.cjs"))));
  return { app, ownerRoot, owner, packages, guardHash: sha(await readFile(guard)) };
}

export async function fileTree(root, relative = "") {
  const result = {};
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(result, await fileTree(root, file));
    else {
      assert(entry.isFile() && !(await lstat(path.join(root, file))).isSymbolicLink(), `Unexpected link: ${file}`);
      result[file] = sha(await readFile(path.join(root, file)));
    }
  }
  return result;
}

export async function helperIdentity() {
  const result = {};
  for (const entry of await readdir(here, { withFileTypes: true })) {
    if (entry.isFile() && /\.(mjs|cjs)$/.test(entry.name)) result[entry.name] = sha(await readFile(path.join(here, entry.name)));
  }
  return result;
}

export async function productionIdentity() {
  const files = {};
  for (const prefix of ["src/components", "src/lib", "contracts", "public"]) {
    const tree = await fileTree(path.join(repository, prefix));
    for (const [file, hash] of Object.entries(tree)) files[path.posix.join(prefix, file)] = hash;
  }
  for (const file of ["src/app/globals.css", "postcss.config.mjs", "package.json", "pnpm-lock.yaml"]) files[file] = sha(await readFile(path.join(repository, file)));
  return files;
}

export async function buildIdentity(app) {
  const files = {};
  for (const prefix of [".next/server", ".next/static"]) {
    const tree = await fileTree(path.join(app, prefix));
    for (const [file, hash] of Object.entries(tree)) files[path.posix.join(prefix, file)] = hash;
  }
  files[".next/BUILD_ID"] = sha(await readFile(path.join(app, ".next/BUILD_ID")));
  return { count: Object.keys(files).length, sha256: sha(JSON.stringify(Object.entries(files).sort())), files };
}

export async function verifyInputs(stage, includeBuild = false) {
  const context = await ownedApp();
  const manifest = JSON.parse(await readFile(path.join(context.app, "canvas-fixture-manifest.json"), "utf8"));
  const drift = [];
  const production = await productionIdentity();
  if (JSON.stringify(Object.keys(production).sort()) !== JSON.stringify(Object.keys(manifest.production).sort())) drift.push("production-file-list");
  for (const [file, hash] of Object.entries(manifest.production)) {
    if (sha(await readFile(path.join(context.app, file))) !== hash) drift.push("copy:" + file);
    if (sha(await readFile(path.join(repository, file))) !== hash) drift.push("current:" + file);
  }
  for (const [file, hash] of Object.entries(manifest.fixtureInputs)) {
    if (sha(await readFile(path.join(context.app, file))) !== hash) drift.push("fixture:" + file);
  }
  const helpers = await helperIdentity();
  if (JSON.stringify(helpers) !== JSON.stringify(manifest.helperInputs)) drift.push("helpers");
  const build = includeBuild ? await buildIdentity(context.app) : null;
  const report = { stage, at: new Date().toISOString(), productionCount: Object.keys(manifest.production).length, fixtureInputs: manifest.fixtureInputs, helperInputs: helpers, packages: context.packages, guardHash: context.guardHash, build, drift };
  await writeJson(path.join(context.ownerRoot, `identity-${stage}.json`), report);
  assert.deepEqual(drift, [], `${stage}: source/helper drift`);
  return { ...context, manifest, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stage = process.argv[2] ?? "audit";
  const { report } = await verifyInputs(stage, process.argv.includes("--build"));
  console.log(JSON.stringify({ stage, productionCount: report.productionCount, buildHash: report.build?.sha256, drift: report.drift }));
}
