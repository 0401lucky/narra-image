import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { require as tsxRequire } from "tsx/cjs/api";

import { createSessionToken } from "../../src/lib/auth/session-token.ts";
import { SESSION_COOKIE_NAME } from "../../src/lib/constants.ts";
import { assertE2EProject } from "../lib/e2e-safety.mjs";
import { canvasFixtureBytes } from "./canvas-object-store.mjs";

const RETENTION = JSON.parse(readFileSync(new URL("../../contracts/canvas/v1/retention.json", import.meta.url), "utf8"));
const GRAPH = JSON.parse(readFileSync(new URL("../../contracts/canvas/v1/scenarios/graph.json", import.meta.url), "utf8"));
const literal = (value, type = "text") => `'${String(value).replaceAll("'", "''")}'::${type}`;
const uuid = (value) => literal(value, "uuid");

function requireState(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { exitCode: 1 });
}

export async function loadCanvasRuntimeContracts() {
  // The host fixture consumes the real pure TS contracts. tsx handles their
  // JSON imports without copying canonicalization or loading server/DB code.
  const contracts = tsxRequire("../../src/lib/canvas/contracts.ts", import.meta.url);
  const validators = tsxRequire("../../src/lib/validators.ts", import.meta.url);
  return { ...contracts, canvasRunSchema: validators.canvasRunSchema };
}

export function canvasApiHeaders(session, json, extra = {}) {
  const headers = new Headers(extra);
  if (session) headers.set("cookie", session);
  if (json) headers.set("content-type", "application/json");
  return headers;
}

export function createCanvasRuntimeFixture(configuration, project) {
  assertE2EProject(configuration, project);
  requireState(project.canvas, "The canvas runtime fixture requires an enabled, owned project");
  return {
    ownerId: randomUUID(), otherOwnerId: randomUUID(), canvasId: randomUUID(), jobCanvasId: randomUUID(),
    runId: randomUUID(), nodeId: randomUUID(), jobId: randomUUID(), imageId: randomUUID(),
    generatedKey: `e2e/${configuration.owner}/${randomUUID()}.png`,
    legacyKey: `e2e/${configuration.owner}/${randomUUID()}.png`,
    assets: {}, scene: null,
  };
}

export function canvasGcInspectionSql(fixture) {
  const owner = literal(fixture.ownerId);
  return `SELECT json_build_object(
    'assets', (SELECT json_object_agg(id, json_build_object('state', state, 'key', "storageKey", 'accounted', "physicalBytesAccounted", 'outcome', "deleteOutcome", 'attempts', "deleteAttempts", 'retrySeconds', EXTRACT(EPOCH FROM ("nextDeleteAt"-"deleteExpiresAt")))) FROM "CanvasImportAsset" WHERE "ownerId"=${owner}),
    'savedRoots', (SELECT count(*) FROM "CanvasSavedAssetUse" WHERE "ownerId"=${owner}),
    'jobRoots', (SELECT count(*) FROM "CanvasJobAssetUse" WHERE "ownerId"=${owner} AND "originalJobId"=${literal(fixture.jobId)}),
    'credits', (SELECT credits FROM "User" WHERE id=${owner}),
    'jobs', (SELECT count(*) FROM "GenerationJob" WHERE "userId"=${owner}),
    'runs', (SELECT count(*) FROM "CanvasRun" WHERE "ownerId"=${owner}),
    'images', (SELECT count(*) FROM "GenerationImage" WHERE id=${literal(fixture.imageId)} AND "jobId"=${literal(fixture.jobId)}),
    'retainedJob', (SELECT status='SUCCEEDED' AND "cancelRequestedAt" IS NULL AND "refundAppliedAt" IS NULL FROM "GenerationJob" WHERE id=${literal(fixture.jobId)}),
    'deletedOrganization', (SELECT "deletedAt" IS NOT NULL FROM "Canvas" WHERE id=${uuid(fixture.jobCanvasId)})
  );`;
}

export function canvasGcClockSql(fixture) {
  const ids = Object.values(fixture.assets).map((asset) => literal(asset.id)).join(",");
  requireState(Object.keys(fixture.assets).length === 4 && Number.isSafeInteger(RETENTION.graceSeconds) && RETENTION.clock === "database", "Missing bounded canvas retention fixture");
  // Only fixture timestamps are seeded with triggers suspended, within the
  // verified throwaway DB transaction. Actual claims/finalizers use all guards.
  return `BEGIN;
    SET LOCAL session_replication_role = replica;
    UPDATE "CanvasImportAsset" SET "uploadExpiresAt"=clock_timestamp()-interval '10 days', "preparationExpiresAt"=NULL,
      "detachedAt"=clock_timestamp()-make_interval(secs=>CASE WHEN id=${literal(fixture.assets.recent.id)} THEN ${Math.floor(RETENTION.graceSeconds / 2)} ELSE ${RETENTION.graceSeconds + 60} END)
      WHERE "ownerId"=${literal(fixture.ownerId)} AND id IN (${ids});
    SET LOCAL session_replication_role = origin;
    COMMIT;`;
}

export function assertCanvasGcView(view, fixture, phase) {
  requireState(["failed", "deleted"].includes(phase), "Unknown GC assertion phase");
  requireState(view && view.assets && Object.keys(view.assets).length === 4, "GC lost or fabricated import inventory");
  for (const [name, asset] of Object.entries(fixture.assets)) {
    const row = view.assets[asset.id];
    requireState(row && typeof row.key === "string", `GC import inventory missing for ${name}`);
    if (name === "orphan") {
      requireState(row.state === (phase === "failed" ? "DELETING" : "DELETED")
        && row.outcome === (phase === "failed" ? "FAILED" : "DELETED")
        && row.accounted === (phase === "failed") && row.attempts === (phase === "failed" ? 1 : 2),
      `GC ${phase} outcome/accounting/fence is incomplete`);
      if (phase === "failed") requireState(row.retrySeconds >= 10 && row.retrySeconds <= 3600, "Failed GC delete has no bounded database backoff");
    } else requireState(row.state === "READY" && row.accounted === true && row.attempts === 0, `GC touched protected/recent import ${name}`);
  }
  requireState(view.savedRoots === 1 && view.jobRoots === 1 && view.jobs === 1 && view.runs === 1 && view.images === 1
    && view.credits === 100 && view.retainedJob === true && view.deletedOrganization === true,
  "GC changed snapshot/job roots, canonical works, credits, cancellation or deleted organization");
}

export async function runCanvasRuntimeSmoke({ configuration, project, request, sql, control, objects, wait }) {
  requireState(typeof request === "function", "Canvas API smoke requires the owned internal HTTP transport");
  const fixture = createCanvasRuntimeFixture(configuration, project);
  const contracts = await loadCanvasRuntimeContracts();
  const bytes = canvasFixtureBytes();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await sql(`INSERT INTO "User" (id,email,credits,"updatedAt") VALUES
    (${literal(fixture.ownerId)},${literal(`${fixture.ownerId}@e2e.invalid`)},100,clock_timestamp()),
    (${literal(fixture.otherOwnerId)},${literal(`${fixture.otherOwnerId}@e2e.invalid`)},100,clock_timestamp());`);
  const cookie = `${SESSION_COOKIE_NAME}=${await createSessionToken({ userId: fixture.ownerId, role: "user" }, configuration.authSecret)}`;
  const otherCookie = `${SESSION_COOKIE_NAME}=${await createSessionToken({ userId: fixture.otherOwnerId, role: "user" }, configuration.authSecret)}`;
  const api = async (route, { method = "GET", body, expected = 200, session = cookie, headers = {} } = {}) => {
    const multipart = body instanceof FormData;
    const response = await request(route, {
      method, headers: canvasApiHeaders(session, body !== undefined && !multipart, headers),
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
    });
    requireState(response.status === expected && response.body && typeof response.body === "object", `Canvas API ${method} ${route} returned ${response.status}: ${JSON.stringify(response.body).slice(0, 200)}`);
    return response.body;
  };
  // HTTP-only SSR acceptance, before any historical job fixture is installed;
  // this is not a browser/hydration or login-flow claim.
  const page = await request("/create", { headers: { cookie } });
  requireState(page.status === 200 && page.contentType?.startsWith("text/html") && typeof page.body === "string", "Authenticated create page did not render HTML");
  const html = page.body;
  requireState(html.includes('aria-label="\u521b\u4f5c\u6a21\u5f0f"') && html.includes("\u753b\u5e03"), "Authenticated create page did not mount the enabled dual-mode studio");
  const base = `/api/me/canvases/${fixture.canvasId}`;
  await api("/api/me/canvases", { expected: 401, session: "" });
  const created = await api("/api/me/canvases", { method: "POST", body: { id: fixture.canvasId, title: "E2E saved originals" } });
  requireState(created.data?.canvas?.revision === 0 && created.data.canvas.hasSavedSnapshot === false, "New canvas was not an empty unsaved shell");
  requireState((await api(base)).data?.scene === null, "New canvas unexpectedly contains a scene");
  requireState((await api(base, { session: otherCookie, expected: 404 })).code === "CANVAS_NOT_FOUND", "Foreign account read did not fail closed");
  const upload = async (uploadId) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ uploadId, byteLength: String(bytes.length), mimeType: "image/png", sha256 })) form.set(key, value);
    form.set("file", new Blob([bytes], { type: "image/png" }), "original.png");
    const uploaded = await api("/api/me/canvas-assets", { method: "POST", body: form });
    const asset = uploaded.data?.asset;
    requireState(asset?.state === "READY" && /^[A-Za-z0-9_.:-]{1,128}$/.test(asset.id)
      && asset.byteLength === bytes.length && asset.sha256 === sha256 && asset.uploadId === uploadId
      && typeof asset.url === "string" && asset.url.startsWith(`http://object-store:9090/${project.bucket}/canvas-imports/`), "Actual original upload did not publish the verified fixture asset");
    return asset;
  };
  for (const name of ["orphan", "recent", "saved", "job"]) fixture.assets[name] = await upload(randomUUID());
  const replay = await upload(fixture.assets.saved.uploadId);
  requireState(replay.id === fixture.assets.saved.id, "Upload replay created a second identity");
  fixture.scene = {
    schemaVersion: 1,
    nodes: [{ id: randomUUID(), kind: "reference", position: { x: -80, y: 40 }, source: { kind: "imported", assetId: replay.id } }],
    edges: [], viewport: { x: -10, y: 20, zoom: 0.75 }, runBindings: [],
  };
  const saveId = randomUUID();
  const receipt = await api(`${base}/snapshot`, { method: "PUT", body: { expectedRevision: 0, saveId, scene: fixture.scene } });
  requireState(receipt.data?.acknowledgedRevision === 1 && receipt.data.saveId === saveId, "Snapshot acknowledgement is missing");
  const reopened = await api(base);
  requireState(reopened.data?.canvas?.revision === 1 && reopened.data.canvas.hasSavedSnapshot === true
    && isDeepStrictEqual(reopened.data.scene, fixture.scene), "Authenticated snapshot/original did not round-trip");
  const conflict = await api(`${base}/snapshot`, { method: "PUT", body: { expectedRevision: 0, saveId: randomUUID(), scene: fixture.scene }, expected: 409 });
  requireState(conflict.code === "CANVAS_REVISION_CONFLICT", "Stale snapshot did not return the expected conflict");
  const foreignAsset = await api(`/api/me/canvas-assets/${replay.id}`, { session: otherCookie, expected: 409 });
  requireState(foreignAsset.code === "CANVAS_INPUT_UNAVAILABLE" && !Object.hasOwn(foreignAsset, "data"), "Foreign asset response disclosed input data");
  const smoke = JSON.parse(await sql(`SELECT json_build_object('jobs',(SELECT count(*) FROM "GenerationJob" WHERE "userId"=${literal(fixture.ownerId)}),'credits',(SELECT credits FROM "User" WHERE id=${literal(fixture.ownerId)}));`));
  const initialStore = await control("status");
  requireState(smoke.jobs === 0 && smoke.credits === 100 && initialStore.counters.put === 4 && initialStore.counters.delete === 0 && initialStore.objectCount === 4,
    "Create/upload/replay/save caused a generation, charge, duplicate PUT or deletion");
  console.log(`[verify:e2e] PASS ${project.label} authenticated SSR/create/upload/replay/snapshot/CAS/owner isolation (no generation/charge)`);

  await api("/api/me/canvases", { method: "POST", body: { id: fixture.jobCanvasId, title: "E2E deleted organization" } });
  const parameters = { ...GRAPH.scene.nodes.find((node) => node.kind === "generation").parameters, count: 1, negativePrompt: null, seed: null, generationType: "image_to_image" };
  const wire = contracts.canvasRunSchema.parse({ canvasId: fixture.jobCanvasId, nodeId: fixture.nodeId, runId: fixture.runId,
    input: { prompt: { sourceNodeId: randomUUID(), text: "Frozen fixture input" }, references: [{ sourceNodeId: randomUUID(), ordinal: 1, kind: "imported", assetId: fixture.assets.job.id }] }, parameters });
  const serializedWire = contracts.canonicalCanvasJson(wire);
  const intentHash = createHash("sha256").update(contracts.canonicalCanvasJson({ canvasRun: wire, credentialFingerprint: null })).digest("hex");
  await sql(`BEGIN;
    INSERT INTO "GenerationJob" (id,"userId","providerMode","generationType",model,prompt,size,count,status,"sourceImageUrls","completedAt","updatedAt") VALUES
      (${literal(fixture.jobId)},${literal(fixture.ownerId)},'BUILT_IN','IMAGE_TO_IMAGE','gpt-image-2','Frozen fixture input','auto',1,'SUCCEEDED',ARRAY[${literal(fixture.assets.job.url)}],clock_timestamp(),clock_timestamp());
    SELECT canvas_reserve_run(${literal(fixture.ownerId)},${uuid(fixture.jobCanvasId)},${uuid(fixture.nodeId)},${uuid(fixture.runId)},${literal(intentHash)},${literal(serializedWire, "jsonb")});
    SELECT canvas_commit_run(${literal(fixture.ownerId)},${uuid(fixture.runId)},(SELECT "preparationToken" FROM "CanvasRun" WHERE "ownerId"=${literal(fixture.ownerId)} AND "runId"=${uuid(fixture.runId)}),${literal(fixture.jobId)});
    INSERT INTO "GenerationImage" (id,"jobId",url,"mediaStorage","storageKey") VALUES (${literal(fixture.imageId)},${literal(fixture.jobId)},${literal(`http://object-store:9090/${project.bucket}/${fixture.generatedKey}`)},'S3',${literal(fixture.generatedKey)});
    COMMIT;`);
  const replayRun = async () => {
    const replayed = await api("/api/generate", { method: "POST", body: { canvasRun: wire }, headers: contracts.CANVAS_RUN_REQUEST_HEADERS });
    requireState(replayed.data?.generation?.id === fixture.jobId && replayed.data.generation.status === "succeeded"
      && replayed.data.generation.images?.some((image) => image.id === fixture.imageId)
      && isDeepStrictEqual(replayed.data.canvasRun, { canvasId: fixture.jobCanvasId, nodeId: fixture.nodeId, runId: fixture.runId, jobId: fixture.jobId }), "Committed run replay did not return its original canonical job/origin");
    const lookup = await api(`/api/me/canvas-runs/${fixture.runId}`);
    requireState(lookup.data?.state === "COMMITTED" && lookup.data.jobId === fixture.jobId && lookup.data.generation?.id === fixture.jobId, "Committed run lookup lost its canonical job");
  };
  await replayRun();
  const runtime = await api("/api/me/canvas-runtime/resolve", { method: "POST", body: {
    canvasId: fixture.jobCanvasId, runIds: [fixture.runId], jobIds: [fixture.jobId], imageIds: [fixture.imageId], assetIds: [fixture.assets.job.id],
    runBindings: [{ nodeId: fixture.nodeId, runId: fixture.runId, jobId: fixture.jobId, outputsHandled: false }],
  } });
  requireState(runtime.data?.missing?.length === 0 && Object.keys(runtime.data.generations).length === 1
    && runtime.data.generations[fixture.jobId]?.id === fixture.jobId && runtime.data.images[fixture.imageId]?.jobId === fixture.jobId
    && runtime.data.assets[fixture.assets.job.id]?.state === "READY" && runtime.data.runs[fixture.runId]?.jobId === fixture.jobId,
  "Explicit scene-ID runtime resolution did not hydrate the canonical identities");
  await api(`/api/me/canvases/${fixture.jobCanvasId}`, { method: "DELETE", body: { expectedRevision: 0 } });
  await replayRun();
  const replayFacts = JSON.parse(await sql(`SELECT json_build_object('jobs',(SELECT count(*) FROM "GenerationJob" WHERE "userId"=${literal(fixture.ownerId)}),'runs',(SELECT count(*) FROM "CanvasRun" WHERE "ownerId"=${literal(fixture.ownerId)}),'credits',(SELECT credits FROM "User" WHERE id=${literal(fixture.ownerId)}),'frozen',(SELECT "inputSnapshot"=${literal(serializedWire, "jsonb")} AND "intentHash"=${literal(intentHash)} FROM "CanvasRun" WHERE "ownerId"=${literal(fixture.ownerId)} AND "runId"=${uuid(fixture.runId)}));`));
  requireState(replayFacts.jobs === 1 && replayFacts.runs === 1 && replayFacts.credits === 100 && replayFacts.frozen === true
    && (await control("status")).counters.put === 4, "Committed replay duplicated a job/run/import, charged credits or changed its frozen intent");
  console.log(`[verify:e2e] PASS ${project.label} seeded-COMMITTED /api/generate replay before/after deletion, lookup and explicit runtime IDs (no fresh enqueue/debit)`);
  await objects("put", [fixture.generatedKey, fixture.legacyKey]);
  await control("fail-deletes");
  await sql(canvasGcClockSql(fixture));
  const inspect = async () => JSON.parse(await sql(canvasGcInspectionSql(fixture)));
  const failed = await wait(inspect, (view) => view?.assets?.[fixture.assets.orphan.id]?.outcome === "FAILED", "managed GC failed-delete/backoff");
  assertCanvasGcView(failed, fixture, "failed");
  const keys = [...Object.values(failed.assets).map((asset) => asset.key), fixture.generatedKey, fixture.legacyKey];
  const retained = await objects("head", keys);
  const failedStore = await control("status");
  requireState(retained.every((entry) => entry.status === 200) && failedStore.objectCount === 6
    && failedStore.counters.put === 6 && failedStore.counters.delete === 1 && failedStore.bytesStored === 6 * bytes.length,
  "Failed delete touched a protected object or lost physical bytes");
  await control("allow-deletes");
  const deleted = await wait(inspect, (view) => view?.assets?.[fixture.assets.orphan.id]?.state === "DELETED", "managed GC successful retry");
  assertCanvasGcView(deleted, fixture, "deleted");
  const remaining = await objects("head", keys);
  const finalStore = await control("status");
  const orphanKey = deleted.assets[fixture.assets.orphan.id].key;
  requireState(remaining.length === keys.length && remaining.every((entry) => entry.status === (entry.key === orphanKey ? 404 : 200))
    && finalStore.objectCount === 5 && finalStore.counters.delete === 2 && finalStore.counters.put === 6 && finalStore.bytesStored === 5 * bytes.length,
  "Managed GC did not delete only the old unrooted key while retaining recent/saved/completed-job/generated/legacy objects");
  console.log(`[verify:e2e] PASS ${project.label} managed GC: failed delete/backoff, exact-key retry, seven-day grace, saved/completed-job roots, deleted organization and generated/legacy retention`);
}
