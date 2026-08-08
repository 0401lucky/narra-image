import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runCommand, TIMEOUT_EXIT_CODE } from "../lib/command-runner.mjs";
import { prepareDatabase } from "../lib/migration-runtime.mjs";
import {
  getWorkerReadyUrl,
  loadSupervisorConfig,
  waitForWorkerReady,
} from "../start-prod.mjs";

test("普通数据库准备只执行 migrate deploy 与 migrate status", async () => {
  const calls = [];
  await prepareDatabase({
    databaseUrl: "postgresql://test:test@127.0.0.1:5432/disposable",
    waitForDatabase: async () => {
      calls.push(["wait"]);
    },
    checkMigrationHistory: async () => {
      calls.push(["preflight"]);
    },
    runCommand: async (command) => {
      calls.push(command.args.slice(-2));
      return {
        code: 0,
        signal: null,
        timedOut: false,
        durationMs: 1,
        stdout: "",
        stderr: "",
      };
    },
  });

  assert.deepEqual(calls, [
    ["wait"],
    ["preflight"],
    ["migrate", "deploy"],
    ["migrate", "status"],
  ]);
});

test("生产启动源码不包含自动 db push、resolve 或 repair", async () => {
  const source = await readFile(new URL("../start-prod.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bdb\s*["']?,?\s*["']push\b/i);
  assert.doesNotMatch(source, /migrate["']?,?\s*["']resolve/i);
  assert.doesNotMatch(source, /repairFailedMigration|resolveAllMigrationsAsApplied/);
});

test("embedded supervisor 使用 readyz，且区分总截止与单次请求超时", async () => {
  const config = loadSupervisorConfig({
    ENABLE_EMBEDDED_WORKER: "true",
    WORKER_INTERNAL_URL: "http://127.0.0.1:19081/internal/",
    WORKER_READY_TIMEOUT_MS: "60000",
    WORKER_READINESS_TIMEOUT_MS: "2000",
    WORKER_READINESS_REQUIRED: "true",
    WORKER_READY_POLL_INTERVAL_MS: "250",
    WORKER_SHUTDOWN_HARD_TIMEOUT_SECONDS: "10",
  });
  assert.equal(config.workerReadyDeadlineMs, 60_000);
  assert.equal(config.workerReadinessRequestTimeoutMs, 2_000);
  assert.equal(config.workerReadinessRequired, true);
  assert.equal(config.workerReadyPollIntervalMs, 250);
  assert.equal(config.workerShutdownHardTimeoutSeconds, 10);
  assert.equal(
    getWorkerReadyUrl(config),
    "http://127.0.0.1:19081/readyz",
  );

  const child = { exitCode: null, signalCode: null };
  let requestedUrl = "";
  await waitForWorkerReady(child, config, {
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ status: "ready" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    sleep: async () => {},
  });
  assert.equal(requestedUrl, "http://127.0.0.1:19081/readyz");
});

test("共享命令 runner 保留退出码并终止超时命令", async () => {
  const failed = await runCommand({
    executable: process.execPath,
    args: ["-e", "process.exit(7)"],
    capture: true,
    timeoutMs: 2_000,
  });
  assert.equal(failed.code, 7);
  assert.equal(failed.timedOut, false);

  const timedOut = await runCommand({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    capture: true,
    timeoutMs: 100,
  });
  assert.equal(timedOut.code, TIMEOUT_EXIT_CODE);
  assert.equal(timedOut.timedOut, true);
});
