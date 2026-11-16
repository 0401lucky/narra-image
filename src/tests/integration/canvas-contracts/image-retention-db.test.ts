// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertDisposableTestDatabaseUrl } from "../../../../scripts/lib/disposable-test-environment.mjs";
import { canonicalCanvasJson } from "@/lib/canvas/contracts";
import { imageLocalLocation, type ImageErrorCode } from "@/lib/storage/image-contract";
import { ImageRepository, type ImageQueryer } from "@/lib/storage/image-repository";
import type { ImageDeleteClaim } from "@/lib/storage/image-maintenance-contract";
import { canvasRunSchema, canvasSceneSchema } from "@/lib/validators";
import { createRetentionFixture } from "./fixtures/retention-fixture.mjs";

function databaseUrl() {
  if (process.env.CANVAS_CONTRACTS_REQUIRE_DB !== "1" || !process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL) throw new Error("Image retention tests require the disposable runner");
  const url = assertDisposableTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  if (!/^\/narra_canvas_(full|additive)_[a-f0-9]{16}$/.test(url.pathname) || url.username !== "narra_canvas" || !/^[0-9a-f-]{36}$/.test(process.env.CANVAS_CONTRACTS_OWNER_TOKEN ?? "")) throw new Error("Not a runner-owned image retention database");
  url.search = "";
  return url.toString();
}
const url = databaseUrl();
const connections = new Set<Client>();
let observer: Client;
async function connection() {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000, statement_timeout: 8000, query_timeout: 10000 });
  await client.connect(); connections.add(client);
  expect((await client.query('SELECT token::text FROM "_canvas_contracts_owner"')).rows).toEqual([{ token: process.env.CANVAS_CONTRACTS_OWNER_TOKEN }]);
  return client;
}
function repository(client: Client) {
  // Exercise the real repository decoder and the actual SQL via pg; the adapter
  // only converts Prisma's parameterized Sql to the same driver's query shape.
  const adapter = { $queryRaw: async (sql: Prisma.Sql) => (await client.query(sql.text, [...sql.values])).rows } as unknown as ImageQueryer;
  return new ImageRepository(adapter);
}
async function rollback(body: (client: Client, repo: ImageRepository) => Promise<void>) {
  const client = await connection(); await client.query("BEGIN");
  try { await body(client, repository(client)); await client.query("SET CONSTRAINTS ALL IMMEDIATE"); }
  finally { await client.query("ROLLBACK"); await client.end(); connections.delete(client); }
}
async function expectedFailure(client: Client, code: ImageErrorCode, action: () => Promise<unknown>) {
  await client.query("SAVEPOINT expected_retention_failure");
  try { await expect(action()).rejects.toMatchObject({ code }); }
  finally { await client.query("ROLLBACK TO SAVEPOINT expected_retention_failure"); await client.query("RELEASE SAVEPOINT expected_retention_failure"); }
}
async function owner(client: Client) {
  const id = randomUUID();
  await client.query('INSERT INTO "User" (id,email,credits,"updatedAt") VALUES ($1,$2,100,clock_timestamp())', [id, `${id}@retention.invalid`]);
  return id;
}
async function seed(client: Client, repo: ImageRepository, options: { ownerId?: string; legacy?: {jobId: string; imageId: string}; deferBinding?: boolean } = {}) {
  const ownerId = options.ownerId ?? await owner(client);
  const location = await repo.registerLocation(imageLocalLocation(randomUUID()));
  const fixture = createRetentionFixture({ ownerId, locationId: location.id, key: `fixture/${randomUUID()}.png`, byteLength: 10, mimeType: "image/png", sha256: "a".repeat(64), publicUrlOrigin: "https://retention.invalid", leaseMilliseconds: 1000, transaction: false, legacy: options.legacy ?? null, deferBinding: options.deferBinding });
  await client.query(fixture.sql);
  return { ...fixture, ownerId, location };
}
async function shortCanvasWrite(client: Client, ownerId: string, kind: "INPUT" | "COPY") {
  const reservation = { id: randomUUID(), token: randomUUID(), intentKey: `canvas-fixture:${randomUUID()}` };
  // Like the shared retention fixture, create the original lease with a short
  // duration before any object exists. No immutable object timestamp is edited.
  await client.query("SELECT image_lock_quota()");
  await client.query(`INSERT INTO "ImageWriteReservation" (id,token,"ownerId","intentKey",kind,"slotBytes","remainingBytes","leaseExpiresAt")
    VALUES ($1::uuid,$2::uuid,$3,$4,$5,ARRAY[10]::bigint[],10,clock_timestamp()+interval '1 second')`, [reservation.id, reservation.token, ownerId, reservation.intentKey, kind]);
  return reservation;
}
async function managedCanvasImport(client: Client, repo: ImageRepository, existingOwner?: string) {
  const ownerId = existingOwner ?? await owner(client);
  const importId = randomUUID(); const location = await repo.registerLocation(imageLocalLocation(randomUUID()));
  const reservation = await shortCanvasWrite(client, ownerId, "INPUT");
  const ticket = await repo.beginObject({ reservationId: reservation.id, token: reservation.token, slot: 0, locationId: location.id,
    key: `canvas-imports/${importId}.png`, byteLength: 10, mimeType: "image/png", sha256: "c".repeat(64), purpose: "CANVAS_IMPORT", originId: importId });
  await client.query(`INSERT INTO "CanvasImportAsset" (id,"ownerId","userId","uploadId",sha256,"byteLength","mimeType","sourceProvider","mediaAssetId",
      "storageLocation","storageEndpoint","storageRegion","storageBucket","storageKey","uploadToken","uploadExpiresAt")
    VALUES ($1,$2::text,$2::text,$3,$4,10,'image/png','LOCAL',$5::uuid,$6,NULL,NULL,NULL,$7,$8::uuid,clock_timestamp())`,
  [importId, ownerId, randomUUID(), ticket.asset.sha256, ticket.asset.id, location.id, ticket.object.key, ticket.object.writeToken]);
  expect(await repo.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "CONFIRMED" })).toMatchObject({ accepted: true, asset: { state: "AVAILABLE" } });
  await client.query('UPDATE "CanvasImportAsset" SET state=\'READY\',"putOutcome"=\'CONFIRMED\' WHERE id=$1', [importId]);
  await repo.closeReservation({ reservationId: reservation.id, token: reservation.token });
  return { importId, ownerId, location, assetId: ticket.asset.id, objectId: ticket.object.id };
}
type CanvasRetentionFixture = Awaited<ReturnType<typeof managedCanvasImport>>;
async function copyCanvasImport(client: Client, repo: ImageRepository, image: CanvasRetentionFixture) {
  const location = await repo.registerLocation(imageLocalLocation(randomUUID()));
  const original = await shortCanvasWrite(client, image.ownerId, "COPY");
  const reservation = await repo.prepareCopy({ assetId: image.assetId, ownerId: image.ownerId, intentKey: original.intentKey, byteLength: "10" });
  expect(reservation.id).toBe(original.id);
  const ticket = await repo.beginObject({ reservationId: reservation.id, token: reservation.token, slot: 0, assetId: image.assetId, locationId: location.id,
    key: `canvas-copies/${randomUUID()}.png`, byteLength: 10, mimeType: "image/png", sha256: "c".repeat(64), purpose: "CANVAS_IMPORT", originId: image.importId });
  expect(await repo.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "CONFIRMED" })).toMatchObject({ accepted: true });
  await repo.closeReservation({ reservationId: reservation.id, token: reservation.token });
  return { location, objectId: ticket.object.id };
}
async function canvasGraceFixture(client: Client, image: CanvasRetentionFixture, elapsed: boolean) {
  // Historical preparation only, matching the audited C1 fixture boundary. The
  // live owner sentinel and exact IDs are checked before changing these three
  // timestamps. No identity, state, accounting, roots, DDL or guard is changed.
  // Every eligibility/claim/finalizer below runs after origin is restored.
  expect((await client.query('SELECT token::text FROM "_canvas_contracts_owner"')).rows).toEqual([{ token: process.env.CANVAS_CONTRACTS_OWNER_TOKEN }]);
  expect((await client.query("SELECT current_setting('session_replication_role') AS role")).rows).toEqual([{ role: "origin" }]);
  const unchanged = () => client.query(`SELECT to_jsonb(c)-ARRAY['uploadExpiresAt','detachedAt'] AS canvas,
      to_jsonb(a)-'detachedAt' AS image FROM "CanvasImportAsset" c JOIN "ImageAsset" a ON a.id=c."mediaAssetId"
      WHERE c.id=$1 AND c."ownerId"=$2 AND a.id=$3::uuid AND a."ownerId"=$2 AND a.purpose='CANVAS_IMPORT'`, [image.importId, image.ownerId, image.assetId]);
  const before = (await unchanged()).rows; expect(before).toHaveLength(1);
  await client.query("SAVEPOINT canvas_retention_clock");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    const seconds = elapsed ? 604860 : 604740;
    expect((await client.query(`UPDATE "CanvasImportAsset" SET "uploadExpiresAt"=clock_timestamp()-interval '10 days',
      "detachedAt"=clock_timestamp()-make_interval(secs=>$4::integer) WHERE id=$1 AND "ownerId"=$2 AND "mediaAssetId"=$3::uuid`, [image.importId, image.ownerId, image.assetId, seconds])).rowCount).toBe(1);
    expect((await client.query('UPDATE "ImageAsset" SET "detachedAt"=clock_timestamp()-make_interval(secs=>$3::integer) WHERE id=$1::uuid AND "ownerId"=$2', [image.assetId, image.ownerId, seconds])).rowCount).toBe(1);
    await client.query("SET LOCAL session_replication_role = origin");
    await client.query("RELEASE SAVEPOINT canvas_retention_clock");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT canvas_retention_clock");
    await client.query("RELEASE SAVEPOINT canvas_retention_clock");
    throw error;
  }
  expect((await client.query("SELECT current_setting('session_replication_role') AS role")).rows).toEqual([{ role: "origin" }]);
  expect((await unchanged()).rows).toEqual(before);
}
async function canvasAccount(client: Client, ownerId: string) {
  return (await client.query(`SELECT count(*)::int AS count,COALESCE(sum("byteLength"),0)::text AS bytes
    FROM "CanvasImportAsset" WHERE "ownerId"=$1 AND "physicalBytesAccounted"`, [ownerId])).rows[0];
}
async function expireOriginalWrites(client: Client, ids: string[]) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if ((await client.query<{ expired: boolean }>('SELECT bool_and("writeExpiresAt" <= clock_timestamp()) AS expired FROM "ImageObject" WHERE id=ANY($1::uuid[])', [ids])).rows[0].expired) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Fixture original writer lease did not expire");
}
async function enable(repo: ImageRepository, extra: Partial<{ limitBytes: string; scheduleEnabled: boolean }> = {}) {
  const { policy } = await repo.getUsage();
  return repo.updateStoragePolicy({ expectedVersion: policy.version, limitBytes: policy.limitBytes, enabled: true, quotaCleanupEnabled: true, scheduleEnabled: false, retentionDays: 30, intervalSeconds: 86400, ...extra });
}
async function confirmed(repo: ImageRepository, actorId: string) {
  const { policy } = await repo.getUsage();
  const preview = await repo.previewCleanup({ actorId, previewRequestId: randomUUID(), expectedPolicyVersion: policy.version, mode: "MANUAL_ALL" });
  const input = { actorId, previewId: preview.previewId, requestId: randomUUID(), expectedPolicyVersion: policy.version };
  return { preview, input, job: await repo.confirmCleanup(input) };
}
async function executor(repo: ImageRepository) {
  const input = { workerId: `retention:${randomUUID()}`, token: randomUUID() };
  expect(await repo.acquireMaintenanceLease(input)).toBe(true);
  return input;
}
function receipt(claim: ImageDeleteClaim, outcome: "DELETED" | "MISSING" | "FAILED" | "UNKNOWN") {
  return { jobId: claim.jobId, itemId: claim.itemId, objectId: claim.object.id, deleteToken: claim.deleteToken, outcome };
}
const digest = (value: unknown) => createHash("sha256").update(canonicalCanvasJson(value)).digest("hex");
async function waitForBlock(waiter: number, blocker: number) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if ((await observer.query('SELECT $2::integer = ANY(pg_blocking_pids($1::integer)) AS blocked', [waiter, blocker])).rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Expected an observed PostgreSQL lock wait");
}

describe("image retention on disposable PostgreSQL", () => {
  beforeAll(async () => { observer = await connection(); });
  afterAll(async () => { await Promise.allSettled([...connections].map((client) => client.end())); });

  it("binds confirmation to its snapshot and releases exact physical bytes once", async () => {
    await rollback(async (client, repo) => {
      const initial = await repo.getUsage(); const original = await seed(client, repo); await expireOriginalWrites(client, [original.objectId]);
      await enable(repo);
      const run = await confirmed(repo, original.ownerId);
      const later = await seed(client, repo);
      expect((await repo.confirmCleanup(run.input)).id).toBe(run.job.id);
      const lease = await executor(repo);
      const claims = await repo.claimMaintenance({ executorToken: lease.token, verifiedLocationIds: [original.location.id, later.location.id] });
      expect(claims.map(({ object }) => object.id)).toEqual([original.objectId]);
      expect(await repo.finishMaintenanceObject(receipt(claims[0], "DELETED"))).toMatchObject({ accepted: true, replayed: false, releasedBytes: "10" });
      expect(await repo.finishMaintenanceObject(receipt(claims[0], "MISSING"))).toMatchObject({ accepted: true, replayed: true, releasedBytes: "0" });
      expect(BigInt((await repo.getUsage()).usedBytes) - BigInt(initial.usedBytes)).toBe(BigInt(10));
      expect(await repo.getByAssetId(original.assetId)).toMatchObject({ asset: { state: "DELETED" }, object: null });
      expect((await repo.getByAssetId(later.assetId))?.asset.state).toBe("AVAILABLE");
      expect((await client.query('SELECT j.status,j.prompt,u.credits FROM "GenerationJob" j JOIN "User" u ON u.id=j."userId" WHERE j.id=$1', [original.jobId])).rows).toEqual([{ status: "SUCCEEDED", prompt: "历史图片清理验证", credits: 100 }]);
    });
  });

  it("rechecks protection after preview and keeps unknown deletes accounted across takeover", async () => {
    await rollback(async (client, repo) => {
      const first = await seed(client, repo); const second = await seed(client, repo);
      await expireOriginalWrites(client, [first.objectId, second.objectId]); await enable(repo);
      const run = await confirmed(repo, first.ownerId);
      await repo.replaceReferences({ ownerId: first.ownerId, kind: "CANVAS_SAVED", referenceKey: `canvas:${randomUUID()}`, assetIds: [first.assetId] });
      const lease = await executor(repo); let claims: ImageDeleteClaim[] = [];
      for (let attempt = 0; attempt < 3 && !claims.length; attempt += 1) claims = await repo.claimMaintenance({ executorToken: lease.token, verifiedLocationIds: [first.location.id, second.location.id] });
      expect(claims.map(({ object }) => object.id)).toEqual([second.objectId]);
      const before = await repo.getUsage();
      expect(await repo.finishMaintenanceObject(receipt(claims[0], "UNKNOWN"))).toMatchObject({ accepted: true, releasedBytes: "0", job: { state: "WAITING", failedItems: 1 } });
      expect((await repo.getUsage()).usedBytes).toBe(before.usedBytes);
      await expectedFailure(client, "IMAGE_UNAVAILABLE", () => repo.replaceReferences({ ownerId: second.ownerId, kind: "JOB_INPUT", referenceKey: `job:${randomUUID()}`, assetIds: [second.assetId] }));
      await client.query('UPDATE "ImageObject" SET "nextDeleteAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1::uuid', [second.objectId]);
      await client.query('UPDATE "ImageMaintenanceJob" SET "nextAttemptAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1::uuid', [run.job.id]);
      await repo.releaseMaintenanceLease(lease); const replacement = await executor(repo);
      const resumed = await repo.claimMaintenance({ executorToken: replacement.token, verifiedLocationIds: [second.location.id] });
      expect(resumed).toHaveLength(1); expect(resumed[0].deleteToken).not.toBe(claims[0].deleteToken);
      expect(await repo.finishMaintenanceObject(receipt(claims[0], "DELETED"))).toMatchObject({ accepted: false, releasedBytes: "0" });
      expect(await repo.finishMaintenanceObject(receipt(resumed[0], "MISSING"))).toMatchObject({ accepted: true, releasedBytes: "10" });
      const result = await repo.getMaintenanceJob({ jobId: run.job.id });
      expect(result).toMatchObject({ state: "PARTIAL", completedItems: 1, skippedItems: 1 });
      expect(result?.items.find(({ assetId }) => assetId === first.assetId)).toMatchObject({ state: "SKIPPED", reason: "REFERENCED" });
    });
  });

  it("does not claim unverified storage or silently reuse an outdated policy preview", async () => {
    await rollback(async (client, repo) => {
      const image = await seed(client, repo); await expireOriginalWrites(client, [image.objectId]); await enable(repo);
      const run = await confirmed(repo, image.ownerId); const lease = await executor(repo);
      expect(await repo.claimMaintenance({ executorToken: lease.token, verifiedLocationIds: [] })).toEqual([]);
      expect((await repo.getMaintenanceJob({ jobId: run.job.id }))?.items).toMatchObject([{ state: "SKIPPED", reason: "STORAGE_UNAVAILABLE", releasedBytes: "0" }]);
      const policy = (await repo.getUsage()).policy;
      const preview = await repo.previewCleanup({ actorId: image.ownerId, previewRequestId: randomUUID(), expectedPolicyVersion: policy.version, mode: "MANUAL_ALL" });
      await enable(repo);
      await expectedFailure(client, "IMAGE_POLICY_CONFLICT", () => repo.confirmCleanup({ actorId: image.ownerId, previewId: preview.previewId, requestId: randomUUID(), expectedPolicyVersion: policy.version }));
    });
  });

  it("reclaims the oldest whole asset only until the original quota need is met", async () => {
    await rollback(async (client, repo) => {
      const initial = await repo.getUsage(); const first = await seed(client, repo); const second = await seed(client, repo); const protectedImage = await seed(client, repo);
      await expireOriginalWrites(client, [first.objectId, second.objectId, protectedImage.objectId]);
      await repo.replaceReferences({ ownerId: protectedImage.ownerId, kind: "JOB_INPUT", referenceKey: `job:${randomUUID()}`, assetIds: [protectedImage.assetId] });
      await enable(repo, { limitBytes: (BigInt(initial.usedBytes) + BigInt(initial.reservedBytes) + BigInt(30)).toString() });
      const request = { ownerId: first.ownerId, intentKey: randomUUID(), requestId: randomUUID(), neededBytes: "8" };
      const job = await repo.requestQuotaCleanup(request); expect(job).not.toBeNull();
      expect((await repo.requestQuotaCleanup({ ...request, requestId: randomUUID() }))?.id).toBe(job?.id);
      const lease = await executor(repo); const locations = [first.location.id, second.location.id, protectedImage.location.id];
      const claims = await repo.claimMaintenance({ executorToken: lease.token, verifiedLocationIds: locations });
      expect(claims.map(({ object }) => object.id)).toEqual([first.objectId]);
      await repo.finishMaintenanceObject(receipt(claims[0], "DELETED"));
      expect(await repo.claimMaintenance({ executorToken: lease.token, verifiedLocationIds: locations })).toEqual([]);
      expect((await repo.getByAssetId(second.assetId))?.asset.state).toBe("AVAILABLE");
      expect((await repo.getByAssetId(protectedImage.assetId))?.asset.state).toBe("AVAILABLE");
      expect((await repo.getMaintenanceJob({ jobId: job!.id }))?.releasedBytes).toBe("10");
      expect((await repo.reserveInput({ ownerId: first.ownerId, intentKey: randomUUID(), byteLength: 8 })).remainingBytes).toBe("8");
    });
  });

  it("protects active reads and requires an asset-bound COPY reservation", async () => {
    await rollback(async (client, repo) => {
      const image = await seed(client, repo); await expireOriginalWrites(client, [image.objectId]); await enable(repo);
      const read = await repo.beginRead({ url: image.url });
      expect(read?.image.asset.id).toBe(image.assetId);
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [image.assetId])).rows[0].reason).toBe("READING");
      expect((await confirmed(repo, image.ownerId)).preview.assetCount).toBe(0);
      const unbound = await repo.reserveInput({ ownerId: image.ownerId, intentKey: randomUUID(), byteLength: 10, kind: "COPY" });
      await expectedFailure(client, "IMAGE_WRITE_CONFLICT", () => repo.beginObject({ reservationId: unbound.id, token: unbound.token, slot: 0, assetId: image.assetId, locationId: image.location.id, key: `copy/${randomUUID()}.png`, byteLength: 10, mimeType: "image/png", sha256: "a".repeat(64), purpose: "GENERATED" }));
    });
  });

  it("protects managed Canvas imports inside seven days and preserves their saved and permanent input roots", async () => {
    await rollback(async (client, repo) => {
      const initial = await repo.getUsage();
      const recent = await managedCanvasImport(client, repo);
      const rooted = await managedCanvasImport(client, repo, recent.ownerId);
      await expireOriginalWrites(client, [recent.objectId, rooted.objectId]);
      await canvasGraceFixture(client, recent, false); await canvasGraceFixture(client, rooted, true);
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [recent.assetId])).rows[0].reason).toBe("CANVAS_GRACE");
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [rooted.assetId])).rows[0].reason).toBeNull();

      const canvasId = randomUUID(); const sourceNodeId = randomUUID();
      await client.query('INSERT INTO "Canvas" (id,"ownerId","userId",title) VALUES ($1,$2::text,$2::text,\'Managed original roots\')', [canvasId, rooted.ownerId]);
      const scene = canvasSceneSchema.parse({ schemaVersion: 1, nodes: [{ id: sourceNodeId, kind: "reference", position: { x: 0, y: 0 }, source: { kind: "imported", assetId: rooted.importId } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, runBindings: [] });
      await client.query("SELECT canvas_save_snapshot($1,$2,0,$3,$4::jsonb,$5)", [rooted.ownerId, canvasId, randomUUID(), JSON.stringify(scene), digest(scene)]);
      expect((await client.query('SELECT "assetId" FROM "CanvasSavedAssetUse" WHERE "canvasId"=$1', [canvasId])).rows).toEqual([{ assetId: rooted.importId }]);
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [rooted.assetId])).rows[0].reason).toBe("REFERENCED");
      const wire = canvasRunSchema.parse({ canvasId, nodeId: randomUUID(), runId: randomUUID(), input: { prompt: { sourceNodeId: randomUUID(), text: "retained original" }, references: [{ sourceNodeId, ordinal: 1, kind: "imported", assetId: rooted.importId }] }, parameters: { providerMode: "built_in", model: "gpt-image-2", size: "auto", quality: "auto", outputFormat: "png", generationType: "image_to_image", count: 1 } });
      const reserved = (await client.query("SELECT * FROM canvas_reserve_run($1,$2,$3,$4,$5,$6::jsonb)", [rooted.ownerId, canvasId, wire.nodeId, wire.runId, digest(wire), JSON.stringify(wire)])).rows[0];
      const consumer = randomUUID();
      await client.query('INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"updatedAt") VALUES ($1,$2,\'BUILT_IN\',\'gpt-image-2\',\'retained original\',\'auto\',1,clock_timestamp())', [consumer, rooted.ownerId]);
      await client.query("SELECT canvas_commit_run($1,$2,$3,$4)", [rooted.ownerId, wire.runId, reserved.preparationToken, consumer]);
      await client.query('UPDATE "GenerationJob" SET status=\'SUCCEEDED\',"completedAt"=clock_timestamp() WHERE id=$1', [consumer]);
      await client.query("SELECT canvas_delete_document($1,$2,1)", [rooted.ownerId, canvasId]);
      expect((await client.query('SELECT "assetId" FROM "CanvasSavedAssetUse" WHERE "canvasId"=$1', [canvasId])).rows).toEqual([]);
      expect((await client.query('SELECT "assetId" FROM "CanvasJobAssetUse" WHERE "assetId"=$1', [rooted.importId])).rows).toEqual([{ assetId: rooted.importId }]);
      expect((await client.query('SELECT kind,permanent FROM "ImageReference" WHERE "assetId"=$1::uuid', [rooted.assetId])).rows).toEqual([{ kind: "JOB_INPUT", permanent: true }]);
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [rooted.assetId])).rows[0].reason).toBe("REFERENCED");
      await enable(repo);
      expect((await confirmed(repo, rooted.ownerId)).preview.assetCount).toBe(0);
      const lease = await executor(repo);
      expect(await repo.claimMaintenance({ executorToken: lease.token, verifiedLocationIds: [recent.location.id, rooted.location.id] })).toEqual([]);
      expect(await canvasAccount(client, rooted.ownerId)).toEqual({ count: 2, bytes: "20" });
      expect((await repo.getUsage()).usedBytes).toBe((BigInt(initial.usedBytes) + BigInt(20)).toString());
      for (const image of [recent, rooted]) expect(await repo.getByAssetId(image.assetId)).toMatchObject({ asset: { state: "AVAILABLE" }, object: { accounted: true } });
    });
  }, 15000);

  it("releases a managed Canvas import's logical quota only after every physical replica is confirmed absent", async () => {
    await rollback(async (client, repo) => {
      const initial = await repo.getUsage(); const image = await managedCanvasImport(client, repo);
      const copy = await copyCanvasImport(client, repo, image);
      await expireOriginalWrites(client, [image.objectId, copy.objectId]); await canvasGraceFixture(client, image, true);
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [image.assetId])).rows[0].reason).toBeNull();
      expect(await canvasAccount(client, image.ownerId)).toEqual({ count: 1, bytes: "10" });
      expect((await repo.getUsage()).usedBytes).toBe((BigInt(initial.usedBytes) + BigInt(20)).toString());
      await enable(repo); const run = await confirmed(repo, image.ownerId);
      expect(run.preview).toMatchObject({ assetCount: 1, objectCount: 2, estimatedBytes: "20" });
      const lease = await executor(repo);
      const claims = await repo.claimMaintenance({ executorToken: lease.token, verifiedLocationIds: [image.location.id, copy.location.id] });
      expect(claims.map(({ object }) => object.id).sort()).toEqual([image.objectId, copy.objectId].sort());
      expect((await client.query('SELECT state,"physicalBytesAccounted" FROM "CanvasImportAsset" WHERE id=$1', [image.importId])).rows[0]).toEqual({ state: "DELETING", physicalBytesAccounted: true });
      expect(await repo.finishMaintenanceObject(receipt(claims[0], "DELETED"))).toMatchObject({ accepted: true, releasedBytes: "10", job: { completedItems: 1, pendingItems: 1 } });
      expect(await canvasAccount(client, image.ownerId)).toEqual({ count: 1, bytes: "10" });
      expect((await repo.getUsage()).usedBytes).toBe((BigInt(initial.usedBytes) + BigInt(10)).toString());
      expect((await client.query('SELECT state,"physicalBytesAccounted" FROM "CanvasImportAsset" WHERE id=$1', [image.importId])).rows[0]).toEqual({ state: "DELETING", physicalBytesAccounted: true });
      expect(await repo.finishMaintenanceObject(receipt(claims[0], "DELETED"))).toMatchObject({ accepted: true, replayed: true, releasedBytes: "0" });
      expect(await canvasAccount(client, image.ownerId)).toEqual({ count: 1, bytes: "10" });
      expect(await repo.finishMaintenanceObject(receipt(claims[1], "MISSING"))).toMatchObject({ accepted: true, releasedBytes: "10", job: { state: "SUCCEEDED", completedItems: 2, pendingItems: 0, releasedBytes: "20" } });
      expect((await client.query('SELECT state,"physicalBytesAccounted","needsReconciliation" FROM "CanvasImportAsset" WHERE id=$1', [image.importId])).rows[0]).toEqual({ state: "DELETED", physicalBytesAccounted: false, needsReconciliation: false });
      expect(await repo.getByAssetId(image.assetId)).toMatchObject({ asset: { state: "DELETED", activeObjectId: null } });
      expect(await canvasAccount(client, image.ownerId)).toEqual({ count: 0, bytes: "0" });
      expect((await repo.getUsage()).usedBytes).toBe(initial.usedBytes);
      expect(await repo.finishMaintenanceObject(receipt(claims[1], "MISSING"))).toMatchObject({ accepted: true, replayed: true, releasedBytes: "0" });
      expect(await canvasAccount(client, image.ownerId)).toEqual({ count: 0, bytes: "0" });
      expect((await repo.getUsage()).usedBytes).toBe(initial.usedBytes);
    });
  }, 15000);

  it("recovers unknown managed Canvas deletion with fresh physical and expired logical tokens without double accounting", async () => {
    await rollback(async (client, repo) => {
      const initial = await repo.getUsage(); const image = await managedCanvasImport(client, repo);
      await expireOriginalWrites(client, [image.objectId]); await canvasGraceFixture(client, image, true); await enable(repo);
      const run = await confirmed(repo, image.ownerId); const lease = await executor(repo);
      const [claim] = await repo.claimMaintenance({ executorToken: lease.token, verifiedLocationIds: [image.location.id] });
      expect(claim?.object.id).toBe(image.objectId);
      const originalCanvas = (await client.query('SELECT "deleteToken","deleteAttempts" FROM "CanvasImportAsset" WHERE id=$1', [image.importId])).rows[0];
      expect(originalCanvas.deleteAttempts).toBe(1);
      expect(await repo.finishMaintenanceObject(receipt(claim, "UNKNOWN"))).toMatchObject({ accepted: true, releasedBytes: "0", job: { state: "WAITING", failedItems: 1 } });
      expect((await repo.getUsage()).usedBytes).toBe((BigInt(initial.usedBytes) + BigInt(10)).toString());
      expect(await canvasAccount(client, image.ownerId)).toEqual({ count: 1, bytes: "10" });
      // These mutable retry/lease deadlines are updated with origin guards on.
      // The historical fixture above never changes tokens or deletion states.
      expect((await client.query("SELECT current_setting('session_replication_role') AS role")).rows).toEqual([{ role: "origin" }]);
      await client.query('UPDATE "CanvasImportAsset" SET "deleteExpiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1', [image.importId]);
      await client.query('UPDATE "ImageObject" SET "nextDeleteAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1::uuid', [image.objectId]);
      await client.query('UPDATE "ImageMaintenanceJob" SET "nextAttemptAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1::uuid', [run.job.id]);
      await repo.releaseMaintenanceLease(lease); const replacement = await executor(repo);
      const [retry] = await repo.claimMaintenance({ executorToken: replacement.token, verifiedLocationIds: [image.location.id] });
      expect(retry?.object.id).toBe(image.objectId); expect(retry.deleteToken).not.toBe(claim.deleteToken);
      expect((await client.query('SELECT "deleteToken","deleteAttempts","deleteExpiresAt"<=clock_timestamp() AS expired FROM "CanvasImportAsset" WHERE id=$1', [image.importId])).rows[0]).toEqual({ ...originalCanvas, expired: true });
      expect(await repo.finishMaintenanceObject(receipt(claim, "DELETED"))).toMatchObject({ accepted: false, releasedBytes: "0" });
      expect(await canvasAccount(client, image.ownerId)).toEqual({ count: 1, bytes: "10" });
      expect((await repo.getUsage()).usedBytes).toBe((BigInt(initial.usedBytes) + BigInt(10)).toString());
      expect(await repo.finishMaintenanceObject(receipt(retry, "MISSING"))).toMatchObject({ accepted: true, releasedBytes: "10", job: { state: "SUCCEEDED", completedItems: 1, releasedBytes: "10" } });
      const completedCanvas = (await client.query('SELECT state,"physicalBytesAccounted","deleteToken","deleteAttempts" FROM "CanvasImportAsset" WHERE id=$1', [image.importId])).rows[0];
      expect(completedCanvas).toMatchObject({ state: "DELETED", physicalBytesAccounted: false, deleteAttempts: 2 });
      expect(completedCanvas.deleteToken).not.toBe(originalCanvas.deleteToken);
      expect(await canvasAccount(client, image.ownerId)).toEqual({ count: 0, bytes: "0" });
      expect((await repo.getUsage()).usedBytes).toBe(initial.usedBytes);
      expect(await repo.finishMaintenanceObject(receipt(retry, "MISSING"))).toMatchObject({ accepted: true, replayed: true, releasedBytes: "0" });
      expect(await repo.finishMaintenanceObject(receipt(claim, "DELETED"))).toMatchObject({ accepted: false, releasedBytes: "0" });
      expect(await canvasAccount(client, image.ownerId)).toEqual({ count: 0, bytes: "0" });
      expect((await repo.getUsage()).usedBytes).toBe(initial.usedBytes);
      expect((await client.query('SELECT "deleteAttempts" FROM "CanvasImportAsset" WHERE id=$1', [image.importId])).rows[0].deleteAttempts).toBe(2);
    });
  }, 15000);

  it("restores saved and permanent run roots when a legacy result is bound later", async () => {
    await rollback(async (client, repo) => {
      const ownerId = await owner(client); const jobId = randomUUID(); const imageId = randomUUID(); const canvasId = randomUUID();
      await client.query('INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,status,"updatedAt") VALUES ($1,$2,\'BUILT_IN\',\'gpt-image-2\',\'legacy\',\'auto\',1,\'SUCCEEDED\',clock_timestamp())', [jobId, ownerId]);
      await client.query('INSERT INTO "GenerationImage" (id,"jobId",url) VALUES ($1,$2,$3)', [imageId, jobId, `https://legacy.invalid/${imageId}.png`]);
      await client.query('INSERT INTO "Canvas" (id,"ownerId","userId",title) VALUES ($1,$2::text,$2::text,\'History\')', [canvasId, ownerId]);
      const scene = canvasSceneSchema.parse({ schemaVersion: 1, nodes: [{ id: `result:${imageId}`, kind: "result", position: { x: 0, y: 0 }, jobId, imageId }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, runBindings: [] });
      await client.query("SELECT canvas_save_snapshot($1,$2,0,$3,$4::jsonb,$5)", [ownerId, canvasId, randomUUID(), JSON.stringify(scene), digest(scene)]);
      const wire = canvasRunSchema.parse({ canvasId, nodeId: randomUUID(), runId: randomUUID(), input: { prompt: { sourceNodeId: randomUUID(), text: "permanent input" }, references: [{ sourceNodeId: `result:${imageId}`, ordinal: 1, kind: "result", jobId, imageId }] }, parameters: { providerMode: "built_in", model: "gpt-image-2", size: "auto", quality: "auto", outputFormat: "png", generationType: "image_to_image", count: 1 } });
      const reserved = (await client.query("SELECT * FROM canvas_reserve_run($1,$2,$3,$4,$5,$6::jsonb)", [ownerId, canvasId, wire.nodeId, wire.runId, digest(wire), JSON.stringify(wire)])).rows[0];
      const consumer = randomUUID();
      await client.query('INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"updatedAt") VALUES ($1,$2,\'BUILT_IN\',\'gpt-image-2\',\'permanent input\',\'auto\',1,clock_timestamp())', [consumer, ownerId]);
      await client.query("SELECT canvas_commit_run($1,$2,$3,$4)", [ownerId, wire.runId, reserved.preparationToken, consumer]);
      const image = await seed(client, repo, { ownerId, legacy: { jobId, imageId } });
      await expireOriginalWrites(client, [image.objectId]); await enable(repo);
      expect((await client.query('SELECT kind,permanent FROM "ImageReference" WHERE "assetId"=$1::uuid ORDER BY kind', [image.assetId])).rows).toEqual([{ kind: "CANVAS_SAVED", permanent: false }, { kind: "JOB_INPUT", permanent: true }]);
      expect((await confirmed(repo, ownerId)).preview.assetCount).toBe(0);
      await client.query('DELETE FROM "User" WHERE id=$1', [ownerId]);
      expect((await client.query('SELECT count(*)::int AS roots FROM "ImageReference" WHERE "assetId"=$1::uuid AND permanent', [image.assetId])).rows[0].roots).toBe(1);
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [image.assetId])).rows[0].reason).toBe("REFERENCED");
    });
  });

  it("retires only a verified redundant source and keeps the protected logical image", async () => {
    await rollback(async (client, repo) => {
      const image = await seed(client, repo); await expireOriginalWrites(client, [image.objectId]); await enable(repo);
      await repo.replaceReferences({ ownerId: image.ownerId, kind: "JOB_INPUT", referenceKey: `job:${randomUUID()}`, assetIds: [image.assetId] });
      const targetLocation = await repo.registerLocation(imageLocalLocation(randomUUID()));
      const copy = await repo.prepareCopy({ assetId: image.assetId, ownerId: image.ownerId, intentKey: randomUUID(), byteLength: "10" });
      const ticket = await repo.beginObject({ reservationId: copy.id, token: copy.token, slot: 0, assetId: image.assetId, locationId: targetLocation.id, key: `copy/${randomUUID()}.png`, byteLength: 10, mimeType: "image/png", sha256: "a".repeat(64), purpose: "GENERATED" });
      await repo.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "CONFIRMED" });
      await repo.closeReservation({ reservationId: copy.id, token: copy.token });
      await repo.activateObject({ assetId: image.assetId, objectId: ticket.object.id, expectedObjectId: image.objectId });
      const thirdCopy = await repo.prepareCopy({ assetId: image.assetId, ownerId: image.ownerId, intentKey: randomUUID(), byteLength: "10" });
      const third = await repo.beginObject({ reservationId: thirdCopy.id, token: thirdCopy.token, slot: 0, assetId: image.assetId, locationId: targetLocation.id, key: `spare/${randomUUID()}.png`, byteLength: 10, mimeType: "image/png", sha256: "a".repeat(64), purpose: "GENERATED" });
      await repo.finishObject({ objectId: third.object.id, writeToken: third.object.writeToken, outcome: "CONFIRMED" });
      await repo.closeReservation({ reservationId: thirdCopy.id, token: thirdCopy.token });
      await expectedFailure(client, "IMAGE_MAINTENANCE_CONFLICT", () => repo.requestSourceRetirement({ requestId: randomUUID(), assetId: image.assetId, sourceObjectId: image.objectId, targetObjectId: ticket.object.id, verificationId: randomUUID() }));
      const proof = await repo.recordReplicaVerification({ assetId: image.assetId, sourceObjectId: image.objectId, targetObjectId: ticket.object.id, byteLength: "10", sha256: "a".repeat(64), aliasUrls: [image.url], readerProtocolRevision: 3 });
      await repo.requestSourceRetirement({ requestId: randomUUID(), assetId: image.assetId, sourceObjectId: image.objectId, targetObjectId: ticket.object.id, verificationId: proof.id });
      const lease = await executor(repo); const claims = await repo.claimMaintenance({ executorToken: lease.token, verifiedLocationIds: [image.location.id, targetLocation.id] });
      expect(claims.map(({ object }) => object.id)).toEqual([image.objectId]);
      await expectedFailure(client, "IMAGE_UNAVAILABLE", () => repo.activateObject({ assetId: image.assetId, objectId: image.objectId, expectedObjectId: ticket.object.id }));
      await expectedFailure(client, "IMAGE_WRITE_CONFLICT", () => repo.activateObject({ assetId: image.assetId, objectId: third.object.id, expectedObjectId: ticket.object.id }));
      await repo.finishMaintenanceObject(receipt(claims[0], "DELETED"));
      expect(await repo.getByAssetId(image.assetId)).toMatchObject({ asset: { state: "AVAILABLE" }, object: { id: ticket.object.id, accounted: true } });
      expect((await client.query('SELECT count(*)::int AS roots FROM "ImageReference" WHERE "assetId"=$1::uuid AND permanent', [image.assetId])).rows[0].roots).toBe(1);
    });
  });

  it("makes a physical cleanup claim wait for a concurrently committed new input root", async () => {
    const repo = repository(observer); const originalPolicy = (await repo.getUsage()).policy;
    const a = await connection(); const b = await connection();
    let pending: Promise<ImageDeleteClaim[]> | undefined;
    let lease: Awaited<ReturnType<typeof executor>> | undefined;
    try {
      await observer.query("BEGIN"); const image = await seed(observer, repo); await expireOriginalWrites(observer, [image.objectId]);
      await enable(repo); const run = await confirmed(repo, image.ownerId); lease = await executor(repo); await observer.query("COMMIT");
      await a.query("BEGIN"); await b.query("BEGIN");
      const blocker = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const waiter = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await repository(a).replaceReferences({ ownerId: image.ownerId, kind: "JOB_INPUT", referenceKey: `job:${randomUUID()}`, assetIds: [image.assetId] });
      pending = repository(b).claimMaintenance({ executorToken: lease.token, verifiedLocationIds: [image.location.id] });
      void pending.catch(() => undefined);
      await waitForBlock(waiter, blocker); await a.query("COMMIT");
      expect(await pending).toEqual([]); await b.query("COMMIT");
      expect((await repo.getMaintenanceJob({ jobId: run.job.id }))?.items).toMatchObject([{ state: "SKIPPED", reason: "REFERENCED" }]);
      expect((await repo.getByAssetId(image.assetId))?.object?.accounted).toBe(true);
    } finally {
      await a.query("ROLLBACK"); await pending?.catch(() => undefined); await b.query("ROLLBACK"); await observer.query("ROLLBACK");
      if (lease) await repo.releaseMaintenanceLease(lease);
      const current = (await repo.getUsage()).policy;
      await repo.updateStoragePolicy({ expectedVersion: current.version, limitBytes: originalPolicy.limitBytes, enabled: originalPolicy.enabled, quotaCleanupEnabled: originalPolicy.quotaCleanupEnabled, scheduleEnabled: originalPolicy.scheduleEnabled, retentionDays: originalPolicy.retentionDays, intervalSeconds: originalPolicy.intervalSeconds });
    }
  });

  it("serializes Save with a late legacy binding before deriving managed result roots", async () => {
    const repo = repository(observer); const a = await connection(); const b = await connection();
    let saving: Promise<unknown> | undefined;
    try {
      await observer.query("BEGIN"); const ownerId = await owner(observer); const jobId = randomUUID(); const imageId = randomUUID(); const canvasId = randomUUID();
      await observer.query('INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,status,"updatedAt") VALUES ($1,$2,\'BUILT_IN\',\'gpt-image-2\',\'legacy race\',\'auto\',1,\'SUCCEEDED\',clock_timestamp())', [jobId, ownerId]);
      await observer.query('INSERT INTO "GenerationImage" (id,"jobId",url) VALUES ($1,$2,$3)', [imageId, jobId, `https://legacy.invalid/${imageId}.png`]);
      await observer.query('INSERT INTO "Canvas" (id,"ownerId","userId",title) VALUES ($1,$2::text,$2::text,\'Late binding\')', [canvasId, ownerId]);
      const image = await seed(observer, repo, { ownerId, legacy: { jobId, imageId }, deferBinding: true }); await observer.query("COMMIT");
      const scene = canvasSceneSchema.parse({ schemaVersion: 1, nodes: [{ id: `result:${imageId}`, kind: "result", position: { x: 0, y: 0 }, jobId, imageId }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, runBindings: [] });
      await a.query("BEGIN"); await b.query("BEGIN");
      const blocker = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const waiter = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await a.query(image.bindingSql);
      saving = b.query("SELECT canvas_save_snapshot($1,$2,0,$3,$4::jsonb,$5)", [ownerId, canvasId, randomUUID(), JSON.stringify(scene), digest(scene)]);
      void saving.catch(() => undefined);
      await waitForBlock(waiter, blocker); await a.query("COMMIT"); await saving; await b.query("COMMIT");
      expect((await observer.query('SELECT kind FROM "ImageReference" WHERE "assetId"=$1::uuid', [image.assetId])).rows).toEqual([{ kind: "CANVAS_SAVED" }]);
      expect((await observer.query('SELECT image_cleanup_reason($1::uuid) AS reason', [image.assetId])).rows[0].reason).toBe("REFERENCED");
    } finally {
      await a.query("ROLLBACK"); await saving?.catch(() => undefined); await b.query("ROLLBACK"); await observer.query("ROLLBACK");
    }
  });

  it("persists one due schedule, fences another executor and cancels only unclaimed work", async () => {
    await rollback(async (client, repo) => {
      const image = await seed(client, repo); await expireOriginalWrites(client, [image.objectId]);
      await enable(repo, { scheduleEnabled: true });
      expect(await repo.enqueueDueCleanup()).toBeNull();
      expect(await repo.listMaintenanceLocations()).toEqual([]);
      await client.query('UPDATE "ImageStoragePolicy" SET "nextRunAt"=clock_timestamp()-interval \'1 second\' WHERE scope=\'images\'');
      const due = await repo.enqueueDueCleanup(); expect(due).toMatchObject({ mode: "SCHEDULE", state: "QUEUED", totalItems: 1 });
      expect(await repo.enqueueDueCleanup()).toBeNull();
      expect((await repo.listMaintenanceLocations()).map(({ id }) => id)).toEqual([image.location.id]);
      const first = await executor(repo);
      expect(await repo.acquireMaintenanceLease({ workerId: "another-worker", token: randomUUID() })).toBe(false);
      expect(await repo.releaseMaintenanceLease({ ...first, workerId: "another-worker" })).toBe(false);
      await repo.cancelMaintenance({ actorId: image.ownerId, jobId: due!.id, requestId: randomUUID() });
      expect(await repo.claimMaintenance({ executorToken: first.token, verifiedLocationIds: [image.location.id] })).toEqual([]);
      expect(await repo.getMaintenanceJob({ jobId: due!.id })).toMatchObject({ state: "CANCELLED", releasedBytes: "0", skippedItems: 1 });
      expect((await repo.getByAssetId(image.assetId))?.object?.accounted).toBe(true);
    });
  });

  it("never admits an unknown PUT or an expired preview into physical deletion", async () => {
    await rollback(async (client, repo) => {
      const ownerId = await owner(client); const location = await repo.registerLocation(imageLocalLocation(randomUUID()));
      const reservation = await repo.reserveInput({ ownerId, intentKey: randomUUID(), byteLength: 10 });
      const ticket = await repo.beginObject({ reservationId: reservation.id, token: reservation.token, slot: 0, locationId: location.id, key: `unknown/${randomUUID()}.png`, byteLength: 10, mimeType: "image/png", sha256: "b".repeat(64), purpose: "REFERENCE" });
      await repo.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "UNKNOWN" });
      await repo.closeReservation({ reservationId: reservation.id, token: reservation.token });
      await enable(repo);
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [ticket.asset.id])).rows[0].reason).toBe("UNKNOWN_PUT");
      expect((await confirmed(repo, ownerId)).preview.assetCount).toBe(0);
      const policy = (await repo.getUsage()).policy; const id = randomUUID();
      await client.query('INSERT INTO "ImageMaintenanceJob" (id,"requesterId","requestKey",intent,mode,"policyVersion","previewExpiresAt") VALUES ($1,$2,$3,\'{}\',\'MANUAL_ALL\',$4,clock_timestamp()-interval \'1 second\')', [id, ownerId, `expired:${id}`, policy.version]);
      await expectedFailure(client, "IMAGE_PREVIEW_EXPIRED", () => repo.confirmCleanup({ actorId: ownerId, previewId: id, requestId: randomUUID(), expectedPolicyVersion: policy.version }));
      expect((await repo.getByAssetId(ticket.asset.id))?.asset.state).toBe("QUARANTINED");
    });
  });
});
