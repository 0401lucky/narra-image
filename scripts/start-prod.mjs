import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { terminateProcessTree } from "./lib/command-runner.mjs";
import { describeError, parsePositiveInteger, prepareDatabase } from "./lib/migration-runtime.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const NEXT_BIN = path.join(
  PROJECT_ROOT,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`布尔配置值无效：${value}`);
}

export function loadSupervisorConfig(env = process.env) {
  return {
    embeddedWorkerEnabled: parseBoolean(env.ENABLE_EMBEDDED_WORKER, true),
    workerCommand: env.WORKER_COMMAND?.trim() || "./narra-worker",
    workerReadyDeadlineMs: parsePositiveInteger(
      env.WORKER_READY_TIMEOUT_MS,
      60_000,
      "WORKER_READY_TIMEOUT_MS",
    ),
    workerReadinessRequestTimeoutMs: parsePositiveInteger(
      env.WORKER_READINESS_TIMEOUT_MS,
      2_000,
      "WORKER_READINESS_TIMEOUT_MS",
    ),
    workerReadinessRequired: parseBoolean(
      env.WORKER_READINESS_REQUIRED,
      true,
    ),
    workerReadyPollIntervalMs: parsePositiveInteger(
      env.WORKER_READY_POLL_INTERVAL_MS,
      1_000,
      "WORKER_READY_POLL_INTERVAL_MS",
    ),
    workerShutdownHardTimeoutSeconds: parsePositiveInteger(
      env.WORKER_SHUTDOWN_HARD_TIMEOUT_SECONDS,
      10,
      "WORKER_SHUTDOWN_HARD_TIMEOUT_SECONDS",
    ),
    workerInternalUrl: env.WORKER_INTERNAL_URL?.trim() || "",
    workerHttpAddr: env.WORKER_HTTP_ADDR?.trim() || "127.0.0.1:8081",
  };
}

export function getWorkerReadyUrl(config) {
  if (config.workerInternalUrl) {
    return new URL("/readyz", `${config.workerInternalUrl.replace(/\/$/, "")}/`).toString();
  }

  const portMatch = config.workerHttpAddr.match(/:(\d+)$/);
  if (!portMatch) {
    throw new Error("WORKER_HTTP_ADDR 必须包含有效端口");
  }
  return `http://127.0.0.1:${portMatch[1]}/readyz`;
}

async function readReadyPayload(response) {
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== "object") return {};
    return payload;
  } catch {
    return {};
  }
}

export async function waitForWorkerReady(
  child,
  config,
  options = {},
) {
  if (!config.workerReadinessRequired) {
    console.warn("[supervisor] WORKER_READINESS_REQUIRED=false，跳过 Worker ready gate");
    return;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const readyUrl = getWorkerReadyUrl(config);
  const deadlineAt = Date.now() + config.workerReadyDeadlineMs;
  let checks = 0;
  let lastStatus = "尚未响应";

  console.log(`[supervisor] 等待 embedded Worker readyz：${readyUrl}`);
  while (Date.now() < deadlineAt) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("embedded Worker 在 ready 前已退出");
    }

    checks += 1;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      config.workerReadinessRequestTimeoutMs,
    );
    try {
      const response = await fetchImpl(readyUrl, {
        cache: "no-store",
        method: "GET",
        signal: controller.signal,
      });
      const payload = await readReadyPayload(response);
      if (response.status === 200 && payload.status === "ready") {
        console.log(
          `[supervisor] embedded Worker 已就绪，checks=${checks}`,
        );
        return;
      }
      lastStatus = `HTTP ${response.status} code=${payload.code ?? "UNKNOWN"}`;
    } catch (error) {
      lastStatus = error?.name === "AbortError" ? "请求超时" : describeError(error);
    } finally {
      clearTimeout(timer);
    }

    await sleep(config.workerReadyPollIntervalMs);
  }

  throw new Error(
    `embedded Worker 未在 ${config.workerReadyDeadlineMs}ms 内 ready：${lastStatus}`,
  );
}

function createSupervisor(hardTimeoutMs) {
  const children = new Set();
  let shuttingDown = false;
  let resolveFinished;
  let hardStopTimer = null;
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });

  const finishIfDone = () => {
    if (shuttingDown && children.size === 0) {
      if (hardStopTimer) clearTimeout(hardStopTimer);
      resolveFinished();
    }
  };

  const shutdown = (skipChild = null) => {
    if (!shuttingDown) shuttingDown = true;
    for (const child of children) {
      if (child === skipChild || child.killed) continue;
      child.kill("SIGTERM");
    }
    if (!hardStopTimer && children.size > 0) {
      hardStopTimer = setTimeout(() => {
        console.error(
          `[supervisor] 子进程未在 hard-stop ${hardTimeoutMs}ms 内退出，终止进程树`,
        );
        process.exitCode = 1;
        for (const child of children) terminateProcessTree(child);
      }, hardTimeoutMs);
    }
    finishIfDone();
  };

  const start = (label, executable, args = [], env = process.env) => {
    const child = spawn(executable, args, {
      cwd: PROJECT_ROOT,
      env,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    children.add(child);

    child.once("error", (error) => {
      console.error(`[supervisor] ${label} 启动失败：${describeError(error)}`);
      process.exitCode = 1;
      children.delete(child);
      shutdown(child);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (!shuttingDown) {
        console.error(
          `[supervisor] ${label} 意外退出：${signal ? `signal=${signal}` : `exit_code=${code ?? 1}`}`,
        );
        process.exitCode = code === 0 ? 1 : (code ?? 1);
        shutdown(child);
      }
      finishIfDone();
    });
    return child;
  };

  return {
    start,
    shutdown,
    finished,
    get shuttingDown() {
      return shuttingDown;
    },
  };
}

export async function main(options = {}) {
  const env = options.env ?? process.env;
  const config = loadSupervisorConfig(env);
  await (options.prepareDatabase ?? prepareDatabase)({
    databaseUrl: env.DATABASE_URL,
    env,
  });

  const supervisor = createSupervisor(
    config.workerShutdownHardTimeoutSeconds * 1_000,
  );
  const stop = () => supervisor.shutdown();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  if (config.embeddedWorkerEnabled) {
    const workerEnv = {
      ...env,
      WORKER_RUNTIME_MODE: "embedded",
      WORKER_HTTP_ADDR: config.workerHttpAddr,
      WORKER_SHUTDOWN_HARD_TIMEOUT_SECONDS: String(
        config.workerShutdownHardTimeoutSeconds,
      ),
    };
    const worker = supervisor.start(
      "embedded Worker",
      config.workerCommand,
      [],
      workerEnv,
    );
    try {
      await (options.waitForWorkerReady ?? waitForWorkerReady)(worker, config);
    } catch (error) {
      console.error(`[supervisor] embedded Worker 启动失败：${describeError(error)}`);
      process.exitCode = 1;
      supervisor.shutdown();
      await supervisor.finished;
      return process.exitCode;
    }
  } else {
    console.log("[supervisor] embedded Worker 已禁用");
  }

  if (!supervisor.shuttingDown) {
    supervisor.start("Next.js", process.execPath, [NEXT_BIN, "start"], env);
  }
  await supervisor.finished;
  return process.exitCode ?? 0;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
