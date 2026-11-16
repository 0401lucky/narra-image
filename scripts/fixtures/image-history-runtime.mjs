import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";

import { createSessionToken } from "../../src/lib/auth/session-token.ts";
import { SESSION_COOKIE_NAME } from "../../src/lib/constants.ts";
import { assertE2EProject } from "../lib/e2e-safety.mjs";
import { canvasFixtureBytes } from "./canvas-object-store.mjs";
import { canvasApiHeaders } from "./canvas-runtime.mjs";

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const emptyManifest = () => ({ schemaVersion: 1, locations: [], bindings: [] });
const generation = Object.freeze({ prompt: "isolated image history proof", providerMode: "built_in", model: "gpt-image-2", generationType: "text_to_image", size: "auto", quality: "auto", outputFormat: "png", count: 1 });

export function imageHistoryFixtureLocations(project) {
  const endpoint = "http://object-store:9090";
  return [
    { id: `s3-v1:${hash(JSON.stringify([endpoint, "us-east-1", project.bucket]))}`, provider: "S3", endpoint, region: "us-east-1", bucket: project.bucket, publicBaseUrl: `${endpoint}/${project.bucket}` },
    { id: `local-v1:${project.volumeId}`, provider: "LOCAL", volumeId: project.volumeId },
  ];
}

// The caller supplies the same owner-checked SQL and CLI boundaries as the
// surrounding scenario. A successful public read does not enable maintenance.
export async function enableImageHistoryRetirementPolicy({ query, resume, subjectId }) {
  const policy = await query(`SELECT to_jsonb(p) || jsonb_build_object('limitBytes',p."limitBytes"::text)
    FROM "ImageStoragePolicy" p WHERE scope='images';`);
  assert.equal(policy.enabled, false, "History retirement must first prove the default disabled policy");
  const refused = await resume();
  assert.deepEqual({ schemaVersion: refused.schemaVersion, dryRun: refused.dryRun, code: refused.code, status: refused.status },
    { schemaVersion: 1, dryRun: false, code: "IMAGE_HISTORY_PENDING", status: "pending" });
  const item = refused.progress?.items?.find((entry) => entry.subjectKind === "CANVAS_IMPORT" && entry.subjectId === subjectId);
  assert.equal(item?.code, "IMAGE_POLICY_DISABLED", "Published-reader recovery must still respect the disabled policy");
  assert.deepEqual({ state: item.state, acknowledged: item.stateAcknowledged, readerVerified: item.readerVerified, retirement: item.retirementJobId },
    { state: "BLOCKED", acknowledged: true, readerVerified: true, retirement: null });
  const input = { expectedVersion: policy.version, enabled: true, limitBytes: policy.limitBytes,
    quotaCleanupEnabled: false, scheduleEnabled: false, retentionDays: policy.retentionDays, intervalSeconds: policy.intervalSeconds };
  const updated = await query(`SELECT image_update_storage_policy(${literal(JSON.stringify(input))}::jsonb);`);
  assert.equal(updated.version, policy.version + 1);
  assert.equal(updated.enabled, true);
  assert.equal(updated.quotaCleanupEnabled, false);
  assert.equal(updated.scheduleEnabled, false);
  assert.equal(updated.nextRunAt, null);
}

/** All I/O is supplied by the owner-checked E2E harness. No ambient DB/storage. */
export async function runImageHistorySmoke({ configuration, project, request, sql, objects, control, cli, withDrainedCanvas, wait, enableManaged, recreate, volumeFiles, negativeChecks }) {
  assertE2EProject(configuration, project);
  assert(project.images && project.canvas && !project.managedImages, "History proof must begin with real legacy S3 writers");
  const bytes = canvasFixtureBytes();
  const digest = hash(bytes);
  const ownerId = randomUUID();
  const canvasId = randomUUID();
  const legacyJobId = randomUUID();
  const nullImageId = randomUUID();
  const thirdPartyImageId = randomUUID();
  const videoId = randomUUID();
  const keys = Object.fromEntries(["null", "reference", "unknown", "video"].map((name) => [name, `e2e/${project.owner}/${randomUUID()}.png`]));
  const sourceUrl = (key) => `http://object-store:9090/${project.bucket}/${key}`;
  const publicBase = project.label === "image-embedded" ? "http://embedded:3000" : "http://app:3000";
  const locations = imageHistoryFixtureLocations(project);
  const [sourceLocation, targetLocation] = locations;
  const cookie = `${SESSION_COOKIE_NAME}=${await createSessionToken({ userId: ownerId, role: "user" }, configuration.authSecret)}`;
  const query = async (text) => JSON.parse(await sql(text));
  const api = async (route, method, body, expected = 200) => {
    const multipart = body instanceof FormData;
    const response = await request(route, { method, headers: canvasApiHeaders(cookie, body !== undefined && !multipart),
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(response.body).slice(0, 300)}`);
    return response.body;
  };
  const job = async (id) => query(`SELECT json_build_object('id',j.id,'status',j.status,'sources',j."sourceImageUrls",'imageId',i.id,'url',i.url,'key',i."storageKey",'storage',i."mediaStorage",'assetId',i."mediaAssetId") FROM "GenerationJob" j LEFT JOIN "GenerationImage" i ON i."jobId"=j.id WHERE j.id=${literal(id)};`);
  const submit = async (body) => {
    const accepted = await api("/api/generate", "POST", body);
    const id = accepted.data?.generation?.id;
    assert.equal(typeof id, "string", "Actual generation API must enqueue a job");
    const result = await wait(() => job(id), (value) => ["SUCCEEDED", "FAILED"].includes(value?.status), "actual Worker image generation");
    assert.equal(result.status, "SUCCEEDED", "Real Worker must complete the fixture generation");
    return result;
  };
  const upload = async (uploadId = randomUUID()) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ uploadId, byteLength: String(bytes.length), mimeType: "image/png", sha256: digest })) form.set(key, value);
    form.set("file", new Blob([bytes], { type: "image/png" }), "fixture.png");
    return (await api("/api/me/canvas-assets", "POST", form)).data.asset;
  };
  const accounted = async () => query(`SELECT json_build_object(
    'used',(SELECT "usedBytes"::text FROM "ImageQuota" WHERE scope='images'),
    'reserved',(SELECT "reservedBytes"::text FROM "ImageQuota" WHERE scope='images'),
    'assets',(SELECT count(*) FROM "ImageAsset"), 'objects',(SELECT count(*) FROM "ImageObject"),
    'historyJobs',(SELECT count(*) FROM "ImageHistoryJob"), 'historyItems',(SELECT count(*) FROM "ImageHistoryItem"),
    'observations',(SELECT count(*) FROM "ImageObjectObservation"), 'aliases',(SELECT count(*) FROM "ImageUrlAlias"));`);
  const readImage = async (url) => {
    const path = new URL(url).pathname;
    assert.match(path, /^\/media\/images\/[a-f0-9]{64}$/);
    const result = await request(path);
    assert.equal(result.status, 200, "Actual media route must read a persisted object");
    assert.deepEqual(Buffer.from(result.bodyBase64, "base64"), bytes);
    assert.equal(result.headers["content-length"], String(bytes.length));
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    const head = await request(path, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.bodyBase64, "");
    assert.equal((await request(path, { headers: { "if-none-match": result.headers.etag } })).status, 304);
  };
  const proxy = async (url) => {
    const result = await request(`/api/proxy-image?url=${encodeURIComponent(url)}`, { headers: { cookie } });
    assert.equal(result.status, 200, "Exact historical URL must resolve through the real app");
    assert.deepEqual(Buffer.from(result.bodyBase64, "base64"), bytes);
  };

  await sql(`INSERT INTO "User" (id,email,credits,"updatedAt") VALUES (${literal(ownerId)},${literal(`${ownerId}@e2e.invalid`)},500,clock_timestamp());`);
  const generated = await submit(generation);
  assert.equal(generated.storage, "S3");
  assert.equal(generated.assetId, null);
  await api("/api/me/canvases", "POST", { id: canvasId, title: "Legacy imported original" });
  const imported = await upload();
  assert.equal(imported.state, "READY");
  assert.equal((await upload(imported.uploadId)).id, imported.id);
  const scene = { schemaVersion: 1, nodes: [{ id: randomUUID(), kind: "reference", position: { x: 0, y: 0 }, source: { kind: "imported", assetId: imported.id } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, runBindings: [] };
  await api(`/api/me/canvases/${canvasId}/snapshot`, "PUT", { expectedRevision: 0, saveId: randomUUID(), scene });
  const originalCanvas = await query(`SELECT json_build_object('id',id,'uploadId',"uploadId",'sourceProvider',"sourceProvider",'storageLocation',"storageLocation",'storageEndpoint',"storageEndpoint",'storageRegion',"storageRegion",'storageBucket',"storageBucket",'storageKey',"storageKey",'sha256',sha256,'byteLength',"byteLength"::text) FROM "CanvasImportAsset" WHERE id=${literal(imported.id)};`);
  assert.equal(originalCanvas.sourceProvider, "S3");
  await sql(`INSERT INTO "LoginCoverConfig" (id,scope,mode,"customUrl","updatedAt") VALUES (${literal(randomUUID())},'default','custom',${literal(imported.url)},clock_timestamp())
    ON CONFLICT (scope) DO UPDATE SET mode='custom',"customUrl"=EXCLUDED."customUrl","updatedAt"=clock_timestamp();`);
  await objects("put", Object.values(keys));
  await sql(`INSERT INTO "GenerationJob" (id,"userId","providerMode","generationType",model,prompt,size,count,status,"sourceImageUrls","completedAt","updatedAt") VALUES
    (${literal(legacyJobId)},${literal(ownerId)},'BUILT_IN','IMAGE_TO_IMAGE','gpt-image-2','Immutable old reference','auto',1,'SUCCEEDED',ARRAY[${literal(sourceUrl(keys.reference))}],clock_timestamp(),clock_timestamp());
    INSERT INTO "GenerationImage" (id,"jobId",url,"storageKey") VALUES
      (${literal(nullImageId)},${literal(legacyJobId)},${literal(sourceUrl(keys.null))},${literal(keys.null)}),
      (${literal(thirdPartyImageId)},${literal(legacyJobId)},'https://third-party.invalid/untouched.png',NULL);
    INSERT INTO "GeneratedVideo" (id,"jobId",url,"posterUrl","mediaStorage","storageKey") VALUES
      (${literal(videoId)},${literal(legacyJobId)},${literal(sourceUrl(keys.video))},${literal(sourceUrl(keys.video))},'S3',${literal(keys.video)});`);
  const beforeFrozen = await query(`SELECT json_build_object('sources',"sourceImageUrls",'prompt',prompt) FROM "GenerationJob" WHERE id=${literal(legacyJobId)};`);
  const legacySourceKeys = [generated.key, originalCanvas.storageKey, keys.null, keys.reference];

  await enableManaged();
  assert(project.managedImages && project.workerManagedImages);
  // Reuse the C1 real HTTP flow: Node imports/uploads and actual Worker output,
  // anonymous bytes, HEAD/304 and real Next optimizer, now inside both images.
  const freshGenerated = await submit(generation);
  const referenceForm = new FormData();
  for (const [key, value] of Object.entries({ ...generation, generationType: "image_to_image" })) referenceForm.set(key, String(value));
  referenceForm.set("images", new Blob([bytes], { type: "image/png" }), "reference.png");
  const freshEdited = await submit(referenceForm);
  const freshImport = await upload();
  assert.equal((await upload(freshImport.uploadId)).id, freshImport.id);
  assert.equal(freshGenerated.storage, "LOCAL");
  assert.equal(freshEdited.storage, "LOCAL");
  assert.equal(freshEdited.sources.length, 1);
  const freshUrls = [freshGenerated.url, freshEdited.url, freshEdited.sources[0], freshImport.url];
  for (const url of freshUrls) await readImage(url);
  const optimized = await request(`/_next/image?url=${encodeURIComponent(freshGenerated.url)}&w=384&q=75`);
  assert.equal(optimized.status, 200, "Real Next optimizer must serve the persisted image");
  assert.match(optimized.contentType, /^image\//);
  assert(Buffer.from(optimized.bodyBase64, "base64").length > 0);
  const initial = await accounted();
  assert.equal(initial.used, String(4 * bytes.length));
  assert.equal(initial.reserved, "0");
  assert.equal(initial.objects, 4);

  const subjects = [
    { subjectKind: "GENERATED", subjectId: generated.imageId, key: generated.key },
    { subjectKind: "GENERATED", subjectId: nullImageId, key: keys.null },
    { subjectKind: "REFERENCE_URL", subjectId: hash(sourceUrl(keys.reference)), key: keys.reference },
    { subjectKind: "CANVAS_IMPORT", subjectId: imported.id, key: originalCanvas.storageKey },
  ];
  const discover = async (scope = "ALL") => {
    const report = await cli(["--scope", scope, "--limit", "100"], emptyManifest());
    assert.equal(report.dryRun, true);
    assert(Array.isArray(report.plan?.items));
    return report.plan;
  };
  const manifestFor = (report, scope = "ALL") => ({ schemaVersion: 1, locations, bindings: subjects.filter((subject) => scope === "ALL" || subject.subjectKind === scope).map((subject) => {
    const candidate = report.items.find((item) => item.subjectKind === subject.subjectKind && item.subjectId === subject.subjectId);
    assert(candidate, `History scan lost the ${subject.subjectKind} business record`);
    return { ...subject, expectedSnapshotHash: candidate.snapshotHash, locationId: sourceLocation.id, ownerId };
  }) });
  const beforeStore = await control("status");
  const beforeFiles = await volumeFiles();
  const discovered = await discover();
  assert(discovered.items.some((item) => item.subjectId === thirdPartyImageId && item.classification === "THIRD_PARTY_OR_UNKNOWN"));
  assert(discovered.items.some((item) => item.classification === "VIDEO_EXCLUDED"));
  const plan = await cli(["--target-location", targetLocation.id, "--limit", "100"], manifestFor(discovered));
  assert.equal(plan.dryRun, true);
  assert.equal(plan.plan?.targetWritableVerified, false, "Dry-run must not claim a writable probe");
  assert.deepEqual(await accounted(), initial, "Dry-run mutated database history, quota, objects or aliases");
  const plannedStore = await control("status");
  assert.equal(plannedStore.counters.put, beforeStore.counters.put);
  assert.equal(plannedStore.counters.delete, beforeStore.counters.delete);
  assert.deepEqual(await volumeFiles(), beforeFiles);

  const migrationJobs = [];
  const runCopy = async (scope, retireSource) => {
    const discovery = await discover(scope);
    const manifest = manifestFor(discovery, scope);
    const requestId = randomUUID();
    const begin = async (execute = cli) => {
      const first = await execute(["--apply", "--request-id", requestId, "--actor-id", ownerId, "--scope", scope,
        "--target-location", targetLocation.id, "--limit", "1", ...(retireSource ? ["--retire-source"] : [])], manifest);
      const history = await query(`SELECT json_build_object('id',id,'retireSource',"retireSource") FROM "ImageHistoryJob" WHERE "requestId"=${literal(requestId)}::uuid;`);
      assert(history?.id && first.dryRun === false, "Apply must persist an auditable job");
      assert.equal(history.retireSource, retireSource);
      if (scope === "CANVAS_IMPORT") {
        // With the app stopped, verified copy/switch succeeds but the frozen
        // retirement intent must wait for a real published reader. Resume the
        // same item after restart instead of changing intent or copying twice.
        const pending = await query(`SELECT json_build_object('state',i.state,'errorCode',i."errorCode",'retirement',i."retirementJobId",
          'verified',i."replicaVerificationId" IS NOT NULL,'sourceState',s.state,'sourceAccounted',s.accounted,
          'targetState',t.state,'active',a."activeObjectId"=t.id,'bound',c."mediaAssetId"=a.id)
          FROM "ImageHistoryItem" i JOIN "ImageObject" s ON s.id=i."sourceObjectId" JOIN "ImageObject" t ON t.id=i."targetObjectId"
          JOIN "ImageAsset" a ON a.id=i."assetId" JOIN "CanvasImportAsset" c ON c.id=i."subjectId"
          WHERE i."jobId"=${literal(history.id)}::uuid AND i."subjectId"=${literal(imported.id)};`);
        assert.deepEqual(pending, { state: "BLOCKED", errorCode: "IMAGE_READER_INCOMPATIBLE", retirement: null,
          verified: true, sourceState: "READY", sourceAccounted: true, targetState: "READY", active: true, bound: true });
        assert.equal((await objects("head", [originalCanvas.storageKey]))[0].status, 200, "Offline copy must retain the source");
      }
      return history;
    };
    const history = scope === "CANVAS_IMPORT" ? await withDrainedCanvas(begin) : await begin();
    const resume = () => cli(["--apply", "--job-id", history.id, "--actor-id", ownerId, "--limit", "100"], manifest);
    if (retireSource) {
      const beforePolicy = await accounted();
      const beforePolicyStore = await control("status");
      await enableImageHistoryRetirementPolicy({ query, resume, subjectId: imported.id });
      const afterPolicy = await accounted();
      for (const field of ["used", "reserved", "assets", "objects", "observations", "aliases"]) {
        assert.equal(afterPolicy[field], beforePolicy[field], `Disabled retirement and policy activation changed ${field}`);
      }
      const afterPolicyStore = await control("status");
      assert.equal(afterPolicyStore.counters.put, beforePolicyStore.counters.put, "Disabled retirement must not copy again");
      assert.equal(afterPolicyStore.counters.delete, beforePolicyStore.counters.delete, "Disabled retirement must not attempt source deletion");
      assert.equal((await objects("head", [originalCanvas.storageKey]))[0].status, 200, "Disabled retirement must retain the source");
    }
    const inspect = () => query(`SELECT json_build_object('scanComplete',j."scanComplete",'pending',(SELECT count(*) FROM "ImageHistoryItem" WHERE "jobId"=j.id AND (state NOT IN ('SOURCE_RETAINED','RETIREMENT_REQUESTED','EXCLUDED') OR (j."retireSource" AND state='SOURCE_RETAINED' AND "retirementJobId" IS NULL))),'blocked',(SELECT count(*) FROM "ImageHistoryItem" WHERE "jobId"=j.id AND state='BLOCKED')) FROM "ImageHistoryJob" j WHERE id=${literal(history.id)}::uuid;`);
    await wait(async () => {
      await resume();
      return inspect();
    }, (state) => state?.scanComplete && state.pending === 0, `${scope} checkpoint resume`, 180_000);
    const completed = await accounted();
    const replayStore = await control("status");
    await cli(["--apply", "--job-id", history.id, "--actor-id", ownerId, "--limit", "100"], manifest);
    assert.deepEqual(await accounted(), completed, "Completed apply replay created or accounted another object");
    assert.equal((await control("status")).counters.put, replayStore.counters.put);
    migrationJobs.push(history.id);
  };

  await runCopy("GENERATED", false);
  await runCopy("REFERENCE_URL", false);
  const retained = await accounted();
  assert.equal(retained.used, String(10 * bytes.length), "Both source and target copies must consume quota");
  assert.equal(retained.reserved, "0");
  assert((await objects("head", legacySourceKeys)).every((item) => item.status === 200), "Default migration must retain every source");
  assert.equal((await control("status")).counters.delete, beforeStore.counters.delete);
  for (const url of [generated.url, sourceUrl(keys.null), sourceUrl(keys.reference)]) await proxy(url);

  await control("fail-deletes");
  await runCopy("CANVAS_IMPORT", true);
  const canvasState = () => query(`SELECT json_build_object('state',a.state,'accounted',c."physicalBytesAccounted",'provider',active.provider,
    'sourceState',source.state,'sourceOutcome',source."deleteOutcome",'sourceAccounted',source.accounted,
    'copies',(SELECT count(*) FROM "ImageObject" WHERE "assetId"=a.id),
    'savedRoots',(SELECT count(*) FROM "ImageReference" WHERE "assetId"=a.id AND kind='CANVAS_SAVED'))
    FROM "CanvasImportAsset" c JOIN "ImageAsset" a ON a.id=c."mediaAssetId"
    JOIN "ImageObject" source ON source."assetId"=a.id AND source."locationId"=${literal(sourceLocation.id)}
    JOIN "ImageObject" target ON target.id=a."activeObjectId" JOIN "ImageStorageLocation" active ON active.id=target."locationId"
    WHERE c.id=${literal(imported.id)};`);
  const failed = await wait(canvasState, (row) => row?.sourceOutcome === "FAILED", "failed source retirement retains physical accounting", 180_000);
  assert.equal(failed.accounted, true);
  assert.equal(failed.sourceAccounted, true);
  assert.equal(failed.state, "AVAILABLE");
  assert.equal((await accounted()).used, String(12 * bytes.length));
  await proxy(imported.url);
  await control("allow-deletes");
  const retired = await wait(canvasState, (row) => row?.sourceState === "DELETED", "confirmed source retirement", 180_000);
  assert.equal(retired.sourceAccounted, false);
  assert.equal(retired.state, "AVAILABLE");
  assert.equal(retired.provider, "LOCAL");
  assert.equal(retired.accounted, true, "Source retirement must keep the Canvas logical quota");
  assert.equal(retired.copies, 2);
  assert.equal(retired.savedRoots, 1);
  assert.equal((await accounted()).used, String(11 * bytes.length));
  const sourceHeads = await objects("head", [...legacySourceKeys, keys.unknown, keys.video]);
  assert(sourceHeads.every((item) => item.status === (item.key === originalCanvas.storageKey ? 404 : 200)));
  await proxy(imported.url);
  const browserGeneration = (await api(`/api/me/generations/${generated.id}`, "GET")).data.generation;
  assert(browserGeneration.images[0].url.startsWith(`${publicBase}/media/images/`));
  assert.notEqual(browserGeneration.images[0].url, generated.url, "Browser DTO leaked the retired-source provenance URL");
  await readImage(browserGeneration.images[0].url);
  const browserHistory = (await api(`/api/me/generations/${legacyJobId}`, "GET")).data.generation;
  assert.equal(browserHistory.sourceImageUrls.length, 1);
  assert(browserHistory.sourceImageUrls[0].startsWith(`${publicBase}/media/images/`));
  await readImage(browserHistory.sourceImageUrls[0]);
  const browserCanvas = (await api("/api/me/canvas-runtime/resolve", "POST", {
    canvasId, runIds: [], jobIds: [generated.id], imageIds: [generated.imageId], assetIds: [imported.id], runBindings: [],
  })).data;
  assert.equal(browserCanvas.images[generated.imageId].url, browserGeneration.images[0].url);
  const coverUrl = browserCanvas.assets[imported.id].url;
  await readImage(coverUrl);
  const login = await request("/login");
  assert.equal(login.status, 200);
  assert(typeof login.body === "string" && (login.body.includes(coverUrl) || login.body.includes(encodeURIComponent(coverUrl))), "Actual login HTML did not use the managed cover URL");
  assert.equal(await query(`SELECT to_json("customUrl") FROM "LoginCoverConfig" WHERE scope='default';`), imported.url);

  const preserved = await query(`SELECT json_build_object('canvas',(SELECT json_build_object('id',id,'uploadId',"uploadId",'sourceProvider',"sourceProvider",'storageLocation',"storageLocation",'storageEndpoint',"storageEndpoint",'storageRegion',"storageRegion",'storageBucket',"storageBucket",'storageKey',"storageKey",'sha256',sha256,'byteLength',"byteLength"::text) FROM "CanvasImportAsset" WHERE id=${literal(imported.id)}),
    'frozen',(SELECT json_build_object('sources',"sourceImageUrls",'prompt',prompt) FROM "GenerationJob" WHERE id=${literal(legacyJobId)}),
    'generatedUrl',(SELECT url FROM "GenerationImage" WHERE id=${literal(generated.imageId)}),
    'nullMetadata',(SELECT "mediaStorage" IS NULL FROM "GenerationImage" WHERE id=${literal(nullImageId)}),
    'video',(SELECT "storageKey"=${literal(keys.video)} AND url=${literal(sourceUrl(keys.video))} FROM "GeneratedVideo" WHERE id=${literal(videoId)}),
    'thirdParty',(SELECT "mediaAssetId" IS NULL FROM "GenerationImage" WHERE id=${literal(thirdPartyImageId)}));`);
  assert.deepEqual(preserved.canvas, originalCanvas);
  assert.deepEqual(preserved.frozen, beforeFrozen);
  assert.equal(preserved.generatedUrl, generated.url);
  assert.equal(preserved.nullMetadata, true);
  assert.equal(preserved.video, true);
  assert.equal(preserved.thirdParty, true);
  assert.deepEqual((await api(`/api/me/canvases/${canvasId}`, "GET")).data.scene, scene);
  const migratedUrls = await query(`SELECT json_agg(${literal(`${publicBase}/media/images/`)}||a."publicToken") FROM "ImageAsset" a WHERE a."ownerId"=${literal(ownerId)};`);
  const files = await volumeFiles();
  assert.equal(files.files.length, 8, "Only eight LOCAL image files should exist after the migrations");
  assert(files.files.every((file) => file.sha256 === digest && file.bytes === bytes.length));
  const quotaBeforeRestart = await accounted();
  await recreate();
  assert.deepEqual(await volumeFiles(), files, "Container recreation lost or rewrote the shared volume");
  for (const url of migratedUrls) await readImage(url);
  for (const url of [generated.url, sourceUrl(keys.null), sourceUrl(keys.reference), imported.url]) await proxy(url);
  assert.deepEqual(await accounted(), quotaBeforeRestart);
  await negativeChecks();
  for (const url of migratedUrls) await readImage(url);
  const finalStore = await control("status");
  assert.equal(finalStore.providerRequests, 3, "Migration must never call the paid image provider");
  console.log(JSON.stringify({ imageHistoryTopology: project.label, result: "passed", actualAppAndWorker: true,
    sourceBindings: subjects.length, migrationJobs: migrationJobs.length, sourceRetained: 3, sourceRetired: 1,
    dryRunStateUnchanged: true, exactCopiesAndQuota: true, canvasTupleAndFrozenInputsPreserved: true,
    compatibilityGcDrainedBeforeAdoption: true, publicReaderFailureRetainedSource: true, disabledPolicyRefusedRetirement: true,
    realOptimizer: true, recreatedContainersPreserveBytes: true, actualLocalFiles: files.files.length,
    volumeId: project.volumeId, usedBytes: quotaBeforeRestart.used, productionStorageAccessed: false }));
}
