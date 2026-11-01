import path from "node:path";
import { defineConfig } from "vitest/config";

const projectRoot = path.resolve(__dirname, "../../../..");

export default defineConfig({
  root: projectRoot,
  // 使用不存在的隔离目录，避免 Vite/Vitest 自动读取项目 .env 文件。
  envDir: false,
  test: {
    environment: "node",
    globals: true,
    include: ["src/tests/integration/worker-contracts/worker-contracts-db.test.ts"],
    exclude: [],
    setupFiles: [path.join(projectRoot, "src/tests/setup/vitest.setup.ts")],
  },
  resolve: {
    alias: {
      "server-only": path.join(
        projectRoot,
        "src/tests/setup/server-only.ts",
      ),
      "@": path.join(projectRoot, "src"),
    },
  },
});
