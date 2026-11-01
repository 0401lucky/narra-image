import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checks = path.dirname(fileURLToPath(import.meta.url));
const app = await realpath(process.cwd());
const runtime = await realpath(path.join(checks, ".runtime"));
const relative = path.relative(runtime, app);
assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(app) === "app");
const { ESLint } = createRequire(path.join(app, "package.json"))("eslint");
const eslint = new ESLint({ overrideConfigFile: path.join(app, "eslint.config.mjs") });
const cases = [
  [".trellis/tasks/example/checks/fixture.ts", true],
  [".trellis/tasks/archive/2026-10/example/checks/generated.js", true],
  [".trellis/tasks/example/checks/.runtime/app/src/page.tsx", true],
  ["src/app/page.tsx", false],
  ["src/components/marketing/homepage/gallery-card.tsx", false],
  ["src/tests/unit/eslint-scope.test.ts", false],
  ["scripts/verify-ci.mjs", false],
  ["scripts/fixtures/canvas-runtime.mjs", false],
  [".trellis/scripts/eslint-scope-control.js", false],
];
const results = [];
for (const [file, expected] of cases) results.push({ file, expected, ignored: await eslint.isPathIgnored(file) });
const sha256 = createHash("sha256").update(await readFile(path.join(app, "eslint.config.mjs"))).digest("hex");
console.log(JSON.stringify({ sha256, results }, null, 2));
assert(results.every((row) => row.ignored === row.expected), "Task evidence is not application lint input; real source must stay in scope");
