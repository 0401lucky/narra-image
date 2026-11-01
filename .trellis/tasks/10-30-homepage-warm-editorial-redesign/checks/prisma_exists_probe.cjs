/* eslint-disable @typescript-eslint/no-require-imports -- Diagnostic entry runs under the task preload. */
const fs = require("node:fs");
const { promisify } = require("node:util");

async function main() {
  const results = [];
  for (const [file, expected] of [["prisma/schema.prisma", true], [".env.example", true], [".env", false], ["__missing_probe_file__", false]]) {
    try {
      const actual = await promisify(fs.exists)(file);
      results.push({ file, expected, actual, passed: actual === expected });
    } catch (error) {
      results.push({ file, expected, rejectionType: typeof error, rejectionValue: error, passed: false });
    }
  }
  process.stdout.write(`${JSON.stringify({ customPromisifyType: typeof fs.exists[promisify.custom], results }, null, 2)}\n`);
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
