/* eslint-disable @typescript-eslint/no-require-imports -- Runs under the audited synchronous preload. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { promisify } = require("node:util");

async function main() {
  assert.equal(process.version, "v24.22.1");
  for (const name of ["AUTH_SECRET", "DATABASE_URL", "APP_URL", "NODE_PATH", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "GITHUB_TOKEN", "GH_TOKEN", "AWS_SECRET_ACCESS_KEY"]) {
    assert.equal(Object.hasOwn(process.env, name), false, name);
  }
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(process.env.NODE_OPTIONS.includes("deny_env.cjs"));
  const root = process.env.NARRA_CHECK_ROOT;
  assert.equal(process.cwd(), root);
  const example = path.join(root, ".env.example");
  assert.equal(fs.existsSync(example), true);
  assert.equal(await promisify(fs.exists)(example), true);
  assert.ok(fs.readFileSync(example).length > 0);
  if (process.argv.includes("--child")) {
    process.stdout.write("child startup: absent auth/database, pinned Node and dotenv guard verified\n");
    return;
  }
  const parent = path.join(process.env.NARRA_CHECK_OWNER_ROOT, "temp");
  const directory = fs.mkdtempSync(path.join(parent, "review-deny-"));
  const canary = path.join(directory, ".env");
  fs.writeFileSync(canary, "SYNTHETIC_REVIEW_ONLY=not-a-credential\n");
  try {
    assert.equal(fs.existsSync(canary), false);
    assert.equal(await promisify(fs.exists)(canary), false);
    assert.throws(() => fs.readFileSync(canary), { code: "ENOENT" });
    await assert.rejects(fs.promises.readFile(canary), { code: "ENOENT" });
    await new Promise((resolve, reject) => fs.readFile(canary, (error) => {
      try { assert.equal(error.code, "ENOENT"); resolve(); } catch (failure) { reject(failure); }
    }));
    const esm = await import("node:fs");
    assert.throws(() => esm.readFileSync(canary), { code: "ENOENT" });
    const child = spawnSync(process.execPath, [__filename, "--child"], {
      cwd: root, env: process.env, encoding: "utf8", windowsHide: true, timeout: 10000,
    });
    assert.equal(child.status, 0, child.stderr);
    process.stdout.write(child.stdout);
    process.stdout.write("parent startup: absent variables, synthetic dotenv denial and exact public example verified\n");
  } finally {
    assert.equal(path.dirname(directory), parent);
    fs.unlinkSync(canary);
    fs.rmdirSync(directory);
  }
}

main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
