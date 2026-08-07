#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GLOBAL_DEADLINE_MS = 57_000;
const TIMEOUT_EXIT_CODE = 124;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const verificationModes = {
  ts: {
    targets: [
      "src/tests/contracts/generation-contract.test.ts",
      "src/tests/integration/worker-contracts/worker-contracts.test.ts",
      "src/tests/unit/external-generation-service.test.ts",
      "src/tests/unit/job-refund.test.ts",
      "src/tests/unit/generation-cancel-route.test.ts",
    ],
    commands: [
      {
        executable: "pnpm",
        args: [
          "exec",
          "vitest",
          "run",
          "src/tests/contracts/generation-contract.test.ts",
          "src/tests/integration/worker-contracts/worker-contracts.test.ts",
          "src/tests/unit/external-generation-service.test.ts",
          "src/tests/unit/job-refund.test.ts",
          "src/tests/unit/generation-cancel-route.test.ts",
          "--reporter=dot",
          "--testTimeout=15000",
        ],
      },
    ],
  },
  go: {
    targets: [
      "worker/internal/worker/contract_test.go",
      "worker/internal/worker/worker_contracts_integration_test.go",
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

function formatCommand(command) {
  return [command.executable, ...command.args].join(" ");
}

function terminateProcessTree(child) {
  if (!child.pid) return;

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  const forceKillTimer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 750);
  forceKillTimer.unref();
}

function spawnFixedCommand(command, remainingMs) {
  const isWindowsPnpm =
    process.platform === "win32" && command.executable === "pnpm";
  const executable = isWindowsPnpm
    ? (process.env.ComSpec || "cmd.exe")
    : command.executable;
  const args = isWindowsPnpm
    ? ["/d", "/s", "/c", formatCommand(command)]
    : command.args;

  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: projectRoot,
      detached: process.platform !== "win32",
      env: process.env,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });

    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(
        `[worker-contracts] 全局截止时间已到，终止子进程树 PID=${child.pid ?? "unknown"}: ${formatCommand(command)}`,
      );
      terminateProcessTree(child);
    }, remainingMs);

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(exitCode);
    };

    child.once("error", (error) => {
      console.error(
        `[worker-contracts] 无法启动命令 ${formatCommand(command)}: ${error.message}`,
      );
      finish(1);
    });
    child.once("exit", (code, signal) => {
      if (timedOut) {
        finish(TIMEOUT_EXIT_CODE);
        return;
      }
      if (typeof code === "number") {
        finish(code);
        return;
      }
      console.error(
        `[worker-contracts] 命令被信号 ${signal ?? "unknown"} 终止: ${formatCommand(command)}`,
      );
      finish(1);
    });
  });
}

async function main() {
  const modeName = process.argv[2];
  const mode = verificationModes[modeName];
  if (!mode || process.argv.length !== 3) {
    console.error(
      "用法: node scripts/verify-worker-contracts.mjs <ts|go|db>",
    );
    return 1;
  }

  const missingTargets = mode.targets.filter(
    (target) => !existsSync(path.join(projectRoot, target)),
  );
  if (missingTargets.length > 0) {
    console.error("[worker-contracts] 缺少固定验证目标，拒绝假绿：");
    for (const target of missingTargets) console.error(`  - ${target}`);
    return 1;
  }

  const deadlineAt = Date.now() + GLOBAL_DEADLINE_MS;
  for (const command of mode.commands) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      console.error("[worker-contracts] 启动下一条命令前已超过全局截止时间。");
      return TIMEOUT_EXIT_CODE;
    }

    console.log(`[worker-contracts] 执行: ${formatCommand(command)}`);
    const exitCode = await spawnFixedCommand(command, remainingMs);
    if (exitCode !== 0) return exitCode;
  }

  return 0;
}

process.exitCode = await main();
