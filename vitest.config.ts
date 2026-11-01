import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup/vitest.setup.ts"],
    include: ["src/tests/**/*.test.ts", "src/tests/**/*.test.tsx"],
    exclude: [...configDefaults.exclude, "**/worker-contracts-db.test.ts", "**/canvas-contracts-db.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "./src/tests/setup/server-only.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
