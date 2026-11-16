// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { assertDisposableTestDatabaseUrl } from "../../../../scripts/lib/disposable-test-environment.mjs";
import { canonicalCanvasJson } from "@/lib/canvas/contracts";
import { imageDatabaseError, imageLocalLocation, imageS3Location, type ImageErrorCode } from "@/lib/storage/image-contract";
import type { ImageHistoryItem, ImageHistorySourceBinding } from "@/lib/storage/image-history-contract";
import { bindManagedImageInputAliases } from "@/lib/storage/image-input-aliases";
import { ImageRepository, type ImageQueryer } from "@/lib/storage/image-repository";
import { canvasSceneSchema } from "@/lib/validators";

function databaseUrl() {
  if (process.env.CANVAS_CONTRACTS_REQUIRE_DB !== "1" || !process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL) throw new Error("Image history tests require the disposable runner");
  const url = assertDisposableTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  if (!/^\/narra_canvas_(full|additive)_[a-f0-9]{16}$/.test(url.pathname) || url.username !== "narra_canvas" || !/^[0-9a-f-]{36}$/.test(process.env.CANVAS_CONTRACTS_OWNER_TOKEN ?? "")) throw new Error("Not a runner-owned image history database");
  url.search = ""; return url.toString();
}
const url = databaseUrl();
const clients = new Set<Client>();
const fixtureImageIds = new Set<string>();
async function connection() {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000, statement_timeout: 10000, query_timeout: 12000 });
  await client.connect(); clients.add(client);
  expect((await client.query('SELECT token::text FROM "_canvas_contracts_owner"')).rows).toEqual([{ token: process.env.CANVAS_CONTRACTS_OWNER_TOKEN }]);
  return client;
}
function repository(client: Client) {
  const adapter = { $queryRaw: async (sql: Prisma.Sql) => (await client.query(sql.text, [...sql.values])).rows } as unknown as ImageQueryer;
  return new ImageRepository(adapter);
}
function inputTransaction(client: Client) {
  const compile = (query: Prisma.Sql | TemplateStringsArray, values: unknown[]) => "text" in query ? query : Prisma.sql(query, ...values);
  return {
    $executeRaw: async (query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      const sql = compile(query, values); return (await client.query(sql.text, [...sql.values])).rowCount ?? 0;
    },
    $queryRaw: async (query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      const sql = compile(query, values); return (await client.query(sql.text, [...sql.values])).rows;
    },
  } as unknown as Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;
}
async function rollback(body: (client: Client, repo: ImageRepository) => Promise<void>) {
  const client = await connection(); await client.query("BEGIN");
  try { await body(client, repository(client)); await client.query("SET CONSTRAINTS ALL IMMEDIATE"); }
  finally { await client.query("ROLLBACK"); await client.end(); clients.delete(client); }
}
async function clearPreviousCanvasGcFixture(client: Client) {
  // This sentinel-owned runner executes suites serially; the preceding Canvas
  // suite has closed all GC actors but may leave its committed fixture lease.
  // Reset that exact token inside this rollback-only fixture, under the normal
  // epoch/row order. Production and topology tests still require a real drain.
  await client.query("SELECT image_lock_reference_epoch()");
  const previous = (await client.query('SELECT token::text FROM "CanvasGcLease" WHERE id=\'canvas-imports\' FOR UPDATE')).rows;
  expect(previous).toHaveLength(1);
  expect((await client.query('UPDATE "CanvasGcLease" SET token=NULL,"expiresAt"=NULL WHERE id=\'canvas-imports\' AND token IS NOT DISTINCT FROM $1::uuid', [previous[0].token])).rowCount).toBe(1);
}
async function failure(client: Client, code: ImageErrorCode, action: () => Promise<unknown>) {
  await client.query("SAVEPOINT expected_history_failure");
  try { await expect(action().catch((error) => { throw imageDatabaseError(error) ?? error; })).rejects.toMatchObject({ code }); }
  finally { await client.query("ROLLBACK TO SAVEPOINT expected_history_failure"); await client.query("RELEASE SAVEPOINT expected_history_failure"); }
}
async function owner(client: Client) {
  const id = randomUUID();
  await client.query('INSERT INTO "User" (id,email,credits,"updatedAt") VALUES ($1,$2,100,clock_timestamp())', [id, `${id}@history.invalid`]);
  return id;
}
async function legacy(client: Client, repo: ImageRepository, options: { ownerId?: string; key?: string; url?: string; createdAt?: string } = {}) {
  const ownerId = options.ownerId ?? await owner(client); const imageId = randomUUID(); const jobId = randomUUID();
  const location = await repo.registerLocation(imageS3Location({ endpoint: "https://history-store.invalid", region: "auto", bucket: `history-${randomUUID()}`, publicBaseUrl: `https://history-cdn.invalid/${randomUUID()}` }));
  const key = options.key ?? `images/${imageId}.png`; const imageUrl = options.url ?? `${location.publicBaseUrl}/${key}`;
  await client.query(`INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,status,"updatedAt")
    VALUES ($1,$2,'BUILT_IN','gpt-image-2','history fixture','auto',1,'SUCCEEDED',clock_timestamp())`, [jobId, ownerId]);
  await client.query('INSERT INTO "GenerationImage" (id,"jobId",url,"mediaStorage","storageKey","createdAt") VALUES ($1,$2,$3,\'S3\',$4,COALESCE($5::timestamp,CURRENT_TIMESTAMP))', [imageId, jobId, imageUrl, key, options.createdAt ?? null]);
  fixtureImageIds.add(imageId);
  return { ownerId, imageId, jobId, location, key, imageUrl };
}
type Legacy = Omit<Awaited<ReturnType<typeof legacy>>, "imageId"> & { imageId: string };
async function legacyCanvas(client: Client, repo: ImageRepository, uncertain = false, fixture: { id?: string } = {}) {
  const original = await legacy(client, repo); const imageId = fixture.id ?? randomUUID(); const key = `canvas-imports/${imageId}.png`;
  const source = { ...original, imageId, key, imageUrl: `${original.location.publicBaseUrl}/${key}` };
  await client.query(`INSERT INTO "CanvasImportAsset" (id,"ownerId","userId","uploadId",sha256,"byteLength","mimeType","storageLocation","storageEndpoint","storageRegion","storageBucket","storageKey","uploadToken","uploadExpiresAt")
    VALUES ($1,$2::text,$2::text,$3::uuid,$4,10,'image/png',$5,$6,$7,$8,$9,$10::uuid,clock_timestamp())`,
  [imageId, source.ownerId, randomUUID(), "a".repeat(64), source.location.id, source.location.endpoint, source.location.region, source.location.bucket, key, randomUUID()]);
  await client.query(`UPDATE "CanvasImportAsset" SET state=$2::"CanvasImportAssetState","putOutcome"=$3::"CanvasPutOutcome" WHERE id=$1`, [imageId, uncertain ? "QUARANTINED" : "READY", uncertain ? "UNKNOWN" : "CONFIRMED"]);
  return source;
}
async function begin(repo: ImageRepository, source: Legacy, options: { targetLocationId?: string; retireSource?: boolean; requestId?: string; subjectKind?: "GENERATED" | "CANVAS_IMPORT" | "REFERENCE_URL"; pageLimit?: number } = {}) {
  const scope = options.subjectKind ?? "GENERATED";
  const limit = options.pageLimit ?? 1000;
  let page = await repo.scanImageHistory({ scope, limit });
  const upperBound = page.upperBound; const cursors = new Set<string>(); let scanPages = 1;
  let candidate = page.candidates.find((row) => row.subjectId === source.imageId);
  while (!candidate && page.nextCursor) {
    expect(cursors.has(page.nextCursor), "history scan cursor must advance").toBe(false); cursors.add(page.nextCursor);
    page = await repo.scanImageHistory({ scope, cursor: page.nextCursor, upperBound, limit }); scanPages++;
    expect(page.upperBound).toBe(upperBound);
    candidate = page.candidates.find((row) => row.subjectId === source.imageId);
  }
  expect(candidate, JSON.stringify({ scope, subjectId: source.imageId, upperBound, scanPages, nextCursor: page.nextCursor })).toBeDefined();
  if (!candidate) throw new Error("History fixture is outside the frozen scan");
  const binding: ImageHistorySourceBinding = { subjectKind: scope, subjectId: source.imageId, expectedSnapshotHash: candidate.snapshotHash, locationId: source.location.id, key: source.key, ownerId: source.ownerId };
  const input = { requestId: options.requestId ?? randomUUID(), actorId: source.ownerId, planDigest: "b".repeat(64), publicUrlBase: "https://app.history.invalid", scope, sourceBindings: [binding], upperBound, retireSource: options.retireSource ?? false, targetLocationId: options.targetLocationId };
  const job = await repo.beginImageHistoryApply(input); const token = randomUUID(); let item: ImageHistoryItem | null = null;
  for (let n = 0; n < 30 && !item; n++) item = await repo.claimImageHistoryItem({ jobId: job.id, workerId: "history-db", token });
  expect(item?.subjectId).toBe(source.imageId);
  return { input, job, item: item!, token, scanPages };
}
type Running = Awaited<ReturnType<typeof begin>>;
async function observe(repo: ImageRepository, source: Legacy, run: Running, bytes = "10") {
  return repo.recordImageObjectObservation({ requestId: randomUUID(), itemId: run.item.id, token: run.token, kind: "SOURCE", sourceSnapshotHash: run.item.snapshotHash,
    locationId: source.location.id, key: source.key, readResult: "FULL", byteLength: bytes, sha256: "a".repeat(64), mimeType: "image/png", versionEvidence: "UNVERSIONED", writerEvidence: "NOT_APPLICABLE" });
}
async function adopt(repo: ImageRepository, source: Legacy, run: Running, bytes = "10") {
  const observation = await observe(repo, source, run, bytes);
  return repo.adoptObservedImageObject({ itemId: run.item.id, token: run.token, observationId: observation.id, expectedBusinessSnapshotHash: run.item.snapshotHash });
}
async function copy(repo: ImageRepository, source: Legacy, run: Running, targetLocationId: string) {
  const adopted = await adopt(repo, source, run);
  const prepared = await repo.prepareImageMigrationCopy({ itemId: run.item.id, token: run.token, expectedSourceObjectId: adopted.item.sourceObjectId!, targetLocationId });
  return { adopted, prepared };
}
async function targetObservation(repo: ImageRepository, run: Running, item: ImageHistoryItem, options: { reconcile?: boolean; missing?: boolean; hash?: string } = {}) {
  const target = item.target!;
  return repo.recordImageObjectObservation({ requestId: randomUUID(), itemId: item.id, token: run.token,
    kind: options.reconcile ? "WRITE_RECONCILIATION" : "TARGET_READBACK", sourceSnapshotHash: item.snapshotHash,
    locationId: target.object.locationId, key: target.object.key, readResult: options.missing ? "MISSING" : "FULL",
    ...(options.missing ? {} : { byteLength: target.object.byteLength, sha256: options.hash ?? target.object.sha256, mimeType: target.object.mimeType }),
    versionEvidence: "UNVERSIONED", writerEvidence: options.reconcile && !options.missing ? "QUIESCED" : "UNKNOWN",
    ...(options.reconcile && !options.missing ? { originalWriteToken: target.object.writeToken!, writerProofSha256: "c".repeat(64) } : {}) });
}
async function waitBlocked(observer: Client, pid: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await observer.query("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS blocked", [pid])).rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected a real PostgreSQL lock wait");
}

afterAll(async () => {
  try {
    // Two-connection races commit real immutable ledger rows. Protect only this
    // suite's surviving fixtures before another serial suite snapshots global
    // cleanup candidates; never erase ledger/history rows to reset the test DB.
    if (fixtureImageIds.size) {
      const client = await connection(); await client.query("BEGIN");
      try {
        await client.query("SELECT image_lock_reference_epoch()");
        const fixtures = (await client.query<{ id: string; url: string }>(`SELECT DISTINCT a.id::text,u.url FROM "GenerationImage" g
          JOIN "ImageAsset" a ON a.id=g."mediaAssetId" JOIN "ImageUrlAlias" u ON u."assetId"=a.id
          AND u.url='https://app.history.invalid/media/images/'||a."publicToken"
          WHERE g.id=ANY($1::text[]) AND a.state='AVAILABLE'`, [[...fixtureImageIds]])).rows;
        if (fixtures.length) {
          const fixtureOwner = await owner(client); const fixtureJob = randomUUID();
          await client.query(`INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"sourceImageUrls","updatedAt")
            VALUES ($1,$2,'BUILT_IN','gpt-image-2','permanent history concurrency fixture roots','auto',1,$3::text[],clock_timestamp())`, [fixtureJob, fixtureOwner, fixtures.map((fixture) => fixture.url)]);
          expect((await client.query('SELECT count(*)::int AS n FROM "ImageReference" WHERE "referenceKey"=$1 AND permanent AND "assetId"=ANY($2::uuid[])', [`job:${fixtureJob}`, fixtures.map((fixture) => fixture.id)])).rows).toEqual([{ n: fixtures.length }]);
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally { await Promise.allSettled([...clients].map((client) => client.end())); }
});

describe("image history real PostgreSQL contracts", () => {
  it("classifies bounded stable scans and permits the planner in a read-only transaction", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const foreign = await legacy(client, repo, { url: "https://third-party.invalid/example.png" });
      await client.query('UPDATE "GenerationImage" SET "mediaStorage"=NULL,"storageKey"=NULL WHERE id=$1', [foreign.imageId]);
      const videoId = randomUUID();
      await client.query('INSERT INTO "GeneratedVideo" (id,"jobId",url) VALUES ($1,$2,$3)', [videoId, source.jobId, "https://video.invalid/movie.mp4"]);
      const first = await repo.scanImageHistory({ limit: 1 }); const collected = [...first.candidates]; let cursor = first.nextCursor;
      while (cursor) { const page = await repo.scanImageHistory({ cursor, upperBound: first.upperBound, limit: 1000 }); collected.push(...page.candidates); cursor = page.nextCursor; }
      expect(collected.filter((row) => row.subjectId === source.imageId)).toHaveLength(1);
      expect(collected.find((row) => row.subjectId === foreign.imageId)?.classification).toBe("THIRD_PARTY_OR_UNKNOWN");
      expect(collected.find((row) => row.subjectId === videoId)?.classification).toBe("VIDEO_EXCLUDED");
      const before = await repo.getUsage();
      await client.query("SAVEPOINT readonly_plan");
      // A separate top-level read-only transaction is covered below; this scan
      // uses real catalogue/data reads with no history job or object mutation.
      expect((await repo.scanImageHistory({ scope: "GENERATED", upperBound: first.upperBound, limit: 1000 })).candidates.length).toBeGreaterThan(0);
      expect(await repo.getUsage()).toEqual(before); await client.query("RELEASE SAVEPOINT readonly_plan");
    });
    const reader = await connection(); await reader.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");
    expect((await repository(reader).scanImageHistory({ limit: 1 })).candidates.length).toBeLessThanOrEqual(1);
    await reader.query("ROLLBACK");
  });

  it("finds a Canvas apply candidate beyond the first bounded scan page", async () => {
    await rollback(async (client, repo) => {
      await clearPreviousCanvasGcFixture(client);
      const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
      await legacyCanvas(client, repo, false, { id: `00000000-0000-4000-8000-${suffix}01` });
      await legacyCanvas(client, repo, false, { id: `00000000-0000-4000-8000-${suffix}02` });
      const target = await legacyCanvas(client, repo, false, { id: `00000000-0000-4000-8000-${suffix}03` });
      const run = await begin(repo, target, { subjectKind: "CANVAS_IMPORT", pageLimit: 2 });
      expect(run.scanPages).toBeGreaterThan(1);
      expect(run.item.subjectId).toBe(target.imageId);
      expect(run.job.upperBound).toBe(run.input.upperBound);
      expect(await adopt(repo, target, run)).toMatchObject({ item: { state: "SOURCE_RETAINED" } });
    });
  });

  it("compares the fixed scan cutoff to stored millisecond precision without advancing it between pages", async () => {
    await rollback(async (client, repo) => {
      const cutoff = (await client.query<{ cutoff: Date }>("SELECT date_trunc('second',clock_timestamp())-interval '1 day' AS cutoff")).rows[0].cutoff.toISOString();
      const lower = await legacy(client, repo, { createdAt: cutoff.replace(".000Z", ".000400Z") });
      const upper = await legacy(client, repo, { createdAt: cutoff.replace(".000Z", ".000600Z") });
      expect((await client.query('SELECT "createdAt"<=$2::timestamptz AS included FROM "GenerationImage" WHERE id=$1', [lower.imageId, cutoff])).rows).toEqual([{ included: true }]);
      expect((await client.query('SELECT "createdAt"<=$2::timestamptz AS included FROM "GenerationImage" WHERE id=$1', [upper.imageId, cutoff])).rows).toEqual([{ included: false }]);
      const scanAt = async (upperBound: string) => {
        let page = await repo.scanImageHistory({ scope: "GENERATED", upperBound, limit: 1 });
        const frozen = page.upperBound; const candidates = [...page.candidates];
        while (page.nextCursor) {
          page = await repo.scanImageHistory({ scope: "GENERATED", cursor: page.nextCursor, upperBound: frozen, limit: 1 });
          expect(page.upperBound).toBe(frozen); candidates.push(...page.candidates);
        }
        return candidates;
      };
      const originalScan = await scanAt(cutoff);
      expect(originalScan.some((row) => row.subjectId === lower.imageId)).toBe(true);
      expect(originalScan.some((row) => row.subjectId === upper.imageId)).toBe(false);
      expect((await scanAt(cutoff.replace(".000Z", ".001Z"))).some((row) => row.subjectId === upper.imageId)).toBe(true);
    });
  });

  it.each([
    ["Canvas GC body", "CREATE OR REPLACE FUNCTION canvas_claim_imports_v2(p_sweep_token UUID,p_storage_location TEXT,p_limit INTEGER DEFAULT 20) RETURNS SETOF \"CanvasImportAsset\" LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$"],
    ["Canvas enum", "ALTER TYPE \"CanvasPutOutcome\" ADD VALUE 'UNSUPPORTED_HISTORY_FIXTURE'"],
  ])("rejects actual %s drift through the media probe without starting Canvas", async (_name, sql) => {
    await rollback(async (client, repo) => {
      await repo.verifySchema();
      await client.query(sql);
      expect((await repo.getUsage()).policy.scope).toBe("images");
      await expect(repo.verifySchema()).rejects.toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE" });
    });
  });

  it("adopts an existing S3 object without a fake reservation, preserves original facts and accounts once", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const run = await begin(repo, source); const before = await repo.getUsage();
      const original = (await client.query('SELECT id,"jobId",url,"mediaStorage","storageKey" FROM "GenerationImage" WHERE id=$1', [source.imageId])).rows;
      const receipt = await adopt(repo, source, run); const object = receipt.item.source!.object;
      expect(object).toMatchObject({ provenance: "OBSERVED", reservationId: null, slot: null, writeToken: null, writeExpiresAt: null, putOutcome: "NOT_APPLICABLE", state: "READY" });
      expect(BigInt((await repo.getUsage()).usedBytes) - BigInt(before.usedBytes)).toBe(BigInt(10));
      expect((await repo.getUsage()).reservedBytes).toBe(before.reservedBytes);
      expect((await client.query('SELECT id,"jobId",url,"mediaStorage","storageKey" FROM "GenerationImage" WHERE id=$1', [source.imageId])).rows).toEqual(original);
      const replay = await repo.adoptObservedImageObject({ itemId: run.item.id, token: run.token, observationId: receipt.item.sourceObservationId!, expectedBusinessSnapshotHash: run.item.snapshotHash });
      expect(replay).toMatchObject({ replayed: true, accountedDelta: "0" });
      expect((await repo.resolveUrl(source.imageUrl))?.asset.id).toBe(receipt.item.assetId);
      await failure(client, "IMAGE_WRITE_CONFLICT", () => repo.finishObject({ objectId: object.id, writeToken: randomUUID(), outcome: "CONFIRMED" }));
      await failure(client, "IMAGE_HISTORY_CONFLICT", () => client.query('UPDATE "ImageObjectObservation" SET sha256=$2 WHERE id=$1::uuid', [object.sourceObservationId, "d".repeat(64)]));
    });
  });

  it("honestly adopts bytes above quota and blocks subsequent COPY/new writes", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const target = await repo.registerLocation(imageLocalLocation(randomUUID()));
      const policy = (await repo.getUsage()).policy;
      await repo.updateStoragePolicy({ expectedVersion: policy.version, limitBytes: "1", enabled: false, quotaCleanupEnabled: true, scheduleEnabled: false, retentionDays: 30, intervalSeconds: 86400 });
      const run = await begin(repo, source, { targetLocationId: target.id }); const receipt = await adopt(repo, source, run);
      expect(receipt).toMatchObject({ accountedDelta: "10", overLimit: true });
      await failure(client, "IMAGE_QUOTA_EXCEEDED", () => repo.prepareImageMigrationCopy({ itemId: run.item.id, token: run.token, expectedSourceObjectId: receipt.item.sourceObjectId!, targetLocationId: target.id }));
      await failure(client, "IMAGE_QUOTA_EXCEEDED", () => repo.reserveInput({ ownerId: source.ownerId, intentKey: randomUUID(), byteLength: 1 }));
      expect((await repo.getImageHistoryItem({ itemId: run.item.id }))?.targetObjectId).toBeNull();
      expect((await repo.resolveUrl(source.imageUrl))?.object?.id).toBe(receipt.item.sourceObjectId);
    });
  });

  it("retains large verified historical size as protected inventory instead of truncating to the upload limit", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const run = await begin(repo, source); const before = await repo.getUsage();
      const receipt = await adopt(repo, source, run, "6000000000");
      expect(receipt.item).toMatchObject({ state: "BLOCKED", source: { asset: { byteLength: "6000000000", state: "QUARANTINED" }, object: { byteLength: "6000000000", needsReconciliation: true } } });
      expect(BigInt((await repo.getUsage()).usedBytes)-BigInt(before.usedBytes)).toBe(BigInt("6000000000"));
      expect(await repo.resolveUrl(source.imageUrl)).toBeNull();
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [receipt.item.assetId])).rows[0].reason).toBe("ADOPTION_PENDING");
    });
  });

  it("preserves readable confirmed versioned WRITE rows from C1 while excluding them from migration and cleanup", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo);
      const reservation = await repo.reserveInput({ ownerId: source.ownerId, intentKey: randomUUID(), byteLength: 10 });
      const ticket = await repo.beginObject({ reservationId: reservation.id, token: reservation.token, slot: 0, locationId: source.location.id, key: `legacy-version/${randomUUID()}.png`,
        byteLength: 10, mimeType: "image/png", sha256: "a".repeat(64), purpose: "REFERENCE" });
      // This is the original C1 legal receipt shape; all production guards stay
      // active. C3 must not make an additive constraint reject that old fact.
      await client.query('UPDATE "ImageObject" SET state=\'READY\',"putOutcome"=\'CONFIRMED\',"versionId"=\'legacy-version\' WHERE id=$1::uuid', [ticket.object.id]);
      await client.query('UPDATE "ImageAsset" SET state=\'AVAILABLE\',"activeObjectId"=$2::uuid WHERE id=$1::uuid', [ticket.asset.id, ticket.object.id]);
      await repo.closeReservation({ reservationId: reservation.id, token: reservation.token });
      expect((await repo.beginRead({ assetId: ticket.asset.id }))?.image.object).toMatchObject({ provenance: "WRITE", state: "READY", putOutcome: "CONFIRMED", versionId: "legacy-version" });
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [ticket.asset.id])).rows[0].reason).toBe("VERSIONED");
    });
  });

  it("rejects changed business snapshots, changed request intent and third-party source claims", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const run = await begin(repo, source); const proof = await observe(repo, source, run);
      expect((await repo.getImageHistoryJob({ requestId: run.input.requestId }))?.id).toBe(run.job.id);
      await failure(client, "IMAGE_HISTORY_CONFLICT", () => repo.beginImageHistoryApply({ ...run.input, planDigest: "f".repeat(64) }));
      await client.query('UPDATE "GenerationImage" SET url=$2 WHERE id=$1', [source.imageId, `${source.imageUrl}?changed=1`]);
      await failure(client, "IMAGE_HISTORY_CONFLICT", () => repo.adoptObservedImageObject({ itemId: run.item.id, token: run.token, observationId: proof.id, expectedBusinessSnapshotHash: run.item.snapshotHash }));
      const foreign = await legacy(client, repo, { url: "https://foreign.invalid/image.png" }); const other = await begin(repo, foreign);
      await failure(client, "IMAGE_LOCATION_CONFLICT", () => adopt(repo, foreign, other));
    });
  });

  it("validates exact URL ownership when reusing an inventoried physical object", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const original = await begin(repo, source); const adopted = await adopt(repo, source, original);
      const foreignUrl = `https://third-party.invalid/${randomUUID()}.png`;
      const canonicalUrl = `${original.input.publicUrlBase}/media/images/${adopted.item.source!.asset.publicToken}`;
      for (const imageUrl of [foreignUrl, canonicalUrl]) {
        await client.query(`INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"sourceImageUrls","updatedAt")
          VALUES ($1,$2,'BUILT_IN','gpt-image-2','history URL proof','auto',1,ARRAY[$3],clock_timestamp())`, [randomUUID(), source.ownerId, imageUrl]);
      }
      const before = await repo.getUsage();
      const foreign = { ...source, imageId: createHash("sha256").update(foreignUrl).digest("hex"), imageUrl: foreignUrl };
      const foreignRun = await begin(repo, foreign, { subjectKind: "REFERENCE_URL" });
      await failure(client, "IMAGE_LOCATION_CONFLICT", () => adopt(repo, foreign, foreignRun));
      expect(await repo.resolveUrl(foreignUrl)).toBeNull();
      expect((await repo.getImageHistoryItem({ itemId: foreignRun.item.id }))?.sourceObjectId).toBeNull();

      // An already registered stable token URL is valid even though its base
      // differs from the historical storage endpoint/publication URL.
      const canonical = { ...source, imageId: createHash("sha256").update(canonicalUrl).digest("hex"), imageUrl: canonicalUrl };
      const canonicalRun = await begin(repo, canonical, { subjectKind: "REFERENCE_URL" });
      expect(await adopt(repo, canonical, canonicalRun)).toMatchObject({ replayed: true, accountedDelta: "0", item: { state: "SOURCE_RETAINED", assetId: adopted.item.assetId } });
      expect(await repo.getUsage()).toEqual(before);
    });
  });

  it.each([false, true])("holds a source with an unbridgeable long original URL before COPY, including physical reuse=%s", async (reused) => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo);
      if (reused) { const initial = await begin(repo, source); await adopt(repo, source, initial); }
      const longUrl = `${source.imageUrl}?retained=${"x".repeat(2200)}`; const inputOwner = await owner(client); const inputJob = randomUUID();
      await client.query('UPDATE "GenerationImage" SET url=$2 WHERE id=$1', [source.imageId, longUrl]);
      await client.query(`INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"sourceImageUrls","updatedAt")
        VALUES ($1,$2,'BUILT_IN','gpt-image-2','long frozen input','auto',1,ARRAY[$3],clock_timestamp())`, [inputJob, inputOwner, longUrl]);
      const target = await repo.registerLocation(imageLocalLocation(randomUUID()));
      const run = await begin(repo, source, { targetLocationId: target.id, retireSource: true });
      expect(run.item.exactUrl).toBeNull(); expect(run.item.snapshot.url).toBeNull();
      expect(run.item.snapshot.urlHash).toBe(createHash("sha256").update(longUrl).digest("hex"));
      const before = await repo.getUsage(); const receipt = await adopt(repo, source, run);
      expect(receipt).toMatchObject({ accountedDelta: reused ? "0" : "10", item: { state: "BLOCKED", targetObjectId: null } });
      expect(BigInt((await repo.getUsage()).usedBytes) - BigInt(before.usedBytes)).toBe(BigInt(reused ? 0 : 10));
      expect(receipt.item.source!.object).toMatchObject({ accounted: true, state: reused ? "READY" : "UNKNOWN" });
      await failure(client, "IMAGE_HISTORY_BLOCKED", () => repo.prepareImageMigrationCopy({ itemId: run.item.id, token: run.token, expectedSourceObjectId: receipt.item.sourceObjectId!, targetLocationId: target.id }));
      expect((await client.query('SELECT "releasedAt" FROM "ImageHistoryHold" WHERE "itemId"=$1::uuid', [run.item.id])).rows).toEqual([{ releasedAt: null }]);
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [receipt.item.assetId])).rows[0].reason).toBe("ADOPTION_PENDING");
      await client.query('DELETE FROM "User" WHERE id=$1', [inputOwner]);
      expect((await client.query('SELECT "exactUrl",permanent FROM "ImageHistoryReference" WHERE "referenceKey"=$1', [`job:${inputJob}`])).rows).toEqual([{ exactUrl: longUrl, permanent: true }]);
      expect((await client.query('SELECT url FROM "GenerationImage" WHERE id=$1', [source.imageId])).rows).toEqual([{ url: longUrl }]);
    });
  });

  it("counts a proven existing object after its business row disappears during IO without resurrecting a binding", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const run = await begin(repo, source); const proof = await observe(repo, source, run); const before = await repo.getUsage();
      await client.query('DELETE FROM "GenerationImage" WHERE id=$1', [source.imageId]);
      const receipt = await repo.adoptObservedImageObject({ itemId: run.item.id, token: run.token, observationId: proof.id, expectedBusinessSnapshotHash: run.item.snapshotHash });
      expect(receipt).toMatchObject({ accountedDelta: "10", item: { state: "BLOCKED", source: { asset: { state: "QUARANTINED" }, object: { provenance: "OBSERVED", state: "UNKNOWN", accounted: true, needsReconciliation: true } } } });
      expect(BigInt((await repo.getUsage()).usedBytes)-BigInt(before.usedBytes)).toBe(BigInt(10));
      expect(await repo.resolveUrl(source.imageUrl)).toBeNull();
      expect((await client.query('SELECT count(*)::int AS n FROM "GenerationImage" WHERE id=$1', [source.imageId])).rows[0].n).toBe(0);
      expect((await client.query('SELECT "releasedAt" FROM "ImageHistoryHold" WHERE "itemId"=$1::uuid', [run.item.id])).rows).toEqual([{ releasedAt: null }]);
    });
  });

  it("captures permanent unbound input roots before adoption and preserves them through owner/job deletion", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const consumer = await owner(client); const inputJob = randomUUID();
      await client.query(`INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"sourceImageUrls","updatedAt")
        VALUES ($1,$2,'BUILT_IN','gpt-image-2','input','auto',1,ARRAY[$3],clock_timestamp())`, [inputJob, consumer, source.imageUrl]);
      await client.query('DELETE FROM "User" WHERE id=$1', [consumer]);
      const run = await begin(repo, source); const receipt = await adopt(repo, source, run);
      expect((await client.query('SELECT "ownerId",permanent FROM "ImageReference" WHERE "assetId"=$1::uuid AND "referenceKey"=$2', [receipt.item.assetId, `job:${inputJob}`])).rows).toEqual([{ ownerId: consumer, permanent: true }]);
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [receipt.item.assetId])).rows[0].reason).toBe("REFERENCED");
      expect((await client.query('SELECT count(*)::int AS n FROM "GenerationJob" WHERE id=$1', [inputJob])).rows[0].n).toBe(0);
      const tokenConsumer = await owner(client); const tokenJob = randomUUID();
      const tokenUrl = `${run.input.publicUrlBase}/media/images/${receipt.item.source!.asset.publicToken}`;
      await client.query(`INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"sourceImageUrls","updatedAt")
        VALUES ($1,$2,'BUILT_IN','gpt-image-2','stable token input','auto',1,ARRAY[$3],clock_timestamp())`, [tokenJob, tokenConsumer, tokenUrl]);
      await client.query('DELETE FROM "User" WHERE id=$1', [tokenConsumer]);
      expect((await client.query('SELECT permanent FROM "ImageReference" WHERE "assetId"=$1::uuid AND "referenceKey"=$2', [receipt.item.assetId, `job:${tokenJob}`])).rows).toEqual([{ permanent: true }]);
    });
  });

  it("keeps adoption holds until aliases/roots are complete and makes COPY replay return one durable target", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const target = await repo.registerLocation(imageLocalLocation(randomUUID())); const run = await begin(repo, source, { targetLocationId: target.id });
      const { adopted, prepared } = await copy(repo, source, run, target.id); const beforeReplay = await repo.getUsage();
      expect((await client.query('SELECT image_cleanup_reason($1::uuid) AS reason', [adopted.item.assetId])).rows[0].reason).toBe("ADOPTION_PENDING");
      const replay = await repo.prepareImageMigrationCopy({ itemId: run.item.id, token: run.token, expectedSourceObjectId: adopted.item.sourceObjectId!, targetLocationId: target.id });
      expect(prepared.ticket.writeGranted).toBe(true); expect(replay.ticket.writeGranted).toBe(false);
      expect(replay.ticket.object.id).toBe(prepared.ticket.object.id); expect(replay.item.targetKey).toBe(prepared.item.targetKey);
      expect(await repo.getUsage()).toEqual(beforeReplay);
      await failure(client, "IMAGE_HISTORY_CONFLICT", () => client.query('UPDATE "ImageHistoryHold" SET "releasedAt"=clock_timestamp() WHERE "itemId"=$1::uuid', [run.item.id]));
    });
  });

  it("adopts Canvas originals with saved roots and preserves the original tuple, upload identity and logical quota", async () => {
    await rollback(async (client, repo) => {
      await clearPreviousCanvasGcFixture(client);
      const source = await legacyCanvas(client, repo); const canvasId = randomUUID();
      await client.query('INSERT INTO "Canvas" (id,"ownerId","userId",title) VALUES ($1::uuid,$2::text,$2::text,\'Historical import\')', [canvasId, source.ownerId]);
      const scene = canvasSceneSchema.parse({ schemaVersion: 1, nodes: [{ id: randomUUID(), kind: "reference", position: { x: 0, y: 0 }, source: { kind: "imported", assetId: source.imageId } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, runBindings: [] });
      await client.query("SELECT canvas_save_snapshot($1,$2::uuid,0,$3::uuid,$4::jsonb,$5)", [source.ownerId, canvasId, randomUUID(), JSON.stringify(scene), createHash("sha256").update(canonicalCanvasJson(scene)).digest("hex")]);
      const original = (await client.query('SELECT to_jsonb(c)-ARRAY[\'mediaAssetId\',\'updatedAt\'] AS original FROM "CanvasImportAsset" c WHERE id=$1', [source.imageId])).rows;
      const run = await begin(repo, source, { subjectKind: "CANVAS_IMPORT" }); const receipt = await adopt(repo, source, run);
      expect(receipt.item.state).toBe("SOURCE_RETAINED");
      expect((await client.query('SELECT to_jsonb(c)-ARRAY[\'mediaAssetId\',\'updatedAt\'] AS original FROM "CanvasImportAsset" c WHERE id=$1', [source.imageId])).rows).toEqual(original);
      expect((await client.query('SELECT kind FROM "ImageReference" WHERE "assetId"=$1::uuid', [receipt.item.assetId])).rows).toEqual([{ kind: "CANVAS_SAVED" }]);
      expect((await client.query('SELECT count(*)::int AS n,sum("byteLength")::text AS bytes FROM "CanvasImportAsset" WHERE "ownerId"=$1 AND "physicalBytesAccounted"', [source.ownerId])).rows).toEqual([{ n: 1, bytes: "10" }]);
      expect((await client.query('SELECT scene FROM "Canvas" WHERE id=$1::uuid', [canvasId])).rows[0].scene).toEqual(scene);
    });
  });

  it("counts but quarantines an uncertain Canvas source and excludes it from compatibility GC without changing original facts", async () => {
    await rollback(async (client, repo) => {
      await clearPreviousCanvasGcFixture(client);
      const source = await legacyCanvas(client, repo, true); const run = await begin(repo, source, { subjectKind: "CANVAS_IMPORT" });
      const before = (await client.query('SELECT to_jsonb(c) AS original FROM "CanvasImportAsset" c WHERE id=$1', [source.imageId])).rows;
      const receipt = await adopt(repo, source, run);
      expect(receipt).toMatchObject({ accountedDelta: "10", item: { state: "BLOCKED", source: { object: { provenance: "OBSERVED", putOutcome: "UNKNOWN", state: "UNKNOWN", needsReconciliation: true } } } });
      expect((await client.query('SELECT to_jsonb(c) AS original FROM "CanvasImportAsset" c WHERE id=$1', [source.imageId])).rows).toEqual(before);
      const token = randomUUID(); expect((await client.query("SELECT canvas_acquire_gc_lease_v2($1::uuid) AS acquired", [token])).rows[0].acquired).toBe(true);
      expect((await client.query('SELECT id FROM canvas_claim_imports_v2($1::uuid,$2,100)', [token, source.location.id])).rows).toEqual([]);
      expect((await client.query('SELECT "releasedAt" FROM "ImageHistoryHold" WHERE "itemId"=$1::uuid', [run.item.id])).rows).toEqual([{ releasedAt: null }]);
    });
  });

  it("keeps a confirmed Canvas source quarantined while a real GC lease is active", async () => {
    await rollback(async (client, repo) => {
      await clearPreviousCanvasGcFixture(client);
      const source = await legacyCanvas(client, repo); const token = randomUUID();
      expect((await client.query("SELECT canvas_acquire_gc_lease_v2($1::uuid) AS acquired", [token])).rows[0].acquired).toBe(true);
      const original = (await client.query('SELECT to_jsonb(c) AS original FROM "CanvasImportAsset" c WHERE id=$1', [source.imageId])).rows;
      const run = await begin(repo, source, { subjectKind: "CANVAS_IMPORT" });
      const receipt = await adopt(repo, source, run);
      expect(receipt).toMatchObject({ accountedDelta: "10", item: { state: "BLOCKED", source: { asset: { state: "QUARANTINED" }, object: { state: "UNKNOWN", accounted: true, needsReconciliation: true } } } });
      expect((await client.query('SELECT to_jsonb(c) AS original FROM "CanvasImportAsset" c WHERE id=$1', [source.imageId])).rows).toEqual(original);
      expect(await repo.resolveUrl(source.imageUrl)).toBeNull();
      expect((await client.query('SELECT id FROM canvas_claim_imports_v2($1::uuid,$2,100)', [token, source.location.id])).rows).toEqual([]);
      expect((await client.query('SELECT "releasedAt" FROM "ImageHistoryHold" WHERE "itemId"=$1::uuid', [run.item.id])).rows).toEqual([{ releasedAt: null }]);
    });
  });

  it("requires positive target readback before switching, keeps source by default and replays the same proof", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const target = await repo.registerLocation(imageLocalLocation(randomUUID())); const run = await begin(repo, source, { targetLocationId: target.id });
      const { adopted, prepared } = await copy(repo, source, run, target.id);
      await repo.finishObject({ objectId: prepared.ticket.object.id, writeToken: prepared.ticket.object.writeToken, outcome: "CONFIRMED" });
      await repo.closeReservation({ reservationId: prepared.reservation.id, token: prepared.reservation.token });
      const read = await repo.prepareImageCopyReconciliation({ itemId: run.item.id, token: run.token, expectedTargetObjectId: prepared.ticket.object.id });
      const bad = await targetObservation(repo, run, read.item, { hash: "d".repeat(64) });
      const switchInput = { itemId: run.item.id, token: run.token, expectedActiveObjectId: adopted.item.sourceObjectId!, aliasUrls: await repo.getImageHistoryAliases({ assetId: adopted.item.assetId! }), readerProtocolRevision: 3 as const };
      await failure(client, "IMAGE_OBSERVATION_REQUIRED", () => repo.commitImageMigrationSwitch({ ...switchInput, targetReadbackObservationId: bad.id }));
      expect((await repo.resolveUrl(source.imageUrl))?.object?.id).toBe(adopted.item.sourceObjectId);
      const good = await targetObservation(repo, run, read.item); const receipt = await repo.commitImageMigrationSwitch({ ...switchInput, targetReadbackObservationId: good.id });
      expect(receipt).toMatchObject({ switched: true, replayed: false, item: { state: "SOURCE_RETAINED" } });
      expect((await repo.resolveUrl(source.imageUrl))?.object?.id).toBe(prepared.ticket.object.id);
      expect((await client.query('SELECT accounted,state FROM "ImageObject" WHERE id=$1::uuid', [adopted.item.sourceObjectId])).rows).toEqual([{ accounted: true, state: "READY" }]);
      expect(await repo.commitImageMigrationSwitch({ ...switchInput, targetReadbackObservationId: good.id })).toMatchObject({ replayed: true, replicaVerificationId: receipt.replicaVerificationId });
      await failure(client, "IMAGE_HISTORY_CONFLICT", () => repo.requestImageHistorySourceRetirement({ itemId: run.item.id, token: run.token }));
      const beforeReuse = await repo.getUsage();
      const later = await begin(repo, source, { targetLocationId: target.id, retireSource: true });
      const reused = await copy(repo, source, later, target.id);
      expect(reused.prepared.ticket).toMatchObject({ writeGranted: false, object: { id: prepared.ticket.object.id } });
      expect(await repo.getUsage()).toEqual(beforeReuse);
      const fresh = await targetObservation(repo, later, reused.prepared.item);
      const verifiedAgain = await repo.commitImageMigrationSwitch({ itemId: later.item.id, token: later.token, expectedActiveObjectId: prepared.ticket.object.id, targetReadbackObservationId: fresh.id,
        aliasUrls: await repo.getImageHistoryAliases({ assetId: adopted.item.assetId! }), readerProtocolRevision: 3 });
      expect(verifiedAgain.item.targetObjectId).toBe(prepared.ticket.object.id);
      expect(verifiedAgain.replicaVerificationId).not.toBe(receipt.replicaVerificationId);
    });
  });

  it("keeps UNKNOWN bytes and original writer expiry on missing, then accepts only immutable positive reconciliation", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const target = await repo.registerLocation(imageLocalLocation(randomUUID())); const run = await begin(repo, source, { targetLocationId: target.id });
      const { prepared } = await copy(repo, source, run, target.id); const object = prepared.ticket.object;
      await repo.finishObject({ objectId: object.id, writeToken: object.writeToken, outcome: "UNKNOWN" });
      await repo.closeReservation({ reservationId: prepared.reservation.id, token: prepared.reservation.token });
      const before = await repo.getUsage();
      const read = await repo.prepareImageCopyReconciliation({ itemId: run.item.id, token: run.token, expectedTargetObjectId: object.id });
      const missing = await targetObservation(repo, run, read.item, { reconcile: true, missing: true });
      expect(await repo.finishImageCopyReconciliation({ itemId: run.item.id, token: run.token, observationId: missing.id, expectedOriginalWriteToken: object.writeToken })).toMatchObject({ accepted: false, byteDelta: "0" });
      expect(await repo.getUsage()).toEqual(before);
      const resumed = await repo.prepareImageCopyReconciliation({ itemId: run.item.id, token: run.token, expectedTargetObjectId: object.id });
      const positive = await targetObservation(repo, run, resumed.item, { reconcile: true });
      const receipt = await repo.finishImageCopyReconciliation({ itemId: run.item.id, token: run.token, observationId: positive.id, expectedOriginalWriteToken: object.writeToken });
      expect(receipt).toMatchObject({ accepted: true, byteDelta: "0", item: { target: { object: { state: "READY", putOutcome: "UNKNOWN", needsReconciliation: false, writeExpiresAt: object.writeExpiresAt, reconciliationObservationId: positive.id } } } });
      expect(await repo.getUsage()).toEqual(before);
      await failure(client, "IMAGE_WRITE_CONFLICT", () => client.query('UPDATE "ImageObject" SET "writeExpiresAt"=clock_timestamp()+interval \'1 hour\' WHERE id=$1::uuid', [object.id]));
    });
  });

  it("hands explicit source retirement to the existing executor and never releases bytes on failed deletion", async () => {
    await rollback(async (client, repo) => {
      const source = await legacy(client, repo); const target = await repo.registerLocation(imageLocalLocation(randomUUID())); const run = await begin(repo, source, { targetLocationId: target.id, retireSource: true });
      const { adopted, prepared } = await copy(repo, source, run, target.id);
      await repo.finishObject({ objectId: prepared.ticket.object.id, writeToken: prepared.ticket.object.writeToken, outcome: "CONFIRMED" });
      await repo.closeReservation({ reservationId: prepared.reservation.id, token: prepared.reservation.token });
      const read = await repo.prepareImageCopyReconciliation({ itemId: run.item.id, token: run.token, expectedTargetObjectId: prepared.ticket.object.id });
      const proof = await targetObservation(repo, run, read.item);
      await repo.commitImageMigrationSwitch({ itemId: run.item.id, token: run.token, targetReadbackObservationId: proof.id, expectedActiveObjectId: adopted.item.sourceObjectId!, aliasUrls: await repo.getImageHistoryAliases({ assetId: adopted.item.assetId! }), readerProtocolRevision: 3 });
      // A process can stop after the switch commits and before requesting
      // retirement. Another token cannot steal its live lease, and job progress
      // must still report that pending request as incomplete.
      expect(await repo.claimImageHistoryItem({ jobId: run.job.id, workerId: "history-resume", token: randomUUID() })).toBeNull();
      const interrupted = await repo.getImageHistoryJob({ jobId: run.job.id });
      expect(interrupted).toMatchObject({ state: "RUNNING", blockedItems: 0 });
      expect(interrupted!.completedItems).toBe(interrupted!.totalItems - 1);
      const policy = (await repo.getUsage()).policy;
      await repo.updateStoragePolicy({ expectedVersion: policy.version, limitBytes: policy.limitBytes, enabled: true, quotaCleanupEnabled: true, scheduleEnabled: false, retentionDays: 30, intervalSeconds: 86400 });
      const retirement = await repo.requestImageHistorySourceRetirement({ itemId: run.item.id, token: run.token }); expect(retirement.job.mode).toBe("SOURCE_RETIREMENT");
      const requested = await repo.getImageHistoryJob({ jobId: run.job.id });
      expect(requested!.completedItems).toBe(requested!.totalItems);
      const token = randomUUID(); expect(await repo.acquireMaintenanceLease({ workerId: "history-retirement", token })).toBe(true);
      const claims = await repo.claimMaintenance({ executorToken: token, verifiedLocationIds: [source.location.id, target.id] });
      expect(claims).toHaveLength(1); expect(claims[0].object.id).toBe(adopted.item.sourceObjectId);
      const before = await repo.getUsage();
      const failed = await repo.finishMaintenanceObject({ jobId: claims[0].jobId, itemId: claims[0].itemId, objectId: claims[0].object.id, deleteToken: claims[0].deleteToken, outcome: "FAILED" });
      expect(failed).toMatchObject({ accepted: true, releasedBytes: "0" }); expect(await repo.getUsage()).toEqual(before);
      expect((await repo.getByAssetId(adopted.item.assetId!))?.asset.state).toBe("AVAILABLE");
      expect((await repo.requestImageHistorySourceRetirement({ itemId: run.item.id, token: run.token })).job.id).toBe(retirement.job.id);
      await client.query('UPDATE "ImageObject" SET "deleteExpiresAt"=clock_timestamp()-interval \'1 second\',"nextDeleteAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1::uuid', [claims[0].object.id]);
      await client.query('UPDATE "ImageMaintenanceJob" SET "nextAttemptAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1::uuid', [retirement.job.id]);
      const retry = (await repo.claimMaintenance({ executorToken: token, verifiedLocationIds: [source.location.id, target.id] }))[0];
      expect(retry.object.id).toBe(claims[0].object.id); expect(retry.deleteToken).not.toBe(claims[0].deleteToken);
      const done = await repo.finishMaintenanceObject({ jobId: retry.jobId, itemId: retry.itemId, objectId: retry.object.id, deleteToken: retry.deleteToken, outcome: "DELETED" });
      expect(done).toMatchObject({ accepted: true, releasedBytes: "10" });
      expect(BigInt(before.usedBytes)-BigInt((await repo.getUsage()).usedBytes)).toBe(BigInt(10));
      expect((await repo.resolveUrl(source.imageUrl))?.object?.id).toBe(prepared.ticket.object.id);
      expect(await repo.finishMaintenanceObject({ jobId: retry.jobId, itemId: retry.itemId, objectId: retry.object.id, deleteToken: retry.deleteToken, outcome: "DELETED" })).toMatchObject({ replayed: true, releasedBytes: "0" });
    });
  });

  it("serializes an unbound new job against alias adoption on two real connections", async () => {
    const first = await connection(); const second = await connection(); const observer = await connection(); const firstRepo = repository(first); const secondRepo = repository(second);
    const source = await legacy(first, firstRepo); const run = await begin(firstRepo, source); const observation = await observe(firstRepo, source, run);
    const consumer = await owner(first); const jobId = randomUUID(); const before = await firstRepo.getUsage();
    await first.query("BEGIN");
    await first.query(`INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"sourceImageUrls","updatedAt") VALUES ($1,$2,'BUILT_IN','gpt-image-2','racing input','auto',1,ARRAY[$3],clock_timestamp())`, [jobId, consumer, source.imageUrl]);
    const pid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const adoption = secondRepo.adoptObservedImageObject({ itemId: run.item.id, token: run.token, observationId: observation.id, expectedBusinessSnapshotHash: run.item.snapshotHash });
    void adoption.catch(() => undefined);
    try { await waitBlocked(observer, pid); await first.query("COMMIT"); const adopted = await adoption;
      await first.query('DELETE FROM "User" WHERE id=$1', [consumer]);
      expect((await first.query('SELECT permanent FROM "ImageReference" WHERE "assetId"=$1::uuid AND "referenceKey"=$2', [adopted.item.assetId, `job:${jobId}`])).rows).toEqual([{ permanent: true }]);
      expect(BigInt((await firstRepo.getUsage()).usedBytes)-BigInt(before.usedBytes)).toBe(BigInt(10));
    } finally { await first.query("ROLLBACK"); await Promise.allSettled([adoption]); }
  });

  it("serializes current-cover creation against adoption and records an exact protected alias", async () => {
    const first = await connection(); const second = await connection(); const observer = await connection(); const firstRepo = repository(first); const secondRepo = repository(second);
    const source = await legacy(first, firstRepo); const run = await begin(firstRepo, source); const proof = await observe(firstRepo, source, run);
    await first.query("BEGIN");
    await first.query(`INSERT INTO "LoginCoverConfig" (id,scope,mode,"customUrl","updatedAt") VALUES ($2,'default','custom',$1,clock_timestamp()) ON CONFLICT(scope) DO UPDATE SET mode='custom',"customUrl"=excluded."customUrl","updatedAt"=excluded."updatedAt"`, [source.imageUrl, randomUUID()]);
    const pid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const adoption = secondRepo.adoptObservedImageObject({ itemId: run.item.id, token: run.token, observationId: proof.id, expectedBusinessSnapshotHash: run.item.snapshotHash });
    void adoption.catch(() => undefined);
    try { await waitBlocked(observer, pid); await first.query("COMMIT"); const adopted = await adoption;
      expect((await first.query('SELECT "ownerId",kind FROM "ImageReference" WHERE "assetId"=$1::uuid AND kind=\'SITE_COVER\'', [adopted.item.assetId])).rows).toEqual([{ ownerId: "site", kind: "SITE_COVER" }]);
      expect(await firstRepo.resolveUrl(`${source.imageUrl}?other=1`)).toBeNull();
    } finally { await first.query("ROLLBACK"); await Promise.allSettled([adoption]); }
  });

  it.each(["JOB_INPUT", "SITE_COVER"] as const)("binds an accepted token URL spelling and its %s root before a concurrent cleanup snapshot", async (kind) => {
    const first = await connection(); const second = await connection(); const observer = await connection();
    const firstRepo = repository(first); const secondRepo = repository(second);
    const source = await legacy(first, firstRepo); const run = await begin(firstRepo, source); const adopted = await adopt(firstRepo, source, run);
    const assetId = adopted.item.assetId!; const token = adopted.item.source!.asset.publicToken;
    const canonical = `${run.input.publicUrlBase}/media/images/${token}`;
    const variant = `https://APP.history.invalid:443/media/images/${token}`;
    const foreign = `https://other.history.invalid/media/images/${token}`;
    expect((await firstRepo.resolveUrl(canonical))?.asset.id).toBe(assetId);
    expect(await firstRepo.resolveUrl(variant)).toBeNull();
    expect((await first.query('SELECT image_cleanup_reason($1::uuid) AS reason', [assetId])).rows[0].reason).toBeNull();
    const consumer = await owner(first); const inputJob = randomUUID(); const policy = (await firstRepo.getUsage()).policy;
    const pid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    let cleanup: ReturnType<ImageRepository["previewCleanup"]> | undefined;
    await first.query("BEGIN");
    try {
      await bindManagedImageInputAliases(inputTransaction(first), [variant, foreign], run.input.publicUrlBase);
      if (kind === "JOB_INPUT") {
        await first.query(`INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"sourceImageUrls","updatedAt")
          VALUES ($1,$2,'BUILT_IN','gpt-image-2','variant frozen input','auto',1,ARRAY[$3,$4],clock_timestamp())`, [inputJob, consumer, variant, foreign]);
      } else {
        await first.query(`INSERT INTO "LoginCoverConfig" (id,scope,mode,"customUrl","updatedAt") VALUES ($1,'default','custom',$2,clock_timestamp())
          ON CONFLICT(scope) DO UPDATE SET mode='custom',"customUrl"=excluded."customUrl","updatedAt"=excluded."updatedAt"`, [randomUUID(), variant]);
      }
      cleanup = secondRepo.previewCleanup({ actorId: source.ownerId, previewRequestId: randomUUID(), expectedPolicyVersion: policy.version, mode: "MANUAL_ALL" });
      void cleanup.catch(() => undefined);
      await waitBlocked(observer, pid);
      await first.query("COMMIT");
      const preview = await cleanup;
      expect((await firstRepo.resolveUrl(variant))?.asset.id).toBe(assetId);
      expect(await firstRepo.resolveUrl(foreign)).toBeNull();
      expect((await first.query('SELECT count(*)::int AS n FROM "ImageMaintenanceItem" WHERE "jobId"=$1::uuid AND "assetId"=$2::uuid', [preview.previewId, assetId])).rows).toEqual([{ n: 0 }]);
      const referenceKey = kind === "JOB_INPUT" ? `job:${inputJob}` : "login-cover:default";
      expect((await first.query('SELECT kind,permanent FROM "ImageReference" WHERE "assetId"=$1::uuid AND "referenceKey"=$2', [assetId, referenceKey])).rows).toEqual([{ kind, permanent: kind === "JOB_INPUT" }]);
      if (kind === "JOB_INPUT") {
        await first.query('DELETE FROM "User" WHERE id=$1', [consumer]);
        expect((await first.query('SELECT permanent FROM "ImageReference" WHERE "assetId"=$1::uuid AND "referenceKey"=$2', [assetId, referenceKey])).rows).toEqual([{ permanent: true }]);
      } else {
        expect((await first.query('SELECT "customUrl" FROM "LoginCoverConfig" WHERE scope=\'default\'')).rows).toEqual([{ customUrl: variant }]);
      }
      expect((await first.query('SELECT image_cleanup_reason($1::uuid) AS reason', [assetId])).rows[0].reason).toBe("REFERENCED");
    } finally {
      await first.query("ROLLBACK");
      if (cleanup) await Promise.allSettled([cleanup]);
    }
  });

  it("serializes duplicate physical adoption on two connections without duplicate accounting", async () => {
    const first = await connection(); const second = await connection(); const observer = await connection(); const firstRepo = repository(first); const secondRepo = repository(second);
    const source = await legacy(first, firstRepo); const run = await begin(firstRepo, source); const proof = await observe(firstRepo, source, run); const before = await firstRepo.getUsage();
    await first.query("BEGIN");
    const input = { itemId: run.item.id, token: run.token, observationId: proof.id, expectedBusinessSnapshotHash: run.item.snapshotHash };
    const adopted = await firstRepo.adoptObservedImageObject(input); const pid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const replay = secondRepo.adoptObservedImageObject(input);
    void replay.catch(() => undefined);
    try { await waitBlocked(observer, pid); await first.query("COMMIT"); expect(await replay).toMatchObject({ replayed: true, accountedDelta: "0", item: { sourceObjectId: adopted.item.sourceObjectId } });
      expect(BigInt((await firstRepo.getUsage()).usedBytes)-BigInt(before.usedBytes)).toBe(BigInt(10));
      expect((await first.query('SELECT count(*)::int AS n FROM "ImageObject" WHERE "physicalNamespace"=$1 AND key=$2', [source.location.physicalNamespace, source.key])).rows[0].n).toBe(1);
    } finally { await first.query("ROLLBACK"); await Promise.allSettled([replay]); }
  });
});
