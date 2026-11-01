import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(__dirname, "../../../..");

export default defineConfig({
  root,
  envDir: false,
  test: {
    environment: "node",
    globals: true,
    include: ["src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts"],
    exclude: [],
    fileParallelism: false,
    setupFiles: [path.join(root, "src/tests/setup/vitest.setup.ts")],
  },
  resolve: { alias: { "server-only": path.join(root, "src/tests/setup/server-only.ts"), "@": path.join(root, "src") } },
});
