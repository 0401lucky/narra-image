#!/usr/bin/env node

import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  assertFixedTargets,
  runStage,
} from "./lib/command-runner.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const COMPOSE_FILE = path.join(PROJECT_ROOT, "docker-compose.e2e.yml");
const GLOBAL_DEADLINE_MS = 30 * 60_000;
const CLEANUP_RESERVE_MS = 20_000;
const BUILD_APP_TIMEOUT_MS = 600_000;
const BUILD_WORKER_TIMEOUT_MS = 300_000;
const WAIT_UP_TIMEOUT_SECONDS = 150;
const WAIT_DEDICATED_UP_TIMEOUT_SECONDS = 210;

const EXIT = Object.freeze({
  success: 0,
  preflight: 2,
  build: 3,
  embedded: 4,
  dedicated: 5,
  conflict: 6,
  schema: 7,
  db: 8,
  propagate: 9,
  cleanup: 10,
});

const E2E_OWNER_TOKEN =
  process.env.E2E_OWNER_TOKEN?.trim() || randomUUID();
const E2E_AUTH_SECRET =
  process.env.E2E_AUTH_SECRET?.trim() ||
  randomBytes(32).toString("base64url");
const E2E_METRICS_TOKEN =
  process.env.E2E_METRICS_TOKEN?.trim() ||
  randomBytes(24).toString("base64url");
const E2E_DATABASE_PASSWORD =
  process.env.E2E_DATABASE_PASSWORD?.trim() ||
  `Narra:@#?/${randomBytes(12).toString("base64url")}`;
const E2E_DATABASE_USER = process.env.E2E_DATABASE_USER?.trim() || "narra_e2e";
const APP_IMAGE =
  process.env.E2E_APP_IMAGE?.trim() ||
  `narra-e2e-app:${randomBytes(4).toString("hex")}`;
const WORKER_IMAGE =
  process.env.E2E_WORKER_IMAGE?.trim() ||
  `narra-e2e-worker:${randomBytes(4).toString("hex")}`;
const SKIP_BUILD = process.env.E2E_SKIP_BUILD === "1";
const KEEP_IMAGES = process.env.E2E_KEEP_IMAGES === "1";

function failure(exitCode, message) {
  return Object.assign(new Error(message), { exitCode });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function printCaptured(result) {
  if (result.stdout?.trim()) console.error(result.stdout.trim());
  if (result.stderr?.trim()) console.error(result.stderr.trim());
}

function scenarioProject(label) {
  return {
    name: `narra-e2e-${label}-${randomBytes(4).toString("hex")}`,
    label,
  };
}

function assertSafeProjectName(name) {
  if (
    !name.startsWith("narra-e2e-") ||
    !/^[a-z0-9][a-z0-9_-]+$/.test(name) ||
    name.length > 63
  ) {
    throw failure(EXIT.preflight, `E2E project 名不满足安全约束：${name}`);
  }
}

function baseEnvironment() {
  return {
    ...process.env,
    E2E_OWNER_TOKEN,
    E2E_AUTH_SECRET,
    E2E_METRICS_TOKEN,
    E2E_DATABASE_USER,
    E2E_DATABASE_PASSWORD,
    E2E_APP_IMAGE: APP_IMAGE,
    E2E_WORKER_IMAGE: WORKER_IMAGE,
  };
}

function databaseEnvironment(databaseName) {
  const encodedPassword = encodeURIComponent(E2E_DATABASE_PASSWORD);
  const databaseUrl = `postgresql://${E2E_DATABASE_USER}:${encodedPassword}@db:5432/${databaseName}?schema=public&connect_timeout=3`;
  return {
    ...baseEnvironment(),
    E2E_POSTGRES_DB: databaseName,
    E2E_POSTGRES_USER: E2E_DATABASE_USER,
    E2E_POSTGRES_PASSWORD: E2E_DATABASE_PASSWORD,
    E2E_DATABASE_URL: databaseUrl,
  };
}

function composeArgs(project, args) {
  return [
    "compose",
    "-f",
    COMPOSE_FILE,
    "--project-name",
    project.name,
    ...args,
  ];
}

async function runCompose(project, args, options = {}) {
  if (project) assertSafeProjectName(project.name);
  return runStage(
    {
      label: options.label,
      executable: "docker",
      args: composeArgs(project, args),
      cwd: PROJECT_ROOT,
      env: options.env ?? project?.env ?? baseEnvironment(),
      capture: options.capture ?? false,
      timeoutMs: options.timeoutMs,
    },
    {
      scope: options.scope ?? "verify:e2e",
      deadlineAt: options.deadlineAt,
    },
  );
}

async function runComposeChecked(project, args, options = {}) {
  const result = await runCompose(project, args, options);
  if (result.code === 0) return result;
  printCaptured(result);
  throw failure(
    options.exitCode ?? EXIT.preflight,
    `${options.label} 失败（退出码 ${result.code}）`,
  );
}

async function runComposeExpectedFailure(project, args, options = {}) {
  const result = await runCompose(project, args, {
    ...options,
    capture: true,
  });
  if (result.code !== 0) return result;
  throw failure(
    options.exitCode ?? EXIT.preflight,
    `${options.label} 意外成功，拒绝假绿`,
  );
}

async function composePort(project, service, containerPort, options) {
  const result = await runCompose(
    project,
    ["port", service, String(containerPort)],
    { ...options, label: `查询 ${service} 宿主端口`, capture: true },
  );
  if (result.code !== 0) {
    printCaptured(result);
    throw failure(options.exitCode ?? EXIT.preflight, `${service} 动态端口查询失败`);
  }
  return result.stdout.trim();
}

async function composePs(project, service, options) {
  const serviceArgs = service ? [service] : [];
  const result = await runCompose(
    project,
    ["ps", "-a", "-q", ...serviceArgs],
    { ...options, label: `列出 ${service || "project"} 容器`, capture: true },
  );
  if (result.code !== 0) {
    printCaptured(result);
    throw failure(options.exitCode ?? EXIT.preflight, `${service} 容器列表失败`);
  }
  return result.stdout.trim().split(/\s+/).filter(Boolean);
}

async function composeExec(project, service, command, options) {
  const indexArgs = options.execIndex ? ["--index", String(options.execIndex)] : [];
  return runCompose(
    project,
    ["exec", "-T", ...indexArgs, service, ...command],
    { ...options, label: `exec ${service}`, capture: true },
  );
}

async function composeLogs(project, service, options) {
  const result = await runCompose(
    project,
    ["logs", service],
    { ...options, label: `读取 ${service} 日志`, capture: true },
  );
  return `${result.stdout}\n${result.stderr}`;
}

async function containerState(project, service, options) {
  const ids = await composePs(project, service, options);
  if (ids.length === 0) return { status: "missing", exitCode: null };
  const result = await runStage(
    {
      label: `读取 ${service} 容器状态`,
      executable: "docker",
      args: [
        "inspect",
        "--format",
        "{{.State.Status}} {{.State.ExitCode}}",
        ids[0],
      ],
      capture: true,
      timeoutMs: 10_000,
    },
    { scope: "verify:e2e", deadlineAt: options.deadlineAt },
  );
  const [status, exitCodeText] = result.stdout.trim().split(/\s+/);
  return {
    status,
    exitCode: exitCodeText === undefined ? null : Number(exitCodeText),
  };
}

async function waitForContainerExited(
  project,
  service,
  options,
) {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const deadlineAt = Math.min(
    options.deadlineAt ?? Number.POSITIVE_INFINITY,
    Date.now() + timeoutMs,
  );
  let lastState = "容器尚未退出";
  while (Date.now() < deadlineAt) {
    const state = await containerState(project, service, options);
    if (state.status === "exited" || state.status === "dead") {
      return state.exitCode ?? 1;
    }
    if (state.status === "missing") {
      lastState = "容器缺失";
    } else {
      lastState = `status=${state.status}`;
    }
    await delay(500);
  }
  throw failure(
    options.exitCode ?? EXIT.preflight,
    `${service} 未在 ${timeoutMs}ms 内退出：${lastState}`,
  );
}

async function waitForHttp(url, options) {
  const expectReady = options.expectReady ?? true;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const pollMs = options.pollMs ?? 750;
  const deadlineAt = Math.min(
    options.deadlineAt ?? Number.POSITIVE_INFINITY,
    Date.now() + timeoutMs,
  );
  let lastStatus = "尚未响应";
  let targetUrl = url;
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `http://${targetUrl}`;
  }
  while (Date.now() < deadlineAt) {
    try {
      const response = await fetch(targetUrl, {
        cache: "no-store",
        method: "GET",
        signal: AbortSignal.timeout(3_000),
      });
      const payload = await response.json().catch(() => ({}));
      const ready = response.status === 200 && payload.status === "ready";
      const notReady =
        response.status === 503 && payload.status === "not_ready";
      if (expectReady && ready) {
        console.log(`[verify:e2e] ${options.label ?? url} 已 ready`);
        return payload;
      }
      if (!expectReady && (notReady || response.status >= 500)) {
        console.log(`[verify:e2e] ${options.label ?? url} 已 not_ready`);
        return payload;
      }
      lastStatus = `HTTP ${response.status} status=${payload.status ?? "?"} code=${payload.code ?? "-"}`;
    } catch (error) {
      lastStatus = error?.name === "TimeoutError" ? "请求超时" : String(error?.message ?? error);
    }
    await delay(pollMs);
  }
  throw failure(
    options.exitCode ?? EXIT.preflight,
    `${options.label ?? url} 未在 ${timeoutMs}ms 内达到 ${expectReady ? "ready" : "not_ready"}：${lastStatus}`,
  );
}

async function waitForWorkerReadyz(project, options) {
  const expectReady = options.expectReady ?? true;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const pollMs = options.pollMs ?? 750;
  const deadlineAt = Math.min(
    options.deadlineAt ?? Number.POSITIVE_INFINITY,
    Date.now() + timeoutMs,
  );
  let lastStatus = "尚未响应";
  while (Date.now() < deadlineAt) {
    // dedicated 场景可能扩容到多个 Worker 副本，固定命中第一个副本。
    const result = await composeExec(
      project,
      "worker",
      ["wget", "-qO-", "http://127.0.0.1:8081/readyz"],
      { ...options, capture: true, execIndex: 1 },
    );
    if (result.code === 0) {
      let payload = {};
      try {
        payload = JSON.parse(result.stdout.trim() || "{}");
      } catch {
        payload = {};
      }
      const ready = payload.status === "ready";
      if (expectReady && ready) {
        console.log("[verify:e2e] dedicated Worker 已 ready");
        return payload;
      }
      if (!expectReady && payload.status === "not_ready") {
        console.log("[verify:e2e] dedicated Worker 已 not_ready");
        return payload;
      }
      lastStatus = `status=${payload.status ?? "?"} code=${payload.code ?? "-"}`;
    } else if (!expectReady) {
      console.log("[verify:e2e] dedicated Worker 已不可达（视为 not_ready）");
      return { status: "not_ready", code: "UNREACHABLE" };
    } else {
      lastStatus = `exec 失败（退出码 ${result.code}）`;
    }
    await delay(pollMs);
  }
  throw failure(
    options.exitCode ?? EXIT.preflight,
    `dedicated Worker 未在 ${timeoutMs}ms 内达到 ${expectReady ? "ready" : "not_ready"}：${lastStatus}`,
  );
}

async function assertEmbeddedTopologyReady(project, options) {
  const port = await composePort(project, "embedded", 3000, options);
  await waitForHttp(`${port}/api/readyz`, {
    ...options,
    label: "embedded app readyz",
    expectReady: true,
  });
  const logs = await composeLogs(project, "embedded", options);
  if (!/runtime_mode["=: ]+embedded/.test(logs) && !logs.includes("embedded")) {
    throw failure(
      EXIT.embedded,
      "embedded 日志未体现 embedded 运行模式",
    );
  }
  if (!logs.includes("topology_lock_acquired")) {
    throw failure(EXIT.embedded, "embedded Worker 未记录拓扑锁获取事件");
  }
}

async function assertDedicatedTopologyReady(project, options) {
  const port = await composePort(project, "app", 3000, options);
  await waitForHttp(`${port}/api/readyz`, {
    ...options,
    label: "dedicated app readyz",
    expectReady: true,
  });
  await waitForWorkerReadyz(project, { ...options, expectReady: true });
  const workerIds = await composePs(project, "worker", options);
  if (workerIds.length < 2) {
    throw failure(
      EXIT.dedicated,
      `dedicated Worker 副本数 ${workerIds.length}，预期至少 2`,
    );
  }
}

async function buildImages(options) {
  if (SKIP_BUILD) {
    console.log("[verify:e2e] E2E_SKIP_BUILD=1，跳过镜像构建");
    return;
  }
  const appResult = await runStage(
    {
      label: "构建根镜像（app/embedded/migrate 共用）",
      executable: "docker",
      args: ["build", "-f", "Dockerfile", "-t", APP_IMAGE, "."],
      cwd: PROJECT_ROOT,
      capture: false,
      timeoutMs: BUILD_APP_TIMEOUT_MS,
    },
    { scope: "verify:e2e", deadlineAt: options.deadlineAt },
  );
  if (appResult.code !== 0) {
    throw failure(EXIT.build, `根镜像构建失败（退出码 ${appResult.code}）`);
  }
  const workerResult = await runStage(
    {
      label: "构建独立 Worker 镜像",
      executable: "docker",
      args: ["build", "-f", "worker/Dockerfile", "-t", WORKER_IMAGE, "."],
      cwd: PROJECT_ROOT,
      capture: false,
      timeoutMs: BUILD_WORKER_TIMEOUT_MS,
    },
    { scope: "verify:e2e", deadlineAt: options.deadlineAt },
  );
  if (workerResult.code !== 0) {
    throw failure(EXIT.build, `Worker 镜像构建失败（退出码 ${workerResult.code}）`);
  }
}

async function scenarioEmbedded(projects, options) {
  const project = scenarioProject("embedded");
  projects.push(project);
  const env = databaseEnvironment("narra_e2e_embedded");
  project.env = env;
  await runComposeChecked(
    project,
    [
      "--profile",
      "embedded",
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      String(WAIT_UP_TIMEOUT_SECONDS),
      "db",
      "embedded",
    ],
    { ...options, env, label: "启动 embedded 拓扑并等待 ready", exitCode: EXIT.embedded },
  );
  await assertEmbeddedTopologyReady(project, { ...options, exitCode: EXIT.embedded });

  await runComposeChecked(
    project,
    ["stop", "-t", "30", "embedded"],
    { ...options, env, label: "SIGTERM 停止 embedded（30s grace）", exitCode: EXIT.embedded },
  );
  const state = await containerState(project, "embedded", options);
  if (state.status !== "exited" || state.exitCode !== 0) {
    throw failure(
      EXIT.embedded,
      `embedded SIGTERM 后未优雅退出：status=${state.status} exit_code=${state.exitCode}`,
    );
  }
  console.log("[verify:e2e] 场景 embedded（启动 + SIGTERM 优雅停止）通过");
}

async function scenarioDedicated(projects, options) {
  const project = scenarioProject("dedicated");
  projects.push(project);
  const env = databaseEnvironment("narra_e2e_dedicated");
  project.env = env;
  await runComposeChecked(
    project,
    [
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      String(WAIT_DEDICATED_UP_TIMEOUT_SECONDS),
      "--scale",
      "worker=2",
      "db",
      "migrate",
      "worker",
      "app",
    ],
    { ...options, env, label: "启动 dedicated 拓扑（2 个 Worker）并等待 ready", exitCode: EXIT.dedicated },
  );
  await assertDedicatedTopologyReady(project, { ...options, exitCode: EXIT.dedicated });
  const workerLogs = await composeLogs(project, "worker", options);
  if (workerLogs.includes("worker_exit_failed") || workerLogs.includes("拓扑冲突")) {
    throw failure(EXIT.dedicated, "dedicated Worker 日志出现冲突/退出事件");
  }
  console.log("[verify:e2e] 场景 dedicated（含 2 Worker 扩容）通过");
}

async function scenarioConflict(projects, options) {
  const project = scenarioProject("conflict");
  projects.push(project);
  const env = databaseEnvironment("narra_e2e_conflict");
  project.env = env;
  await runComposeChecked(
    project,
    [
      "--profile",
      "embedded",
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      String(WAIT_UP_TIMEOUT_SECONDS),
      "db",
      "embedded",
    ],
    { ...options, env, label: "启动持有 exclusive 锁的 embedded 拓扑", exitCode: EXIT.conflict },
  );
  await assertEmbeddedTopologyReady(project, { ...options, exitCode: EXIT.conflict });

  await runCompose(
    project,
    ["--profile", "conflict", "up", "-d", "embedded_conflict"],
    { ...options, env, label: "启动第二个 embedded（应拓扑冲突）" },
  );
  const conflictExit = await waitForContainerExited(project, "embedded_conflict", {
    ...options,
    exitCode: EXIT.conflict,
    timeoutMs: 120_000,
  });
  if (conflictExit === 0) {
    throw failure(EXIT.conflict, "拓扑冲突的第二个 embedded 意外成功退出");
  }
  const logs = await composeLogs(project, "embedded_conflict", options);
  if (
    !logs.includes("worker_exit_failed") &&
    !logs.includes("拓扑冲突") &&
    !logs.includes("TOPOLOGY_CONFLICT")
  ) {
    throw failure(
      EXIT.conflict,
      "拓扑冲突日志缺少冲突/失败事件证据",
    );
  }

  const port = await composePort(project, "embedded", 3000, options);
  await waitForHttp(`${port}/api/readyz`, {
    ...options,
    label: "原 embedded 在冲突后仍 ready",
    expectReady: true,
    exitCode: EXIT.conflict,
  });
  console.log("[verify:e2e] 场景拓扑冲突（互斥 + 失败传播）通过");
}

async function scenarioSchemaMissing(projects, options) {
  const project = scenarioProject("schema");
  projects.push(project);
  const env = databaseEnvironment("narra_e2e_schema");
  project.env = env;
  await runComposeChecked(
    project,
    [
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      String(WAIT_DEDICATED_UP_TIMEOUT_SECONDS),
      "db",
      "migrate",
      "worker",
      "app",
    ],
    { ...options, env, label: "启动 schema 场景拓扑并等待 ready", exitCode: EXIT.schema },
  );
  const port = await composePort(project, "app", 3000, options);
  await waitForHttp(`${port}/api/readyz`, {
    ...options,
    label: "schema 场景 app 初始 ready",
    expectReady: true,
    exitCode: EXIT.schema,
  });

  await runComposeChecked(
    project,
    [
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      E2E_DATABASE_USER,
      "-d",
      "narra_e2e_schema",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
    ],
    { ...options, env, label: "清空 schema 模拟 schema 缺失", exitCode: EXIT.schema },
  );

  await waitForWorkerReadyz(project, {
    ...options,
    expectReady: false,
    exitCode: EXIT.schema,
    timeoutMs: 90_000,
  });
  await waitForHttp(`${port}/api/readyz`, {
    ...options,
    label: "schema 缺失时 app readyz",
    expectReady: false,
    exitCode: EXIT.schema,
    timeoutMs: 90_000,
  });

  await runComposeChecked(
    project,
    ["run", "--rm", "--no-deps", "-T", "migrate"],
    { ...options, env, label: "重跑 migrate deploy 恢复 schema", exitCode: EXIT.schema, timeoutMs: 120_000 },
  );
  await waitForWorkerReadyz(project, {
    ...options,
    expectReady: true,
    exitCode: EXIT.schema,
    timeoutMs: 120_000,
  });
  await waitForHttp(`${port}/api/readyz`, {
    ...options,
    label: "schema 恢复后 app readyz",
    expectReady: true,
    exitCode: EXIT.schema,
    timeoutMs: 120_000,
  });
  console.log("[verify:e2e] 场景 schema 缺失/恢复通过");
}

async function scenarioDatabaseDown(projects, options) {
  const project = scenarioProject("dbdown");
  projects.push(project);
  const env = databaseEnvironment("narra_e2e_dbdown");
  project.env = env;
  await runComposeChecked(
    project,
    [
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      String(WAIT_DEDICATED_UP_TIMEOUT_SECONDS),
      "db",
      "migrate",
      "worker",
      "app",
    ],
    { ...options, env, label: "启动 dbdown 场景拓扑并等待 ready", exitCode: EXIT.db },
  );
  const port = await composePort(project, "app", 3000, options);
  await waitForHttp(`${port}/api/readyz`, {
    ...options,
    label: "dbdown 场景 app 初始 ready",
    expectReady: true,
    exitCode: EXIT.db,
  });

  await runComposeChecked(
    project,
    ["stop", "-t", "10", "db"],
    { ...options, env, label: "停止数据库容器", exitCode: EXIT.db },
  );
  await waitForHttp(`${port}/api/readyz`, {
    ...options,
    label: "数据库断连后 app readyz",
    expectReady: false,
    exitCode: EXIT.db,
    timeoutMs: 90_000,
  });
  const workerState = await waitForContainerExited(project, "worker", {
    ...options,
    exitCode: EXIT.db,
    timeoutMs: 120_000,
  });
  if (workerState === 0) {
    throw failure(EXIT.db, "数据库断连后 Worker 意外以 0 退出（未传播锁丢失）");
  }

  await runComposeChecked(
    project,
    ["start", "db"],
    { ...options, env, label: "恢复数据库容器", exitCode: EXIT.db },
  );
  await runComposeChecked(
    project,
    [
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      String(WAIT_UP_TIMEOUT_SECONDS),
      "--force-recreate",
      "worker",
      "app",
    ],
    { ...options, env, label: "数据库恢复后重建 Worker/app", exitCode: EXIT.db },
  );
  // force-recreate 后宿主端口可能重新映射，必须重新查询。
  const recoveredPort = await composePort(project, "app", 3000, options);
  await waitForHttp(`${recoveredPort}/api/readyz`, {
    ...options,
    label: "数据库恢复后 app readyz",
    expectReady: true,
    exitCode: EXIT.db,
    timeoutMs: 120_000,
  });
  console.log("[verify:e2e] 场景数据库断连/恢复通过");
}

async function scenarioPropagation(projects, options) {
  const project = scenarioProject("propagate");
  projects.push(project);
  const env = {
    ...databaseEnvironment("narra_e2e_propagate"),
    E2E_DATABASE_URL: `postgresql://${E2E_DATABASE_USER}:${encodeURIComponent(E2E_DATABASE_PASSWORD)}@db:5432/narra_e2e_missing_db?schema=public&connect_timeout=3`,
  };
  project.env = env;
  await runComposeChecked(
    project,
    ["up", "-d", "--wait", "--wait-timeout", "60", "db"],
    { ...options, env, label: "启动 dbdown 场景数据库", exitCode: EXIT.propagate },
  );
  await runCompose(
    project,
    ["--profile", "embedded", "up", "-d", "embedded"],
    { ...options, env, label: "启动指向不存在库的 embedded" },
  );
  const exitCode = await waitForContainerExited(project, "embedded", {
    ...options,
    exitCode: EXIT.propagate,
    timeoutMs: 180_000,
  });
  if (exitCode === 0) {
    throw failure(EXIT.propagate, "migration 失败的 embedded 意外成功退出");
  }
  const logs = await composeLogs(project, "embedded", options);
  if (
    !/migration|migrate|数据库未就绪|database/i.test(logs)
  ) {
    throw failure(EXIT.propagate, "migration 失败日志缺少可诊断错误信息");
  }
  console.log("[verify:e2e] 场景失败传播（migration 失败 → supervisor 非零退出）通过");
}

async function cleanupProject(project, options) {
  if (!project) return true;
  try {
    const ids = await composePs(project, "", options);
    for (const id of ids) {
      const owner = await runStage(
        {
          label: `校验容器 owner label ${id.slice(0, 12)}`,
          executable: "docker",
          args: [
            "inspect",
            "--format",
            "{{ index .Config.Labels \"com.narra.e2e.owner\" }}",
            id,
          ],
          capture: true,
          timeoutMs: 10_000,
        },
        { scope: "verify:e2e:cleanup", deadlineAt: options.deadlineAt },
      );
      if (owner.code !== 0 || owner.stdout.trim() !== E2E_OWNER_TOKEN) {
        printCaptured(owner);
        console.error(`拒绝清理 owner 不匹配的容器：${id}`);
        return false;
      }
    }

    const down = await runCompose(
      project,
      ["down", "--volumes", "--remove-orphans", "--rmi", "local"],
      {
        ...options,
        label: `清理 project ${project.name}`,
        scope: "verify:e2e:cleanup",
      },
    );
    if (down.code !== 0) {
      printCaptured(down);
      console.error(`compose down 退出码 ${down.code}，继续执行 owner 校验的兜底清理`);
    }
    // 兜底：down 后仍残留的 profile 容器按 owner 校验强删，避免泄漏。
    const leftover = await composePs(project, "", {
      ...options,
      scope: "verify:e2e:cleanup",
    });
    for (const id of leftover) {
      const owner = await runStage(
        {
          label: `校验残留容器 owner label ${id.slice(0, 12)}`,
          executable: "docker",
          args: [
            "inspect",
            "--format",
            "{{ index .Config.Labels \"com.narra.e2e.owner\" }}",
            id,
          ],
          capture: true,
          timeoutMs: 10_000,
        },
        { scope: "verify:e2e:cleanup", deadlineAt: options.deadlineAt },
      );
      if (owner.code !== 0 || owner.stdout.trim() !== E2E_OWNER_TOKEN) {
        printCaptured(owner);
        console.error(`拒绝清理 owner 不匹配的残留容器：${id}`);
        return false;
      }
      const removed = await runStage(
        {
          label: `强制删除残留容器 ${id.slice(0, 12)}`,
          executable: "docker",
          args: ["rm", "--force", id],
          capture: true,
          timeoutMs: 30_000,
        },
        { scope: "verify:e2e:cleanup", deadlineAt: options.deadlineAt },
      );
      if (removed.code !== 0) {
        printCaptured(removed);
        return false;
      }
    }
    const remain = await composePs(project, "", {
      ...options,
      scope: "verify:e2e:cleanup",
    });
    if (remain.length !== 0) return false;

    // 兜底：profile 容器曾占用导致 down 未删干净的 project 网络。
    const networks = await runStage(
      {
        label: `列出 project 残留网络 ${project.name}`,
        executable: "docker",
        args: [
          "network",
          "ls",
          "--quiet",
          "--filter",
          `label=com.docker.compose.project=${project.name}`,
        ],
        capture: true,
        timeoutMs: 10_000,
      },
      { scope: "verify:e2e:cleanup", deadlineAt: options.deadlineAt },
    );
    if (networks.code !== 0) {
      printCaptured(networks);
      return false;
    }
    for (const networkId of networks.stdout.trim().split(/\s+/).filter(Boolean)) {
      const removed = await runStage(
        {
          label: `删除残留网络 ${networkId.slice(0, 12)}`,
          executable: "docker",
          args: ["network", "rm", networkId],
          capture: true,
          timeoutMs: 30_000,
        },
        { scope: "verify:e2e:cleanup", deadlineAt: options.deadlineAt },
      );
      if (removed.code !== 0) {
        printCaptured(removed);
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error(
      `清理 project ${project.name} 失败：${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function cleanupImages() {
  if (KEEP_IMAGES) return;
  for (const image of [APP_IMAGE, WORKER_IMAGE]) {
    if (image.includes(":")) {
      await runStage(
        {
          label: `删除 E2E 镜像 ${image}`,
          executable: "docker",
          args: ["rmi", image],
          capture: true,
          timeoutMs: 60_000,
        },
        { scope: "verify:e2e:cleanup", deadlineAt: Number.POSITIVE_INFINITY },
      );
    }
  }
}

export async function main() {
  const runnerDeadlineAt = Date.now() + GLOBAL_DEADLINE_MS;
  const workDeadlineAt = runnerDeadlineAt - CLEANUP_RESERVE_MS;
  const projects = [];
  const options = { deadlineAt: workDeadlineAt };
  let exitCode = EXIT.success;

  try {
    assertFixedTargets(
      PROJECT_ROOT,
      [
        "docker-compose.e2e.yml",
        "docker-compose.yml",
        "scripts/migrate-deploy.mjs",
        "scripts/start-prod.mjs",
      ],
      "verify:e2e",
    );

    const dockerInfo = await runStage(
      {
        label: "检查 Docker daemon",
        executable: "docker",
        args: ["info", "--format", "{{.ServerVersion}}"],
        capture: true,
        timeoutMs: 10_000,
      },
      options,
    );
    if (dockerInfo.code !== 0 || !dockerInfo.stdout.trim()) {
      printCaptured(dockerInfo);
      throw failure(EXIT.preflight, "Docker daemon 不可用");
    }

    await runComposeChecked(
      scenarioProject("preflight"),
      ["config", "--quiet"],
      {
        ...options,
        env: databaseEnvironment("narra_e2e_preflight"),
        label: "docker compose e2e config 校验",
        exitCode: EXIT.preflight,
      },
    );

    await buildImages(options);
    await scenarioEmbedded(projects, options);
    await scenarioDedicated(projects, options);
    await scenarioConflict(projects, options);
    await scenarioSchemaMissing(projects, options);
    await scenarioDatabaseDown(projects, options);
    await scenarioPropagation(projects, options);
    console.log(`[verify:e2e] 全部场景通过；owner=${E2E_OWNER_TOKEN}`);
  } catch (error) {
    exitCode = Number.isInteger(error?.exitCode)
      ? error.exitCode
      : EXIT.preflight;
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    const cleanupOptions = {
      deadlineAt: runnerDeadlineAt,
      scope: "verify:e2e:cleanup",
    };
    let allCleaned = true;
    for (const project of projects) {
      const cleaned = await cleanupProject(project, cleanupOptions);
      if (!cleaned) allCleaned = false;
    }
    if (!allCleaned) exitCode = EXIT.cleanup;
    await cleanupImages();
  }
  return exitCode;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
