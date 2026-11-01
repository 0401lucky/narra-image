import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIXED_GUARD_SHA256, helperIdentity, sha256 } from "./input-identity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = await realpath(process.cwd());
assert.equal(app, await realpath(process.env.NARRA_CHECK_ROOT));
const owner = await realpath(process.env.NARRA_CHECK_OWNER_ROOT);
assert.equal(path.dirname(app), owner);
assert.equal(sha256(await readFile(path.join(owner, "tools/deny_env.cjs"))), FIXED_GUARD_SHA256);
const inputs = await helperIdentity(here);
for (const name of Object.keys(inputs).filter((name) => name.endsWith(".mjs"))) {
  const result = spawnSync(process.execPath, ["--check", path.join(here, name)], { cwd: app, env: process.env, windowsHide: true, timeout: 10000, encoding: "utf8" });
  assert.equal(result.status, 0, `${name}: ${result.stderr || result.error?.message || "syntax check failed"}`);
}
assert.deepEqual(await helperIdentity(here), inputs);
console.log(JSON.stringify({ helperSyntax: "pass", modules: Object.keys(inputs).filter((name) => name.endsWith(".mjs")).length, inputs, guardHash: FIXED_GUARD_SHA256 }));
