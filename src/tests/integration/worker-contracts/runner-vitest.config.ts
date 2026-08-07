import path from "node:path";
import { defineConfig } from "vitest/config";

const projectRoot = path.resolve(__dirname, "../../../..");

export default defineConfig({
  root: projectRoot,
  // 使用不存在的隔离目录，避免 Vite/Vitest 自动读取项目 .env 文件。
  envDir: path.join(__dirname, ".runner-empty-env"),
  test: {
    environment: "node",
    globals: true,
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
