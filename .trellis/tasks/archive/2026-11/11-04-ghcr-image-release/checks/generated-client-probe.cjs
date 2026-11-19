const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");

const root = process.cwd();
assert.equal(root, process.env.NARRA_CHECK_ROOT);
const local = createRequire(path.join(root, "package.json"));
const prisma = createRequire(local.resolve("@prisma/client/package.json"));
try {
  const generated = prisma.resolve(".prisma/client/default");
  const { PrismaClient } = local("@prisma/client");
  assert.equal(typeof PrismaClient, "function");
  assert(!process.argv.includes("--expect-missing"), "Clean-client negative unexpectedly resolved generated output");
  console.log(JSON.stringify({ generated, clientAvailable: true }));
} catch (error) {
  if (process.argv.includes("--expect-missing") && error.code === "MODULE_NOT_FOUND") {
    console.log(JSON.stringify({ clientAvailable: false, expected: true }));
  } else throw error;
}
