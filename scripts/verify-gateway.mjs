#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertFixedTargets,
  runStages,
  TIMEOUT_EXIT_CODE,
} from "./lib/command-runner.mjs";

const GLOBAL_DEADLINE_MS = 57_000;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const verificationModes = {
  ts: {
    targets: [
      "src/tests/contracts/gateway-contract.test.ts",
      "src/tests/unit/gateway-client.test.ts",
      "src/tests/unit/external-v1-routes.test.ts",
    ],
    commands: [
      {
        executable: "pnpm",
        args: [
          "exec",
          "vitest",
          "run",
          "src/tests/contracts/gateway-contract.test.ts",
          "src/tests/unit/gateway-client.test.ts",
          "src/tests/unit/external-v1-routes.test.ts",
          "--reporter=dot",
          "--testTimeout=15000",
        ],
      },
    ],
  },
  go: {
    targets: [
      "worker/internal/worker/gateway.go",
      "worker/internal/worker/gateway_test.go",
      "worker/internal/worker/gateway_db_test.go",
    ],
    commands: [
      { executable: "go", args: ["-C", "worker", "vet", "./..."] },
      {
        executable: "go",
        args: [
          "-C",
          "worker",
          "test",
          "-count=1",
          "-timeout=50s",
          "./internal/worker/...",
        ],
      },
    ],
  },
  db: {
    targets: ["src/tests/integration/worker-contracts/postgres-runner.ts"],
    commands: [
      {
        executable: "pnpm",
        args: [
          "exec",
          "tsx",
          "src/tests/integration/worker-contracts/postgres-runner.ts",
        ],
      },
    ],
  },
};

async function main() {
  const modeName = process.argv[2];
  const mode = verificationModes[modeName];
  if (!mode || process.argv.length !== 3) {
    console.error(
      "用法: node scripts/verify-gateway.mjs <ts|go|db>",
    );
    return 1;
  }

  try {
    assertFixedTargets(projectRoot, mode.targets, "gateway");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const exitCode = await runStages(mode.commands, {
    cwd: projectRoot,
    deadlineMs: GLOBAL_DEADLINE_MS,
    scope: "gateway",
  });
  return exitCode === TIMEOUT_EXIT_CODE ? TIMEOUT_EXIT_CODE : exitCode;
}

process.exitCode = await main();
