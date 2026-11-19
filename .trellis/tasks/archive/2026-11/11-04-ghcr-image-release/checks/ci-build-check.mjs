import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
assert.equal(root, process.env.NARRA_CHECK_ROOT);
const owner = JSON.parse(await readFile(path.join(process.env.NARRA_CHECK_OWNER_ROOT, "owner.json"), "utf8"));
assert.equal(owner.kind, "ghcr-image-release-local-v1");
assert.equal(path.resolve(owner.workspace), root);
const { createCiStages } = await import(pathToFileURL(path.join(root, "scripts/verify-ci.mjs")));
const { runStages } = await import(pathToFileURL(path.join(root, "scripts/lib/command-runner.mjs")));
const build = createCiStages(process.env).at(-1);
assert.equal(build.executable, "pnpm");
assert.deepEqual(build.args, ["build"]);
process.exitCode = await runStages([build], { cwd: root, env: process.env, deadlineMs: 660000, scope: "release-local-build" });
