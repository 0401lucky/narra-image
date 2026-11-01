import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".serena/**",
    ".worktrees/**",
    "coverage/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Task evidence includes generated/vendor snapshots, not application source.
    ".trellis/tasks/**",
    // 本地 pi 工具目录，不属于仓库源码：
    ".pi/**",
  ]),
]);

export default eslintConfig;
