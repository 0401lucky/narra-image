import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(__dirname, "../../../..");

export default defineConfig({
  root,
  envDir: false,
  test: {
    environment: "node",
    globals: true,
    include: ["src/tests/integration/canvas-contracts/canvas-contracts-db.test.ts", "src/tests/integration/canvas-contracts/image-storage-db.test.ts", "src/tests/integration/canvas-contracts/image-retention-db.test.ts", "src/tests/integration/canvas-contracts/image-history-db.test.ts"],
    exclude: [],
    fileParallelism: false,
    maxWorkers: 1,
    setupFiles: [path.join(root, "src/tests/setup/vitest.setup.ts")],
  },
  resolve: { alias: { "server-only": path.join(root, "src/tests/setup/server-only.ts"), "@": path.join(root, "src") } },
});
