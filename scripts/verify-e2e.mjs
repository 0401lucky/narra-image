#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertFixedTargets } from "./lib/command-runner.mjs";
import {
  createE2EConfiguration, E2EHarness, e2eComposeEnvironment, e2eFailure, printE2ECaptured,
} from "./lib/e2e-safety.mjs";
import { APP_HTTP_LIMITS, encodeCanvasAppRequest, encodeImageAppRequest } from "./fixtures/canvas-object-store.mjs";
import { runCanvasRuntimeSmoke } from "./fixtures/canvas-runtime.mjs";
import { runImageHistorySmoke } from "./fixtures/image-history-runtime.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAPABILITY = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "contracts/canvas/v1/capability.json"), "utf8"));
const IMAGE_MAINTENANCE = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "contracts/media/v1/maintenance.json"), "utf8"));
const FIXTURE = "scripts/fixtures/canvas-object-store.mjs";
export const E2E_LIMITS = Object.freeze({ totalMs: 40 * 60_000, cleanupMs: 120_000, scenarioMs: 300_000, imageScenarioMs: 600_000, shutdownMs: 35_000 });
export const E2E_SCENARIOS = Object.freeze([
  "embedded", "dedicated", "conflict", "schema", "dbdown", "propagate",
  "canvas-embedded", "canvas-dedicated", "canvas-mismatch",
  "image-embedded", "image-dedicated",
]);

function assert(condition, message, exitCode = 1) {
  if (!condition) throw e2eFailure(message, exitCode);
}

// Preserve the CLI's original safe error code without logging bindings,
// public URL bases, object keys or arbitrary error messages.
export function imageHistoryCliProgress(report) {
  const word = (value) => typeof value === "string" && value.length > 0 && value.length <= 64 && !/[^A-Z_]/.test(value) ? value : null;
  const code = (value) => word(value)?.startsWith("IMAGE_") ? value : null;
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const progress = report?.progress;
  return { processed: count(progress?.processed), blocked: count(progress?.blocked), hasMore: progress?.hasMore === true,
    code: code(report?.code), items: (Array.isArray(progress?.items) ? progress.items : []).slice(0, 100).map((item) => ({
      subjectKind: ["GENERATED", "REFERENCE_URL", "CANVAS_IMPORT"].includes(item?.subjectKind) ? item.subjectKind : null,
      state: word(item?.state), code: code(item?.code), stateAcknowledged: item?.stateAcknowledged === true,
      readerVerified: item?.readerVerified === true, putAttempted: item?.putAttempted === true, switched: item?.switched === true,
    })) };
}

/** @param {unknown} payload @param {{provider: string, locationId: string}} [location] */
export function hasExactImageCapability(payload, location) {
  const actual = payload?.capabilities?.images;
  const validLocation = actual?.provider === "S3" ? /^s3-v1:[a-f0-9]{64}(?![\s\S])/.test(actual.locationId)
    : actual?.provider === "LOCAL" && /^local-v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/.test(actual.locationId);
  const expected = { version: 1, schema: "ready", storageRevision: IMAGE_MAINTENANCE.storageRevision,
    readerRevision: IMAGE_MAINTENANCE.readerRevision, executorRevision: IMAGE_MAINTENANCE.executorRevision,
    maintenance: "running", provider: location?.provider ?? actual?.provider, locationId: location?.locationId ?? actual?.locationId };
  return Boolean(validLocation && actual && typeof actual === "object" && !Array.isArray(actual) && Object.keys(actual).length === 8
    && Object.entries(expected).every(([key, value]) => actual[key] === value));
}

/** @param {unknown} payload @param {{provider: string, locationId: string}} [location] */
export function hasExactCanvasCapability(payload, location) {
  let actual = payload;
  for (const key of CAPABILITY.readyCapabilityPath) actual = actual?.[key];
  const expected = { ...CAPABILITY.readyCapability, storage: actual?.provider === "LOCAL" ? "local" : "unversioned" };
  const validLocation = actual?.provider === "S3" ? /^s3-v1:[a-f0-9]{64}(?![\s\S])/.test(actual.locationId)
    : actual?.provider === "LOCAL" && /^local-v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/.test(actual.locationId);
  return Boolean(actual && typeof actual === "object" && !Array.isArray(actual)
    && validLocation && Object.keys(actual).length === Object.keys(expected).length + 2
    && (!location || (actual.provider === location.provider && actual.locationId === location.locationId))
    && Object.entries(expected).every(([key, value]) => actual[key] === value));
}

/** @param {unknown} result @param {{ready?: boolean, canvas?: boolean, code?: string, canvasLocation?: {provider: string, locationId: string}}} [options] */
export function matchesReadiness(result, { ready = true, canvas = false, code, canvasLocation } = {}) {
  const body = result?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return result.status === (ready ? 200 : 503) && body.status === (ready ? "ready" : "not_ready")
    && (!code || body.code === code) && (!ready || !canvas || hasExactCanvasCapability(body, canvasLocation));
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
  const input = await (project.images ? encodeImageAppRequest : encodeCanvasAppRequest)(project.owner, route, requestOptions);
  const result = await harness.checkedCompose(project, ["exec", "-T", service, "node", FIXTURE, project.images ? "image-http" : "app-http"], {
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
  if (expected.canvas) {
    const environment = e2eComposeEnvironment(harness.configuration, project);
    const material = JSON.stringify([environment.E2E_S3_ENDPOINT, environment.E2E_S3_REGION, environment.E2E_S3_BUCKET]);
    expected = { ...expected, canvasLocation: project.images && project.imageBackend === "local"
      ? { provider: "LOCAL", locationId: `local-v1:${project.volumeId}` }
      : { provider: "S3", locationId: `s3-v1:${createHash("sha256").update(material).digest("hex")}` } };
  }
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

async function scenarioImageHistory(harness, project, mode, options, imageHistoryVerifier) {
  const appService = mode === "embedded" ? "embedded" : "app";
  const workerService = mode === "embedded" ? "embedded" : "worker";
  const local = { provider: "LOCAL", locationId: `local-v1:${project.volumeId}` };
  const historyCopyName = `${project.name}-image-history-copy`;
  const historyCli = async (args, manifest, standalone = false) => {
    if (standalone) project.oneOffNames.add(historyCopyName);
    const command = standalone
      ? ["run", "--rm", "--no-deps", "-T", "--name", historyCopyName, "worker"]
      : ["exec", "-T", workerService];
    const result = await harness.compose(project, [...command, "/app/narra-image-history", "--bindings", "-", "--timeout", "40s", ...args], {
      ...options, input: JSON.stringify(manifest), timeoutMs: 50_000, label: "Run the packaged history CLI with reviewed stdin bindings",
    });
    let report;
    try { report = JSON.parse(result.stdout.trim()); }
    catch { throw e2eFailure(`Image history CLI returned invalid JSON (exit ${result.code})`); }
    if (result.code !== 0) console.log(`[verify:e2e] ${mode} history CLI progress: ${JSON.stringify(imageHistoryCliProgress(report))}`);
    assert([0, 2].includes(result.code), `Image history CLI failed (${result.code})`);
    return report;
  };
  const recreate = async () => {
    const before = (await harness.containers(project, options)).filter((container) => [appService, workerService].includes(container.Config.Labels["com.docker.compose.service"])).map((container) => container.Id);
    await harness.checkedCompose(project, [...(mode === "embedded" ? ["--profile", "embedded"] : []), "up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "150", ...new Set([workerService, appService])], { ...options, timeoutMs: 180_000, label: "Recreate actual image app/Worker containers on their original persistent volume" });
    await appReady(harness, project, mode, { ready: true, code: "READY" }, options);
    const ready = await workerReady(harness, project, mode, { ready: true, canvas: true }, options);
    assert(hasExactImageCapability(ready.body, local), "Managed Worker did not advertise the exact current image capability");
    const after = (await harness.containers(project, options)).filter((container) => [appService, workerService].includes(container.Config.Labels["com.docker.compose.service"])).map((container) => container.Id);
    assert(before.every((id) => !after.includes(id)), "Image persistence proof reused an existing runtime container");
  };
  const name = `${project.name}-image-volume-init`;
  project.oneOffNames.add(name);
  await harness.checkedCompose(project, ["run", "--rm", "--no-deps", "-T", "--name", name, "worker", "/app/narra-worker", "--init-image-volume"], {
    ...options, timeoutMs: 20_000, label: "Explicitly initialize only the owned empty LOCAL image volume",
  });
  project.managedImages = false;
  project.workerManagedImages = false;
  project.imageBackend = "s3";
  await topologyUp(harness, project, mode, options);
  const negativeChecks = async () => {
    const result = await harness.compose(project, ["exec", "-T", workerService, "/app/narra-rollback-preflight"], { ...options, timeoutMs: 15_000, label: "Current image schema must refuse rollback to old Workers" });
    assert(result.code === 2, "New image revision was incorrectly marked rollback-safe");
    const report = JSON.parse(result.stdout.trim());
    assert(report.code === "ROLLBACK_UNSAFE" && report.image_storage_revision === IMAGE_MAINTENANCE.storageRevision && report.canvas_storage_revision === CAPABILITY.readyCapability.storageRevision,
      "Rollback report did not inspect the actual current image/Canvas revisions");
    assert(!/storage_path|endpoint|postgresql:|\/data\/images/.test(result.stdout), "Rollback report exposed storage/config details");
    const originalId = project.volumeId;
    if (mode === "embedded") project.volumeId = randomUUID();
    else project.workerVolumeId = randomUUID();
    await harness.checkedCompose(project, [...(mode === "embedded" ? ["--profile", "embedded"] : []), "up", "-d", "--no-deps", "--force-recreate", workerService], { ...options, label: "Reject a Worker configured for a different persistent-volume identity" });
    const failed = await exited(harness, project, workerService, { ...options, timeoutMs: 120_000 });
    assert(failed.every((container) => container.State.ExitCode !== 0), "Mismatched volume Worker did not refuse startup");
    const logs = await serviceLogs(harness, project, workerService, options);
    assert(/IMAGE_STORAGE_UNAVAILABLE|IMAGE_LOCATION_CONFLICT/.test(logs), "Mismatched volume failed for an unrelated reason");
    project.volumeId = originalId;
    project.workerVolumeId = null;
    await recreate();
    if (mode === "dedicated") {
      project.canvas = false;
      project.workerManagedImages = false;
      project.workerCanvas = false;
      project.workerImageBackend = "s3";
      await harness.checkedCompose(project, ["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "90", "worker"], { ...options, label: "Run a real generic Worker without managed-image capabilities" });
      await harness.checkedCompose(project, ["up", "-d", "--no-deps", "--force-recreate", "app"], { ...options, label: "Require image capability even with Canvas disabled" });
      const generic = await workerReady(harness, project, mode, { ready: true }, options);
      assert(!generic.body?.capabilities?.images, "Generic Worker unexpectedly advertised image capabilities");
      await appReady(harness, project, mode, { ready: false, code: "WORKER_NOT_READY" }, options);
      project.workerManagedImages = true;
      project.canvas = true;
      project.workerCanvas = true;
      project.workerImageBackend = null;
      await recreate();
    }
    if (imageHistoryVerifier) await imageHistoryVerifier({ harness, project, mode, options,
      sql: async (sql) => (await fixtureSql(harness, project, sql, options)).stdout.trim() });
  };
  await runImageHistorySmoke({
    configuration: harness.configuration, project,
    request: (route, requestOptions) => appRequest(harness, project, mode, route, requestOptions, options),
    sql: async (sql) => (await fixtureSql(harness, project, sql, options)).stdout.trim(),
    control: (state) => fixtureControl(harness, project, state, options),
    objects: async (method, keys) => JSON.parse((await harness.checkedCompose(project, ["exec", "-T", "object-store", "node", FIXTURE, "objects", method, JSON.stringify(keys)], { ...options, timeoutMs: 20_000, label: "Inspect or seed only the explicit legacy fixture object keys" })).stdout.trim()),
    cli: historyCli,
    withDrainedCanvas: async (copy) => {
      // A live compatibility scheduler renews its 90-second lease even when
      // this LOCAL deployment has no legacy S3 originals eligible for GC.
      // Drain the real processes first; never edit the database clock/lease.
      await shutdownTopology(harness, project, mode, options);
      if (mode === "dedicated") await harness.checkedCompose(project, ["stop", "-t", "10", "app"], { ...options, label: "Stop the app during legacy Canvas adoption" });
      try {
        await poll(async () => JSON.parse((await fixtureSql(harness, project,
          'SELECT to_json(NOT EXISTS (SELECT 1 FROM "CanvasGcLease" WHERE "expiresAt" > clock_timestamp()));', options)).stdout.trim()),
        (expired) => expired === true, { ...options, intervalMs: 1_000, timeoutMs: 100_000, label: "Wait for the drained compatibility GC lease to expire naturally" });
        return await copy((args, manifest) => historyCli(args, manifest, true));
      } finally {
        await recreate();
      }
    },
    wait: (probe, accept, label, timeoutMs = 90_000) => poll(probe, accept, { ...options, intervalMs: 1_000, timeoutMs, label: `${project.label} ${label}` }),
    enableManaged: async () => {
      await shutdownTopology(harness, project, mode, options);
      if (mode === "dedicated") await harness.checkedCompose(project, ["stop", "-t", "10", "app"], { ...options, label: "Drain the legacy app before managed-image activation" });
      project.managedImages = true;
      project.workerManagedImages = true;
      project.imageBackend = "local";
      await recreate();
    },
    recreate, negativeChecks,
    volumeFiles: async () => JSON.parse((await harness.checkedCompose(project, ["exec", "-T", appService, "node", "scripts/fixtures/image-history-volume.mjs"], {
      ...options, timeoutMs: 15_000, label: "Read and hash actual image files and marker in the owned Linux volume",
    })).stdout.trim()),
  });
  await shutdownTopology(harness, project, mode, options);
}

/** @param {{source?: Record<string, string | undefined>, run?: typeof import("./lib/command-runner.mjs").runStage, scenarioLabels?: readonly string[], imageHistoryVerifier?: (input: {harness: E2EHarness, project: object, mode: string, options: {deadlineAt: number}, sql: (command: string) => Promise<string>}) => Promise<void>}} [options] */
export async function main({ source = process.env, run, scenarioLabels = E2E_SCENARIOS, imageHistoryVerifier } = {}) {
  const runnerDeadlineAt = Date.now() + E2E_LIMITS.totalMs;
  const workDeadlineAt = runnerDeadlineAt - E2E_LIMITS.cleanupMs;
  let harness;
  let exitCode = 0;
  try {
    assert(scenarioLabels.length > 0 && new Set(scenarioLabels).size === scenarioLabels.length && scenarioLabels.every((label) => E2E_SCENARIOS.includes(label)), "Unknown E2E scenario selection", 2);
    assertFixedTargets(PROJECT_ROOT, [
      "docker-compose.e2e.yml", "Dockerfile", "worker/Dockerfile", ".dockerignore",
      "scripts/migrate-deploy.mjs", "scripts/start-prod.mjs", FIXTURE,
      "scripts/fixtures/canvas-runtime.mjs", "src/lib/auth/session-token.ts", "src/lib/constants.ts",
      "contracts/canvas/v1/capability.json", "contracts/canvas/v1/retention.json", "contracts/canvas/v1/scenarios/graph.json",
      "contracts/media/v1/maintenance.json", "docker-compose.image-history.e2e.yml", "scripts/fixtures/image-history-runtime.mjs", "scripts/fixtures/image-history-volume.mjs",
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
      ["image-embedded", (h, p, o) => scenarioImageHistory(h, p, "embedded", o, imageHistoryVerifier)],
      ["image-dedicated", (h, p, o) => scenarioImageHistory(h, p, "dedicated", o, imageHistoryVerifier)],
    ];
    for (const [label, scenario] of scenarios) {
      if (!scenarioLabels.includes(label)) continue;
      const startedAt = Date.now();
      const options = { deadlineAt: Math.min(workDeadlineAt, Date.now() + (label.startsWith("image-") ? E2E_LIMITS.imageScenarioMs : E2E_LIMITS.scenarioMs)) };
      const project = await harness.createProject(label, {
        canvas: label.startsWith("canvas-") || label.startsWith("image-"),
        workerCanvas: (label.startsWith("canvas-") && label !== "canvas-mismatch") || label.startsWith("image-"),
        genericReadinessRequired: label !== "canvas-mismatch",
        images: label.startsWith("image-"),
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
    console.log(`[verify:e2e] All ${scenarioLabels.length} selected legacy, Canvas and image-history scenarios passed; owner=${harness.configuration.owner}`);
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
