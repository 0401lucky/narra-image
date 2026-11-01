/* eslint-disable @typescript-eslint/no-require-imports -- Runs under the task's synchronous preload. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { promisify } = require("node:util");

async function main() {
  const root = process.env.NARRA_CHECK_ROOT;
  assert.equal(process.cwd(), root);
  assert.equal(process.env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(process.env.S3_SECRET_ACCESS_KEY, undefined);
  assert.equal(process.env.HTTP_PROXY, undefined);
  assert.equal(process.env.NODE_PATH, undefined);
  assert.equal(process.env.APP_URL, undefined);
  assert.ok(process.env.NODE_OPTIONS.includes("deny_env.cjs"));
  for (const name of [".env", ".env.local", ".env.production", "nested/.env.example"]) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "SYNTHETIC_TEST_ONLY=not_a_credential\n");
    assert.equal(fs.existsSync(file), false);
    assert.equal(await new Promise((resolve) => fs.exists(file, resolve)), false);
    assert.equal(await promisify(fs.exists)(file), false);
    for (const method of ["readFileSync", "openSync", "statSync", "lstatSync", "accessSync", "createReadStream"]) {
      assert.throws(() => fs[method](file, ...(method === "openSync" ? ["r"] : [])), { code: "ENOENT" });
    }
    for (const method of ["readFile", "open", "stat", "lstat", "access"]) {
      await assert.rejects(fs.promises[method](file, ...(method === "open" ? ["r"] : [])), { code: "ENOENT" });
      let returned = false;
      const pending = new Promise((resolve, reject) => {
        fs[method](file, ...(method === "open" ? ["r"] : []), (error) => {
          try { assert.ok(returned); assert.equal(error.code, "ENOENT"); resolve(); } catch (failure) { reject(failure); }
        });
      });
      returned = true;
      await pending;
    }
    assert.throws(() => fs.readFileSync(Buffer.from(file)), { code: "ENOENT" });
    assert.throws(() => fs.readFileSync(pathToFileURL(file)), { code: "ENOENT" });
  }
  const example = path.join(root, ".env.example");
  const ordinary = path.join(root, "ordinary.txt");
  fs.writeFileSync(ordinary, "PUBLIC_TEST_INPUT\n");
  assert.equal(fs.existsSync(example), true);
  assert.equal(await promisify(fs.exists)(example), true);
  assert.equal(await promisify(fs.exists)(ordinary), true);
  assert.equal(await promisify(fs.exists)(path.join(root, "__missing_file__")), false);
  assert.equal(await promisify(fs.exists)(null), false);
  assert.equal(await promisify(fs.exists)({ invalidPath: true }), false);
  assert.throws(() => fs.exists(ordinary), { code: "ERR_INVALID_ARG_TYPE" });
  assert.equal(fs.readFileSync(example, "utf8"), "PUBLIC_EXAMPLE=placeholder\n");
  assert.equal(await fs.promises.readFile(example, "utf8"), "PUBLIC_EXAMPLE=placeholder\n");
  const esm = await import("node:fs");
  assert.throws(() => esm.readFileSync(path.join(root, ".env")), { code: "ENOENT" });
  const code = "require('node:assert/strict').throws(()=>require('node:fs').readFileSync('.env'),{code:'ENOENT'});";
  const child = spawnSync(process.execPath, ["-e", code], { cwd: root, env: process.env, encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  process.stdout.write("guard-selftest: sync/async/promisify/URL/Buffer/ESM/exact-public-example/child-inheritance passed\n");
}

main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
