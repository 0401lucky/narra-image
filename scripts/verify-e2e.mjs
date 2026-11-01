#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertFixedTargets } from "./lib/command-runner.mjs";
import {
  createE2EConfiguration, E2EHarness, e2eFailure, printE2ECaptured,
} from "./lib/e2e-safety.mjs";
import { APP_HTTP_LIMITS, encodeCanvasAppRequest } from "./fixtures/canvas-object-store.mjs";
import { runCanvasRuntimeSmoke } from "./fixtures/canvas-runtime.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAPABILITY = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "contracts/canvas/v1/capability.json"), "utf8"));
const FIXTURE = "scripts/fixtures/canvas-object-store.mjs";
export const E2E_LIMITS = Object.freeze({ totalMs: 30 * 60_000, cleanupMs: 120_000, scenarioMs: 300_000, shutdownMs: 35_000 });
export const E2E_SCENARIOS = Object.freeze([
  "embedded", "dedicated", "conflict", "schema", "dbdown", "propagate",
  "canvas-embedded", "canvas-dedicated", "canvas-mismatch",
]);

function assert(condition, message, exitCode = 1) {
  if (!condition) throw e2eFailure(message, exitCode);
}

export function hasExactCanvasCapability(payload) {
  let actual = payload;
  for (const key of CAPABILITY.readyCapabilityPath) actual = actual?.[key];
  const expected = CAPABILITY.readyCapability;
  return Boolean(actual && typeof actual === "object" && !Array.isArray(actual)
    && Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => actual[key] === value));
}

/** @param {unknown} result @param {{ready?: boolean, canvas?: boolean, code?: string}} [options] */
export function matchesReadiness(result, { ready = true, canvas = false, code } = {}) {
  const body = result?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return result.status === (ready ? 200 : 503) && body.status === (ready ? "ready" : "not_ready")
    && (!code || body.code === code) && (!ready || !canvas || hasExactCanvasCapability(body));
}

async function poll(probe, accept, { deadlineAt, timeoutMs = 90_000, intervalMs = 750, label }) {
  const stopAt = Math.min(deadlineAt, Date.now() + timeoutMs);
  let last = "no response";
  while (Date.now() < stopAt) {
    try {
      const result = await probe(stopAt);
      if (accept(result)) return result;
      last = JSON.stringify(result).slice(0, 300);
    } catch (error) { last = error.message; }
    const remaining = stopAt - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  throw e2eFailure(`${label} did not reach its required state: ${last}`, 124);
}

async function appRequest(harness, project, mode, route, requestOptions, options) {
  const service = mode === "embedded" ? "embedded" : "app";
  const input = await encodeCanvasAppRequest(project.owner, route, requestOptions);
  const result = await harness.checkedCompose(project, ["exec", "-T", service, "node", FIXTURE, "app-http"], {
    ...options, input, timeoutMs: 20_000, label: `${project.label} internal HTTP ${requestOptions?.method ?? "GET"} ${route}`,
  });
  assert(Buffer.byteLength(result.stdout) <= APP_HTTP_LIMITS.responseBytes * 8, "App HTTP envelope exceeded its bound");
  return JSON.parse(result.stdout.trim());
}

async function appReady(harness, project, mode, expected, options) {
  return poll((deadlineAt) => appRequest(harness, project, mode, "/api/readyz", {}, { ...options, deadlineAt }), (result) => matchesReadiness(result, expected), {
    ...options, label: `${project.label} app readiness`,
  });
}

async function workerReady(harness, project, mode, expected, options) {
  const service = mode === "embedded" ? "embedded" : "app";
  const url = mode === "embedded" ? "http://127.0.0.1:8081/readyz" : "http://worker:8081/readyz";
  return poll(async (deadlineAt) => {
    const result = await harness.checkedCompose(project, ["exec", "-T", service, "node", FIXTURE, "probe", url], {
      ...options, deadlineAt, timeoutMs: 10_000, label: `${project.label} Worker readiness probe`,
    });
    return JSON.parse(result.stdout.trim());
  }, (result) => matchesReadiness(result, expected), { ...options, label: `${project.label} Worker readiness` });
}

async function serviceLogs(harness, project, service, options) {
  const result = await harness.checkedCompose(project, ["logs", "--no-color", "--tail", "300", service], { ...options, timeoutMs: 10_000, label: `Read ${service} diagnostic logs` });
  return `${result.stdout}\n${result.stderr}`;
}

async function exited(harness, project, service, options) {
  return poll(async (deadlineAt) => {
    const containers = await harness.containers(project, { deadlineAt });
    return containers.filter((container) => container.Config.Labels["com.docker.compose.service"] === service);
  }, (containers) => containers.length > 0 && containers.every((container) => ["exited", "dead"].includes(container.State?.Status)), {
    ...options, label: `${service} bounded exit`,
  });
}

async function topologyUp(harness, project, mode, options, replicas = 1) {
  const args = mode === "embedded"
    ? ["--profile", "embedded", "up", "-d", "--wait", "--wait-timeout", "150", "db", "object-store", "embedded"]
    : ["up", "-d", "--wait", "--wait-timeout", "210", "--scale", `worker=${replicas}`, "db", "object-store", "migrate", "worker", "app"];
  await harness.checkedCompose(project, args, { ...options, label: `Start ${project.label} topology`, timeoutMs: 240_000 });
  await appReady(harness, project, mode, { ready: true, code: "READY" }, options);
  await workerReady(harness, project, mode, { ready: true, canvas: project.canvas }, options);
  const logs = await serviceLogs(harness, project, mode === "embedded" ? "embedded" : "worker", options);
  assert(logs.includes("topology_lock_acquired"), "Worker did not record acquiring its topology lock");
  if (mode === "dedicated") {
    const workers = (await harness.containers(project, options)).filter((container) => container.Config.Labels["com.docker.compose.service"] === "worker");
    assert(workers.length === replicas && workers.every((worker) => worker.State?.Health?.Status === "healthy"), "Dedicated replica readiness is incomplete");
  }
  await fixtureSql(harness, project, "", { ...options, bootstrapSentinel: true });
}

async function shutdownTopology(harness, project, mode, options) {
  const service = mode === "embedded" ? "embedded" : "worker";
  const startedAt = Date.now();
  const deadlineAt = Math.min(options.deadlineAt, startedAt + E2E_LIMITS.shutdownMs);
  await harness.checkedCompose(project, ["stop", "-t", "15", service], { ...options, deadlineAt, timeoutMs: 25_000, label: `SIGTERM ${project.label}` });
  const containers = await exited(harness, project, service, { ...options, deadlineAt, timeoutMs: 5_000 });
  assert(containers.every((container) => container.State.ExitCode === 0), `${project.label} did not exit cleanly after SIGTERM`);
  assert(Date.now() - startedAt < E2E_LIMITS.shutdownMs, `${project.label} exceeded its shutdown bound`);
  const logs = await serviceLogs(harness, project, service, options);
  assert(logs.includes("worker_draining") && logs.includes("worker_drained"), `${project.label} did not record bounded drain completion`);
  if (mode === "dedicated") {
    // Require the still-running app to withdraw readiness, not an arbitrary
    // connection failure or HTTP 500 counted as a successful negative test.
    await appReady(harness, project, mode, { ready: false, code: "WORKER_UNAVAILABLE" }, options);
  }
}

async function fixtureControl(harness, project, state, options) {
  const result = await harness.checkedCompose(project, ["exec", "-T", "object-store", "node", FIXTURE, "control", state], {
    ...options, timeoutMs: 10_000, label: `Local fake-S3 control ${state}`,
  });
  return JSON.parse(result.stdout.trim());
}

async function fixtureSql(harness, project, sql, options) {
  await harness.assertDatabase(project, options);
  const { bootstrapSentinel = false, ...commandOptions } = options;
  const text = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const identity = `DO $$ BEGIN
    IF current_database() <> ${text(project.databaseName)} OR current_user <> ${text(harness.configuration.databaseUser)} THEN RAISE EXCEPTION 'E2E database identity mismatch'; END IF;
    END $$;`;
  const sentinel = bootstrapSentinel ? `CREATE TABLE IF NOT EXISTS "_narra_e2e_owner" (id integer PRIMARY KEY CHECK(id=1), owner uuid NOT NULL, project text NOT NULL);
    INSERT INTO "_narra_e2e_owner" VALUES (1, ${text(project.owner)}::uuid, ${text(project.name)}) ON CONFLICT (id) DO NOTHING;` : "";
  const guardedSql = `${identity}${sentinel}
    DO $$ BEGIN IF (SELECT count(*) FROM "_narra_e2e_owner" WHERE owner=${text(project.owner)}::uuid AND project=${text(project.name)}) <> 1 THEN RAISE EXCEPTION 'E2E owner sentinel mismatch'; END IF; END $$;
    ${sql}`;
  return harness.checkedCompose(project, ["exec", "-T", "db", "sh", "-c",
    'PGPASSWORD="$POSTGRES_PASSWORD" exec psql --host=127.0.0.1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --quiet -v ON_ERROR_STOP=1 -c "$1"', "--", guardedSql,
  ], { ...commandOptions, timeoutMs: 15_000, label: "Access only the verified runner-local fixture database" });
}

async function migrateAgain(harness, project, options) {
  const name = `${project.name}-migrate-recovery`;
  project.oneOffNames.add(name);
  await harness.checkedCompose(project, ["run", "--rm", "--no-deps", "-T", "--name", name, "migrate"], {
    ...options, timeoutMs: 120_000, label: "Replay normal migrate deploy in the isolated fixture",
  });
  await fixtureSql(harness, project, "", { ...options, bootstrapSentinel: true });
}

async function scenarioEmbedded(harness, project, options) {
  await topologyUp(harness, project, "embedded", options);
  await shutdownTopology(harness, project, "embedded", options);
}

async function scenarioDedicated(harness, project, options) {
  await topologyUp(harness, project, "dedicated", options, 2);
  assert(!hasExactCanvasCapability((await workerReady(harness, project, "dedicated", { ready: true }, options)).body), "Feature-off Worker unexpectedly advertised canvas");
  const store = await fixtureControl(harness, project, "status", options);
  assert(store.counters.versioning === 0 && store.objectCount === 0, "Feature-off runtime unexpectedly accessed import storage");
}

async function scenarioConflict(harness, project, options) {
  await topologyUp(harness, project, "embedded", options);
  await harness.checkedCompose(project, ["--profile", "conflict", "up", "-d", "--no-deps", "embedded_conflict"], { ...options, label: "Start conflicting embedded Worker" });
  const containers = await exited(harness, project, "embedded_conflict", { ...options, timeoutMs: 120_000 });
  assert(containers.every((container) => container.State.ExitCode !== 0), "Topology conflict did not propagate a nonzero exit");
  const logs = await serviceLogs(harness, project, "embedded_conflict", options);
  assert(/TOPOLOGY_CONFLICT|topology_conflict|\u62d3\u6251\u51b2\u7a81/.test(logs), "Missing actual topology-conflict evidence");
  await appReady(harness, project, "embedded", { ready: true, code: "READY" }, options);
}

async function scenarioSchema(harness, project, options) {
  await topologyUp(harness, project, "dedicated", options);
  await fixtureSql(harness, project, "DROP SCHEMA public CASCADE; CREATE SCHEMA public;", options);
  await workerReady(harness, project, "dedicated", { ready: false }, options);
  await appReady(harness, project, "dedicated", { ready: false, code: "WORKER_NOT_READY" }, options);
  await migrateAgain(harness, project, options);
  await workerReady(harness, project, "dedicated", { ready: true }, options);
  await appReady(harness, project, "dedicated", { ready: true, code: "READY" }, options);
}

async function scenarioDatabaseDown(harness, project, options) {
  await topologyUp(harness, project, "dedicated", options);
  await harness.checkedCompose(project, ["stop", "-t", "10", "db"], { ...options, label: "Stop only the owned fixture database" });
  await appReady(harness, project, "dedicated", { ready: false, code: "DATABASE_UNAVAILABLE" }, options);
  const containers = await exited(harness, project, "worker", { ...options, timeoutMs: 90_000 });
  assert(containers.every((container) => container.State.ExitCode !== 0), "Lost topology lock did not propagate a Worker failure");
  await harness.checkedCompose(project, ["up", "-d", "--no-deps", "--no-recreate", "--wait", "--wait-timeout", "60", "db"], { ...options, label: "Restart owned fixture database" });
  // tmpfs data can disappear on stop; restore through ordinary migrations,
  // never a persistent volume or a live database fallback.
  await migrateAgain(harness, project, options);
  await harness.checkedCompose(project, ["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "150", "worker", "app"], { ...options, label: "Recreate Worker/app after database recovery" });
  await appReady(harness, project, "dedicated", { ready: true, code: "READY" }, options);
}

async function scenarioPropagation(harness, project, options) {
  project.missingDatabase = true;
  await harness.checkedCompose(project, ["up", "-d", "--wait", "--wait-timeout", "60", "db", "object-store"], { ...options, label: "Start isolated failure-propagation dependencies" });
  await harness.checkedCompose(project, ["--profile", "embedded", "up", "-d", "--no-deps", "embedded"], { ...options, label: "Start embedded against nonexistent generated database" });
  const containers = await exited(harness, project, "embedded", { ...options, timeoutMs: 180_000 });
  assert(containers.every((container) => container.State.ExitCode !== 0), "Migration failure did not propagate a nonzero supervisor exit");
  const logs = await serviceLogs(harness, project, "embedded", options);
  assert(/migration|migrate|database/i.test(logs), "Migration failure has no diagnostic evidence");
}

async function scenarioCanvas(harness, project, mode, options) {
  await topologyUp(harness, project, mode, options, mode === "dedicated" ? 2 : 1);
  const initial = await fixtureControl(harness, project, "status", options);
  assert(initial.counters.versioning > 0, "Enabled readiness did not query the fake storage capability");
  await fixtureControl(harness, project, "enabled", options);
  await workerReady(harness, project, mode, { ready: false, code: "CANVAS_STORAGE_CAPABILITY_INVALID" }, options);
  await appReady(harness, project, mode, { ready: false, code: "CANVAS_STORAGE_CAPABILITY_INVALID" }, options);
  await fixtureControl(harness, project, "unversioned", options);
  await workerReady(harness, project, mode, { ready: true, canvas: true }, options);
  await appReady(harness, project, mode, { ready: true, code: "READY" }, options);
  if (mode === "dedicated") {
    await fixtureSql(harness, project, 'ALTER TABLE "Canvas" RENAME COLUMN "scene" TO "e2e_missing_scene";', options);
    await workerReady(harness, project, mode, { ready: false, code: "CANVAS_SCHEMA_CONTRACT_MISMATCH" }, options);
    await appReady(harness, project, mode, { ready: false, code: "CANVAS_SCHEMA_CONTRACT_MISMATCH" }, options);
    await fixtureSql(harness, project, 'ALTER TABLE "Canvas" RENAME COLUMN "e2e_missing_scene" TO "scene";', options);
    await workerReady(harness, project, mode, { ready: true, canvas: true }, options);
    await appReady(harness, project, mode, { ready: true, code: "READY" }, options);
  }
  await runCanvasRuntimeSmoke({
    configuration: harness.configuration, project,
    request: (route, requestOptions) => appRequest(harness, project, mode, route, requestOptions, options),
    sql: async (sql) => (await fixtureSql(harness, project, sql, options)).stdout.trim(),
    control: (state) => fixtureControl(harness, project, state, options),
    objects: async (method, keys) => {
      const result = await harness.checkedCompose(project, ["exec", "-T", "object-store", "node", FIXTURE, "objects", method, JSON.stringify(keys)], {
        ...options, timeoutMs: 25_000, label: `Local fake-S3 exact-key ${method}`,
      });
      return JSON.parse(result.stdout.trim());
    },
    wait: (probe, accept, label) => poll(probe, accept, { ...options, intervalMs: 2_000, timeoutMs: 90_000, label: `${project.label} ${label}` }),
  });
  await workerReady(harness, project, mode, { ready: true, canvas: true }, options);
  await appReady(harness, project, mode, { ready: true, code: "READY" }, options);
  await shutdownTopology(harness, project, mode, options);
}

async function scenarioCanvasMismatch(harness, project, options) {
  await harness.checkedCompose(project, ["up", "-d", "--wait", "--wait-timeout", "150", "db", "object-store", "migrate", "worker"], { ...options, label: "Start generic-ready canvas-disabled Worker" });
  await harness.checkedCompose(project, ["up", "-d", "--no-deps", "app"], { ...options, label: "Start canvas-enabled Node against disabled Worker" });
  const worker = await workerReady(harness, project, "dedicated", { ready: true }, options);
  assert(!hasExactCanvasCapability(worker.body), "Mismatch scenario did not use a canvas-disabled Worker");
  await appReady(harness, project, "dedicated", { ready: false, code: "WORKER_NOT_READY" }, options);
  project.workerCanvas = true;
  await harness.checkedCompose(project, ["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "120", "worker"], { ...options, label: "Enable real Worker canvas capability" });
  await workerReady(harness, project, "dedicated", { ready: true, canvas: true }, options);
  await appReady(harness, project, "dedicated", { ready: true, code: "READY" }, options);
  await shutdownTopology(harness, project, "dedicated", options);
}

/** @param {{source?: Record<string, string | undefined>, run?: typeof import("./lib/command-runner.mjs").runStage}} [options] */
export async function main({ source = process.env, run } = {}) {
  const runnerDeadlineAt = Date.now() + E2E_LIMITS.totalMs;
  const workDeadlineAt = runnerDeadlineAt - E2E_LIMITS.cleanupMs;
  let harness;
  let exitCode = 0;
  try {
    assertFixedTargets(PROJECT_ROOT, [
      "docker-compose.e2e.yml", "Dockerfile", "worker/Dockerfile", ".dockerignore",
      "scripts/migrate-deploy.mjs", "scripts/start-prod.mjs", FIXTURE,
      "scripts/fixtures/canvas-runtime.mjs", "src/lib/auth/session-token.ts", "src/lib/constants.ts",
      "contracts/canvas/v1/capability.json", "contracts/canvas/v1/retention.json", "contracts/canvas/v1/scenarios/graph.json",
    ], "verify:e2e");
    harness = new E2EHarness({ projectRoot: PROJECT_ROOT, configuration: createE2EConfiguration(source), ...(run ? { run } : {}), deadlineAt: workDeadlineAt });
    await harness.preflight();
    await harness.buildImages();
    const scenarios = [
      ["embedded", scenarioEmbedded], ["dedicated", scenarioDedicated],
      ["conflict", scenarioConflict], ["schema", scenarioSchema],
      ["dbdown", scenarioDatabaseDown], ["propagate", scenarioPropagation],
      ["canvas-embedded", (h, p, o) => scenarioCanvas(h, p, "embedded", o)],
      ["canvas-dedicated", (h, p, o) => scenarioCanvas(h, p, "dedicated", o)],
      ["canvas-mismatch", scenarioCanvasMismatch],
    ];
    for (const [label, scenario] of scenarios) {
      const startedAt = Date.now();
      const options = { deadlineAt: Math.min(workDeadlineAt, Date.now() + E2E_LIMITS.scenarioMs) };
      const project = await harness.createProject(label, {
        canvas: label.startsWith("canvas-"),
        workerCanvas: label.startsWith("canvas-") && label !== "canvas-mismatch",
        genericReadinessRequired: label !== "canvas-mismatch",
      });
      try {
        await scenario(harness, project, options);
        console.log(`[verify:e2e] PASS ${label}; duration_ms=${Date.now() - startedAt}`);
      } catch (error) {
        for (const service of ["embedded", "worker", "app", "migrate"]) {
          try { printE2ECaptured({ stdout: await serviceLogs(harness, project, service, options) }); }
          catch { /* Preserve the scenario failure when diagnostic collection also fails. */ }
        }
        throw error;
      } finally {
        const cleaned = await harness.cleanupProject(project, Math.min(runnerDeadlineAt, Date.now() + E2E_LIMITS.cleanupMs));
        if (!cleaned) console.error(`[verify:e2e] Cleanup incomplete for ${label}; final cleanup will recheck exact ownership`);
      }
    }
    console.log(`[verify:e2e] All legacy and enabled-canvas scenarios passed; owner=${harness.configuration.owner}`);
  } catch (error) {
    exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 2;
    console.error(`[verify:e2e] ${error.message}`);
    if (!harness?.preflightPassed) console.error("[verify:e2e] Infrastructure gate unmet; runtime scenarios did not run.");
  } finally {
    if (harness && !await harness.cleanup(runnerDeadlineAt)) {
      console.error("[verify:e2e] Cleanup incomplete; original failing exit code is preserved.");
      if (exitCode === 0) exitCode = 10;
    }
  }
  return exitCode;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) process.exitCode = await main();
