const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

assert.equal(process.version, "v24.22.1");
assert(process.env.NARRA_CHECK_ROOT && path.resolve(process.env.NARRA_CHECK_ROOT) === process.cwd());
const files = ["deny_env.cjs", "guard_selftest.cjs", "prisma_no_network.cjs", "syntax_check.cjs",
  ...readdirSync(path.join(__dirname, "browser")).filter((name) => /\.(mjs|cjs)$/.test(name)).map((name) => "browser/" + name)];
const results = files.map((name) => {
  const file = path.join(__dirname, name);
  const result = spawnSync(process.execPath, ["--check", file], { cwd: process.cwd(), env: process.env, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
  return { file: name, sha256: createHash("sha256").update(readFileSync(file)).digest("hex"), exitCode: result.status, error: result.error?.message ?? null, stderr: result.stderr?.toString() ?? "" };
});
console.log(JSON.stringify({ node: process.version, results }, null, 2));
process.exitCode = results.some((result) => result.exitCode !== 0 || result.error) ? 1 : 0;
