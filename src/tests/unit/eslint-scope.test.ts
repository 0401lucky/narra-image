// @vitest-environment node

import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ overrideConfigFile: path.resolve("eslint.config.mjs") });

describe("ESLint source scope", () => {
  it.each([
    ".trellis/tasks/example/checks/fixture.ts",
    ".trellis/tasks/archive/2026-10/example/checks/generated.js",
    ".trellis/tasks/example/checks/.runtime/app/src/page.tsx",
  ])("excludes task-owned evidence and snapshots: %s", async (file) => {
    expect(await eslint.isPathIgnored(file)).toBe(true);
  });

  it.each([
    "src/app/page.tsx",
    "src/components/marketing/homepage/gallery-card.tsx",
    "src/tests/unit/eslint-scope.test.ts",
    "scripts/verify-ci.mjs",
    "scripts/fixtures/canvas-runtime.mjs",
    ".trellis/scripts/eslint-scope-control.js",
  ])("keeps real source and non-task tooling in scope: %s", async (file) => {
    expect(await eslint.isPathIgnored(file)).toBe(false);
  });
});
