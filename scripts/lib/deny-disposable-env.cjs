/* eslint-disable @typescript-eslint/no-require-imports -- Synchronous Node --require preload must run before config/env modules. */
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { syncBuiltinESMExports } = require("node:module");

function denied(value) {
  if (typeof value === "number") return false;
  try {
    const file = value instanceof URL ? fileURLToPath(value) : String(value);
    const name = path.basename(file).toLowerCase();
    return name === ".env" || name.startsWith(".env.");
  } catch { return false; }
}

function missing() {
  return Object.assign(new Error("Disposable verification cannot read local environment files"), { code: "ENOENT" });
}

const exists = fs.existsSync;
fs.existsSync = function (file) { return !denied(file) && exists.call(this, file); };
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
