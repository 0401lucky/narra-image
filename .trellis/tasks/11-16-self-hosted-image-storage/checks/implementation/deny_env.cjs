/* eslint-disable @typescript-eslint/no-require-imports -- This guard runs before any Node configuration loader. */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { fileURLToPath } = require("node:url");
const { promisify } = require("node:util");
const { syncBuiltinESMExports } = require("node:module");

const root = path.resolve(process.env.NARRA_CHECK_ROOT || "__missing_check_root__");
const example = path.join(root, ".env.example");
const expectedHash = process.env.NARRA_CHECK_PUBLIC_ENV_SHA256;
const originalRead = fs.readFileSync;
const originalLstat = fs.lstatSync;
const originalRealpath = fs.realpathSync;
const normalize = (value) => path.resolve(value).toLowerCase();
let verifiedExample = false;
try {
  verifiedExample = typeof expectedHash === "string" && /^[a-f0-9]{64}$/.test(expectedHash)
    && originalLstat(example).isFile() && !originalLstat(example).isSymbolicLink()
    && normalize(originalRealpath(example)) === normalize(example)
    && createHash("sha256").update(originalRead(example)).digest("hex") === expectedHash;
} catch { /* A missing public example never widens the exception. */ }

function denied(value) {
  if (typeof value === "number") return false;
  try {
    const file = value instanceof URL ? fileURLToPath(value) : String(value);
    const name = path.basename(file).toLowerCase();
    if (name !== ".env" && !name.startsWith(".env.")) return false;
    return !(verifiedExample && normalize(file) === normalize(example));
  } catch {
    return false;
  }
}

function missing() {
  return Object.assign(new Error("Homepage checks cannot read local environment files"), { code: "ENOENT" });
}

const exists = fs.existsSync;
fs.existsSync = function (file) { return !denied(file) && exists.call(this, file); };
const existsAsync = fs.exists;
fs.exists = function (file, callback) {
  if (denied(file)) return process.nextTick(callback, false);
  return existsAsync.call(this, file, callback);
};
// fs.exists has a boolean-only callback, unlike the other error-first fs APIs.
Object.defineProperty(fs.exists, promisify.custom, {
  value: (file) => new Promise((resolve) => fs.exists(file, resolve)),
  configurable: true,
});
for (const key of ["readFileSync", "openSync", "statSync", "lstatSync", "accessSync", "createReadStream"]) {
  const original = fs[key];
  fs[key] = function (file, ...args) {
    if (denied(file)) throw missing();
    return original.call(this, file, ...args);
  };
}
for (const key of ["readFile", "open", "stat", "lstat", "access"]) {
  const original = fs[key];
  fs[key] = function (file, ...args) {
    if (!denied(file)) return original.call(this, file, ...args);
    const callback = args.at(-1);
    if (typeof callback !== "function") throw missing();
    process.nextTick(callback, missing());
  };
  const promiseOriginal = fs.promises[key];
  fs.promises[key] = async function (file, ...args) {
    if (denied(file)) throw missing();
    return promiseOriginal.call(this, file, ...args);
  };
}
syncBuiltinESMExports();
