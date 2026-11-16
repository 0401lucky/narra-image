import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSessionToken } from "../../../../src/lib/auth/session-token.ts";
import { SESSION_COOKIE_NAME } from "../../../../src/lib/constants.ts";
import { runStage, terminateProcessTree } from "../../../../scripts/lib/command-runner.mjs";
import { assertDockerPrerequisites, buildDatabaseUrl, cleanupPostgres, createDatabase, createPostgresResource, runPsql, startPostgres, waitForPostgres } from "../../../../scripts/lib/disposable-postgres.mjs";
import { cleanupDisposablePrismaWorkspace, createDisposablePrismaWorkspace, disposableTestEnvironment } from "../../../../scripts/lib/disposable-test-environment.mjs";

const CHECKS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(CHECKS, "../../../..");
const ownerRoot = path.dirname(ROOT);
const owner = JSON.parse(readFileSync(path.join(ownerRoot, "owner.json"), "utf8"));
assert.equal(owner.kind, "image-storage-foundation-local-v1");
assert.equal(owner.workspace, ROOT);
const captured = JSON.parse(readFileSync(path.join(ownerRoot, "source-manifest.json"), "utf8"));
const buildId = path.join(ROOT, ".next/BUILD_ID");
assert(existsSync(buildId) && statSync(buildId).mtimeMs >= Date.parse(captured.capturedAt), "A complete production build of this captured source is required");
const fixture = JSON.parse(readFileSync(path.join(CHECKS, "local-http-fixture.json"), "utf8"));
const bytes = Buffer.from(fixture.base64, "base64");
assert.equal(bytes.length, fixture.byteLength);
assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256);
const options = { scope: "images:actual-http", deadlineAt: Date.now() + 480_000 };
const resource = createPostgresResource({ prefix: "narra-image-http-", ownerLabelKey: "com.narra.image-http.owner", databaseUser: "narra_canvas", image: "postgres:17-alpine" });
const children = [];
const scratch = [];
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
let providerRequests = 0;
let exitCode = 0;

const provider = createHttpServer((request, response) => {
  let size = 0;
  request.on("data", (chunk) => { size += chunk.length; if (size > 2 * 1024 * 1024) request.destroy(); });
  request.on("end", () => {
    if (request.method !== "POST" || !["/v1/images/generations", "/v1/images/edits"].includes(request.url)) {
      response.writeHead(404).end(); return;
    }
    providerRequests += 1;
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ b64_json: fixture.base64 }] }));
  });
});

async function unusedPort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function start(executable, args, env, label) {
  const logPath = path.join(ownerRoot, "receipts", `${Date.now()}-${label}.log`);
  const output = createWriteStream(logPath, { flags: "wx" });
  const child = spawn(executable, args, { cwd: ROOT, env, windowsHide: true, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  const tracked = { child, output, label, logPath, bytes: 0, closed: false };
  children.push(tracked);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    tracked.bytes += chunk.length;
    if (tracked.bytes > 2 * 1024 * 1024) terminateProcessTree(child);
    else output.write(chunk);
  });
  child.once("error", (error) => { output.write(error.message); tracked.closed = true; output.end(); });
  child.once("close", () => { tracked.closed = true; output.end(); });
  return tracked;
}

async function stop(tracked) {
  if (tracked.closed) return;
  terminateProcessTree(tracked.child);
  const end = Date.now() + 5_000;
  while (!tracked.closed && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!tracked.closed) throw new Error(`Owned ${tracked.label} process did not exit`);
}

async function poll(label, probe, predicate, limitMs = 30_000) {
  const deadline = Math.min(options.deadlineAt, Date.now() + limitMs);
  let last;
  while (Date.now() < deadline) {
    try { last = await probe(); if (predicate(last)) return last; }
    catch (error) { last = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last).slice(0, 600)}`);
}

try {
  await assertDockerPrerequisites(resource, options);
  await startPostgres(resource, options);
  await waitForPostgres(resource, options);
  const workspace = createDisposablePrismaWorkspace({ prefix: "narra-canvas-contracts-prisma-" });
  scratch.push(workspace);
  const databaseName = `narra_canvas_full_${randomBytes(8).toString("hex")}`;
  await createDatabase(resource, databaseName, options);
  const env = disposableTestEnvironment(buildDatabaseUrl(resource, databaseName));
  await provider.listen(0, "127.0.0.1");
  await new Promise((resolve) => provider.listening ? resolve() : provider.once("listening", resolve));
  const appPort = await unusedPort();
  const workerPort = await unusedPort();
  const imageDirectory = path.join(workspace.directory, "images");
  mkdirSync(imageDirectory);
  Object.assign(env, {
    NODE_ENV: "production", APP_URL: "https://image-proof.invalid", CANVAS_ENABLED: "true",
    IMAGE_STORAGE_MANAGED_ENABLED: "true", IMAGE_STORAGE_BACKEND: "local", IMAGE_STORAGE_PATH: imageDirectory,
    IMAGE_STORAGE_VOLUME_ID: fixture.volumeId, WORKER_HTTP_ADDR: `127.0.0.1:${workerPort}`,
    WORKER_INTERNAL_URL: `http://127.0.0.1:${workerPort}`, WORKER_JOB_TIMEOUT_SECONDS: "900",
    WORKER_CONCURRENCY: "1", WORKER_POLL_INTERVAL_MS: "100", WORKER_CONTRACTS_V1_ENABLED: "false",
    BUILTIN_PROVIDER_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
    BUILTIN_PROVIDER_API_KEY: `fixture-${randomUUID()}`, WORKER_METRICS_TOKEN: `fixture-${randomUUID()}`,
    GOENV: "off", GOTOOLCHAIN: "local", GOWORK: "off",
  });
  for (const [executable, args, label, timeoutMs] of [
    [process.execPath, [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--config", workspace.configPath], "Apply migrations to owned HTTP fixture database", 120_000],
    ["go", ["-C", "worker", "build", "-o", path.join(workspace.directory, "worker.exe"), "./cmd/worker"], "Build real Go worker for HTTP proof", 120_000],
    [path.join(workspace.directory, "worker.exe"), ["--init-image-volume"], "Explicitly initialize the empty fixture image volume", 15_000],
  ]) {
    const result = await runStage({ executable, args, label, timeoutMs, env, cwd: ROOT, capture: true }, options);
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    assert.equal(result.code, 0, label);
  }
  await runPsql(resource, { ...options, databaseName, command: `CREATE TABLE "_image_http_owner" (token uuid PRIMARY KEY); INSERT INTO "_image_http_owner" VALUES (${literal(resource.ownerToken)}::uuid);`, label: "Bind HTTP database sentinel" });
  const sql = async (command) => {
    const result = await runPsql(resource, { ...options, databaseName, tuplesOnly: true, label: "Inspect owned image HTTP fixture facts", input: `\\set QUIET on\nDO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM "_image_http_owner" WHERE token=${literal(resource.ownerToken)}::uuid) THEN RAISE EXCEPTION 'owner mismatch'; END IF; END $$; ${command}` });
    return JSON.parse(result.stdout.trim());
  };
  const ownerId = randomUUID();
  await sql(`INSERT INTO "User" (id,email,credits,"updatedAt") VALUES (${literal(ownerId)},${literal(`${ownerId}@fixture.invalid`)},100,clock_timestamp()); SELECT to_json(true);`);
  const cookie = `${SESSION_COOKIE_NAME}=${await createSessionToken({ userId: ownerId, role: "user" }, env.AUTH_SECRET)}`;
  const base = `http://127.0.0.1:${appPort}`;
  const request = async (route, init = {}) => {
    assert(route.startsWith("/") && !route.startsWith("//"));
    const response = await fetch(`${base}${route}`, { ...init, signal: AbortSignal.timeout(20_000), redirect: "error" });
    const body = Buffer.from(await response.arrayBuffer());
    assert(body.length <= 2 * 1024 * 1024, "HTTP fixture response is bounded");
    return { status: response.status, headers: response.headers, bytes: body };
  };
  const api = async (route, method, body, expected = 200) => {
    const multipart = body instanceof FormData;
    const response = await request(route, { method, headers: { cookie, ...(multipart ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
    assert.equal(response.status, expected, `${method} ${route}: ${response.bytes.toString().slice(0, 400)}`);
    return JSON.parse(response.bytes.toString());
  };
  let worker = start(path.join(workspace.directory, "worker.exe"), [], env, "image-http-worker");
  let app = start(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(appPort)], env, "image-http-app");
  const ready = () => poll("real Next and Go readiness", () => request("/api/readyz"), (result) => result.status === 200, 60_000);
  await ready();
  const canvasId = randomUUID();
  await api("/api/me/canvases", "POST", { id: canvasId, title: "Local image HTTP proof" });
  const uploadId = randomUUID();
  const upload = async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ uploadId, byteLength: String(bytes.length), mimeType: "image/png", sha256: fixture.sha256 })) form.set(key, value);
    form.set("file", new Blob([bytes], { type: "image/png" }), "fixture.png");
    return (await api("/api/me/canvas-assets", "POST", form)).data.asset;
  };
  const imported = await upload();
  assert.equal(imported.state, "READY");
  assert.equal((await upload()).id, imported.id);
  const scene = { schemaVersion: 1, nodes: [{ id: randomUUID(), kind: "reference", position: { x: 0, y: 0 }, source: { kind: "imported", assetId: imported.id } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, runBindings: [] };
  await api(`/api/me/canvases/${canvasId}/snapshot`, "PUT", { expectedRevision: 0, saveId: randomUUID(), scene });
  const submitted = await api("/api/generate", "POST", fixture.plainGeneration);
  const jobId = submitted.data.generation.id;
  assert.equal(typeof jobId, "string");
  const job = await poll("local generated output", () => sql(`SELECT json_build_object('status',j.status,'error',j."errorMessage",'url',i.url,'mediaAssetId',i."mediaAssetId",'storage',i."mediaStorage") FROM "GenerationJob" j LEFT JOIN "GenerationImage" i ON i."jobId"=j.id WHERE j.id=${literal(jobId)};`), (value) => value.status === "SUCCEEDED" || value.status === "FAILED", 60_000);
  assert.equal(job.status, "SUCCEEDED", JSON.stringify(job));
  assert.equal(job.storage, "LOCAL");
  assert(job.mediaAssetId);
  assert.equal(providerRequests, 1);
  const referenceForm = new FormData();
  for (const [key, value] of Object.entries({ ...fixture.plainGeneration, generationType: "image_to_image" })) referenceForm.set(key, String(value));
  referenceForm.set("images", new Blob([bytes], { type: "image/png" }), "reference.png");
  const editedSubmission = await api("/api/generate", "POST", referenceForm);
  const editedJobId = editedSubmission.data.generation.id;
  const editedJob = await poll("ordinary uploaded reference to local generated output", () => sql(`SELECT json_build_object('status',j.status,'error',j."errorMessage",'url',i.url,'sources',j."sourceImageUrls",'storage',i."mediaStorage") FROM "GenerationJob" j LEFT JOIN "GenerationImage" i ON i."jobId"=j.id WHERE j.id=${literal(editedJobId)};`), (value) => value.status === "SUCCEEDED" || value.status === "FAILED", 60_000);
  assert.equal(editedJob.status, "SUCCEEDED", JSON.stringify(editedJob));
  assert.equal(editedJob.storage, "LOCAL");
  assert.equal(editedJob.sources.length, 1);
  assert.equal(providerRequests, 2);
  const readableUrls = [imported.url, job.url, editedJob.sources[0], editedJob.url];
  for (const url of readableUrls) {
    const pathname = new URL(url).pathname;
    const fetched = await request(pathname);
    assert.equal(fetched.status, 200);
    assert.deepEqual(fetched.bytes, bytes);
    assert.equal(fetched.headers.get("content-length"), String(bytes.length));
    assert.equal(fetched.headers.get("x-content-type-options"), "nosniff");
    const head = await request(pathname, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.bytes.length, 0);
    assert.equal((await request(pathname, { headers: { "if-none-match": fetched.headers.get("etag") } })).status, 304);
    const optimized = await request(`/_next/image?url=${encodeURIComponent(url)}&w=384&q=75`);
    assert.equal(optimized.status, 200, optimized.bytes.toString().slice(0, 300));
    assert.match(optimized.headers.get("content-type"), /^image\//);
    assert(optimized.bytes.length > 0);
    const proxied = await request(`/api/proxy-image?url=${encodeURIComponent(url)}`, { headers: { cookie } });
    assert.equal(proxied.status, 200);
    assert.deepEqual(proxied.bytes, bytes);
  }
  const facts = await sql(`SELECT json_build_object('objects',(SELECT count(*) FROM "ImageObject" WHERE accounted),'used',(SELECT "usedBytes"::text FROM "ImageQuota" WHERE scope='images'),'reserved',(SELECT "reservedBytes"::text FROM "ImageQuota" WHERE scope='images'),'roots',(SELECT count(*) FROM "ImageReference" WHERE "ownerId"=${literal(ownerId)} AND kind='CANVAS_SAVED'),'jobRoots',(SELECT count(*) FROM "ImageReference" WHERE "ownerId"=${literal(ownerId)} AND kind='JOB_INPUT' AND permanent),'source',(SELECT "sourceProvider" FROM "CanvasImportAsset" WHERE id=${literal(imported.id)}));`);
  assert.deepEqual(facts, { objects: 4, used: String(bytes.length * 4), reserved: "0", roots: 1, jobRoots: 1, source: "LOCAL" });
  await stop(app);
  app = start(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(appPort)], env, "image-http-app-restarted");
  await ready();
  for (const url of readableUrls) assert.deepEqual((await request(new URL(url).pathname)).bytes, bytes);
  if (process.argv.includes("--retention")) {
    const { runRetentionProof } = await import("../../11-12-image-retention-management/checks/browser-flow.mjs");
    await runRetentionProof({ base, request, sql, env, start, stop, unusedPort, ownerRoot, fixture, bytes,
      ownerId, cookie, jobId, editedJobId, imported, imageDirectory,
      stopWorker: () => stop(worker),
      restartWorker: () => {
        assert(worker.closed, "Only a stopped fixture worker may be restarted");
        worker = start(path.join(workspace.directory, "worker.exe"), [], env, "image-http-worker-restarted");
      },
    });
  }
  console.log(JSON.stringify({ localHttp: "passed", productionBuild: readFileSync(buildId, "utf8").trim(), rawGetHead304: true, actualNextOptimizer: true,
    authenticatedDownloadProxy: true, anonymousImageBytes: true, canvasUploadReplayAndSavedRoot: true, ordinaryReferenceJobRoot: true, realWorkerGeneration: true,
    appProcessRestart: true, providerRequests, s3Configured: false, facts, logs: children.map(({ logPath }) => logPath) }));
} catch (error) {
  console.error(error instanceof Error ? error.stack : "Local HTTP proof failed");
  console.error(JSON.stringify({ logs: children.map(({ logPath }) => logPath) }));
  exitCode = 1;
} finally {
  for (const child of children.reverse()) {
    try { await stop(child); } catch (error) { console.error(error.message); exitCode = 8; }
  }
  if (provider.listening) await new Promise((resolve) => provider.close(resolve));
  const containerCleaned = await cleanupPostgres(resource, { ...options, deadlineAt: Date.now() + 30_000 });
  const directoriesCleaned = exitCode === 8 ? false : scratch.reverse().map(cleanupDisposablePrismaWorkspace).every(Boolean);
  if (!containerCleaned || !directoriesCleaned) exitCode = 8;
}
process.exitCode = exitCode;
