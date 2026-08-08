#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertFixedTargets,
  runStages,
  TIMEOUT_EXIT_CODE,
} from "./lib/command-runner.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const GLOBAL_DEADLINE_MS = 20 * 60_000;
const UNIT_PROCESS_TIMEOUT_MS = 57_000;

const FIXED_TARGETS = [
  "package.json",
  "scripts/tests/migration-safety.test.mjs",
  "scripts/tests/release-startup.test.mjs",
  "scripts/verify-worker-contracts.mjs",
  "scripts/verify-gateway.mjs",
  "src/tests/contracts/generation-contract.test.ts",
  "worker/internal/worker/contract_test.go",
  "worker/cmd/rollback-preflight/main_test.go",
];

const STAGES = [
  {
    label: "发布脚本 Node 单测",
    executable: process.execPath,
    args: [
      "--test",
      "scripts/tests/migration-safety.test.mjs",
      "scripts/tests/release-startup.test.mjs",
    ],
    timeoutMs: UNIT_PROCESS_TIMEOUT_MS,
  },
  {
    label: "TypeScript 类型检查",
    executable: "pnpm",
    args: ["exec", "tsc", "--noEmit"],
    timeoutMs: 120_000,
  },
  {
    label: "ESLint",
    executable: "pnpm",
    args: ["lint"],
    timeoutMs: 180_000,
  },
  {
    label: "Vitest 全量单测",
    executable: "pnpm",
    args: [
      "exec",
      "vitest",
      "run",
      "--reporter=dot",
      "--testTimeout=30000",
      "--exclude",
      "src/tests/integration/worker-contracts/worker-contracts-db.test.ts",
    ],
    // 全量组件/单测进程独立截止；单个用例由 --testTimeout=30000 兜底。
    // DB 集成测试由 verify:worker-contracts:db 单独覆盖，不在此重复。
    timeoutMs: 300_000,
  },
  {
    label: "Worker TypeScript 契约",
    executable: "pnpm",
    args: ["verify:worker-contracts:ts"],
    timeoutMs: 65_000,
  },
  {
    label: "Worker Go 契约",
    executable: "pnpm",
    args: ["verify:worker-contracts:go"],
    timeoutMs: 65_000,
  },
  {
    label: "Go 全量测试",
    executable: "go",
    args: ["-C", "worker", "test", "-count=1", "-timeout=50s", "./..."],
    timeoutMs: UNIT_PROCESS_TIMEOUT_MS,
  },
  {
    label: "Go 全量构建",
    executable: "go",
    args: ["-C", "worker", "build", "./..."],
    timeoutMs: 180_000,
  },
  {
    label: "Next.js 生产构建",
    executable: "pnpm",
    args: ["build"],
    timeoutMs: 600_000,
  },
];

export async function main() {
  try {
    assertFixedTargets(PROJECT_ROOT, FIXED_TARGETS, "verify:ci");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const exitCode = await runStages(STAGES, {
    cwd: PROJECT_ROOT,
    deadlineMs: GLOBAL_DEADLINE_MS,
    env: { ...process.env, CI: "1" },
    scope: "verify:ci",
  });
  return exitCode === TIMEOUT_EXIT_CODE ? TIMEOUT_EXIT_CODE : exitCode;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
