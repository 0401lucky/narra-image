import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Run Next's real type-check phase in its own process to populate its normal
// incremental cache. A subsequent, unchanged complete next build is required.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const owner = JSON.parse(readFileSync(path.join(path.dirname(ROOT), "owner.json"), "utf8"));
assert.equal(owner.kind, "image-storage-foundation-local-v1");
assert.equal(owner.workspace, ROOT);
assert.equal(process.cwd(), ROOT);
assert(process.env.NODE_OPTIONS?.includes("deny_env.cjs"));
process.env.CI = "1";
const require = createRequire(path.join(ROOT, "package.json"));
assert.equal(require("next/package.json").version, "16.2.4", "Re-audit Next's type-check call signature after upgrades");
for (const dependency of ["typescript/package.json", "@types/react/package.json", "@types/node/package.json"]) require.resolve(dependency);
const { PHASE_PRODUCTION_BUILD } = require("next/constants");
const config = await require("next/dist/server/config").default(PHASE_PRODUCTION_BUILD, ROOT);
assert.equal(config.distDir, ".next");
assert.equal(Boolean(config.typescript.ignoreBuildErrors), false);
const result = await require("next/dist/lib/verify-typescript-setup").verifyAndRunTypeScript({
  dir: ROOT,
  distDir: config.distDir,
  cacheDir: path.join(ROOT, config.distDir, "cache"),
  strictRouteTypes: Boolean(config.experimental.strictRouteTypes),
  tsconfigPath: config.typescript.tsconfigPath,
  shouldRunTypeCheck: true,
  typedRoutes: Boolean(config.typedRoutes),
  disableStaticImages: config.images.disableStaticImages,
  hasAppDir: true,
  hasPagesDir: false,
  appDir: path.join(ROOT, "src/app"),
  pagesDir: undefined,
  debugBuildPaths: undefined,
});
assert(result.version && result.result?.inputFilesCount > 0);
console.log(JSON.stringify({ nextTypeCheck: "passed", filteredBuildPaths: false, fullBuildStillRequired: true,
  version: result.version, inputFilesCount: result.result.inputFilesCount,
  totalFilesCount: result.result.totalFilesCount, incremental: result.result.incremental }));
