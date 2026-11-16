// @vitest-environment node

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertDisposableTestDatabaseUrl } from "../../../../scripts/lib/disposable-test-environment.mjs";
import boundaries from "../../../../contracts/media/v1/scenarios/input-boundaries.json";
import {
  MAX_IMAGE_BYTES, imageDatabaseError, imageLocalLocation, imagePublicUrl, imageReservationSchema, imageS3Location,
  type ImageErrorCode, type ImageReservation,
} from "@/lib/storage/image-contract";
import { ImageRepository } from "@/lib/storage/image-repository";

function requiredDatabase() {
  if (process.env.CANVAS_CONTRACTS_REQUIRE_DB !== "1") throw new Error("Canvas/image DB contracts require the disposable runner sentinel");
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw || raw !== process.env.DATABASE_URL) throw new Error("A runner-owned database URL is required; no environment fallback");
  const url = assertDisposableTestDatabaseUrl(raw);
  if (!/^\/narra_canvas_(full|additive)_[a-f0-9]{16}$/.test(url.pathname) || url.username !== "narra_canvas"
    || !/^[0-9a-f-]{36}$/.test(process.env.CANVAS_CONTRACTS_OWNER_TOKEN ?? "")) throw new Error("Not a canvas/image runner database");
  url.search = "";
  return url.toString();
}

const databaseUrl = requiredDatabase();
const observer = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 8000, query_timeout: 10000 });
let prisma: PrismaClient;
const connections = new Set<Client>();

async function connection() {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 8000, query_timeout: 10000 });
  await client.connect();
  connections.add(client);
  return client;
}

async function rolledBack(body: (tx: Prisma.TransactionClient, repository: ImageRepository) => Promise<void>) {
  const rollback = new Error("Rollback image database fixture");
  try {
    await prisma.$transaction(async (tx) => {
      await body(tx, new ImageRepository(tx));
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      throw rollback;
    }, { timeout: 15000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function imageFailure(tx: Prisma.TransactionClient, code: ImageErrorCode, action: () => Promise<unknown>) {
  await tx.$executeRaw`SAVEPOINT image_expected_failure`;
  let failure: unknown;
  try { await action(); } catch (error) { failure = error; }
  finally {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT image_expected_failure`;
    await tx.$executeRaw`RELEASE SAVEPOINT image_expected_failure`;
  }
  expect(imageDatabaseError(failure)?.code).toBe(code);
}

async function user(tx: Prisma.TransactionClient) {
  const id = randomUUID();
  await tx.user.create({ data: { id, email: `${id}@images.example.test`, credits: 100 } });
  return id;
}

async function job(tx: Prisma.TransactionClient, ownerId: string, extra: Partial<Prisma.GenerationJobUncheckedCreateInput> = {}) {
  return tx.generationJob.create({ data: {
    id: randomUUID(), userId: ownerId, workerManaged: true, providerMode: "BUILT_IN", model: "gpt-image-2",
    prompt: "isolated image contract fixture", size: "auto", count: 1, ...extra,
  } });
}

async function inputObject(repository: ImageRepository, ownerId = randomUUID(), byteLength = 10) {
  const location = await repository.registerLocation(imageLocalLocation(randomUUID()));
  const reservation = await repository.reserveInput({ ownerId, intentKey: randomUUID(), byteLength });
  const ticket = await repository.beginObject({
    reservationId: reservation.id, token: reservation.token, slot: 0, locationId: location.id, key: `references/${randomUUID()}.png`,
    byteLength, mimeType: "image/png", sha256: "a".repeat(64), purpose: "REFERENCE",
  });
  return { location, reservation, ticket };
}

async function generatedObject(tx: Prisma.TransactionClient, repository: ImageRepository) {
  const ownerId = await user(tx);
  const outputJob = await job(tx, ownerId, { status: "PROCESSING", workerId: "image-fixture-worker" });
  const reservation = await repository.acquireForJob({ jobId: outputJob.id, workerId: "image-fixture-worker" });
  const location = await repository.registerLocation(imageLocalLocation(randomUUID()));
  const imageId = randomUUID();
  const ticket = await repository.beginObject({
    reservationId: reservation.id, token: reservation.token, slot: 0, locationId: location.id, key: `generated/${imageId}.png`,
    byteLength: 10, mimeType: "image/png", sha256: "b".repeat(64), purpose: "GENERATED", originId: imageId,
  });
  await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "CONFIRMED" });
  const url = imagePublicUrl("https://images.example.test", ticket.asset.publicToken);
  await repository.registerAlias({ assetId: ticket.asset.id, url });
  await tx.generationImage.create({ data: { id: imageId, jobId: outputJob.id, mediaAssetId: ticket.asset.id, mediaStorage: "LOCAL", storageKey: ticket.object.key, url } });
  await tx.generationJob.update({ where: { id: outputJob.id }, data: { status: "SUCCEEDED" } });
  await repository.closeReservation({ reservationId: reservation.id, token: reservation.token });
  return { ownerId, outputJob, imageId, ticket, url };
}

async function waitForBlock(waiter: number, blocker: number) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await observer.query<{ blocked: boolean }>("SELECT $2::integer = ANY(pg_blocking_pids($1::integer)) AS blocked", [waiter, blocker]);
    if (result.rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Expected an observed PostgreSQL row-lock wait");
}

describe("managed image contracts on disposable PostgreSQL", () => {
  beforeAll(async () => {
    await observer.connect();
    const sentinel = await observer.query<{ token: string }>('SELECT token::text FROM "_canvas_contracts_owner"');
    expect(sentinel.rows).toEqual([{ token: process.env.CANVAS_CONTRACTS_OWNER_TOKEN }]);
    // Construct the real Prisma driver only after checking database ownership.
    // This suite does not load auth configuration or a developer dotenv file.
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const prismaSentinel = await prisma.$queryRaw<Array<{ token: string }>>`SELECT token::text FROM "_canvas_contracts_owner"`;
    expect(prismaSentinel).toEqual(sentinel.rows);
  });

  afterAll(async () => {
    await Promise.allSettled([...connections].map((client) => client.end()));
    await prisma?.$disconnect();
    await observer.end();
  });

  it("verifies real catalogue guards independently of successful policy reads", async () => {
    await new ImageRepository(prisma).verifySchema();
    await rolledBack(async (tx, repository) => {
      await tx.$executeRaw`ALTER TABLE "ImageReference" DISABLE TRIGGER "ImageReference_guard"`;
      expect((await repository.getUsage()).policy.scope).toBe("images");
      await expect(repository.verifySchema()).rejects.toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE" });
    });
    await new ImageRepository(prisma).verifySchema();
  });

  it("rejects the same noncanonical identifier and byte strings as Node and Go", async () => {
    await rolledBack(async (tx) => {
      expect(await tx.$queryRaw<Array<{ bytes: bigint }>>`SELECT image_bytes('10') AS bytes`).toEqual([{ bytes: BigInt(10) }]);
      for (const value of boundaries.invalidVolumeIds) {
        await imageFailure(tx, "IMAGE_INVALID_INPUT", () => tx.$queryRaw`SELECT image_uuid(${value}::text)`);
      }
      for (const value of boundaries.invalidByteLengths) {
        await imageFailure(tx, "IMAGE_INVALID_INPUT", () => tx.$queryRaw`SELECT image_bytes(${value}::text)`);
      }
      for (const value of ["30\n", "30\r", "30\r\n", "30\u2028", "30\u2029"]) {
        await imageFailure(tx, "IMAGE_INVALID_INPUT", () => tx.$queryRaw`SELECT image_lease_seconds(${value}::text)`);
      }
    });
  });

  it("binds output budgets and fences old workers before new physical writes", async () => {
    await rolledBack(async (tx, repository) => {
      const ownerId = await user(tx);
      const outputJob = await job(tx, ownerId, { count: 2 });
      const initial = await repository.getUsage();
      const reserved = await repository.reserveOutputs({ ownerId, intentKey: randomUUID(), count: 2 });
      await repository.bindReservation({ reservationId: reserved.id, token: reserved.token, ownerId, jobId: outputJob.id });
      await imageFailure(tx, "IMAGE_RESERVATION_CONFLICT", () => repository.closeReservation({ reservationId: reserved.id, token: reserved.token }));
      await imageFailure(tx, "IMAGE_RESERVATION_CONFLICT", () => repository.acquireForJob({ jobId: outputJob.id, workerId: "first" }));
      await tx.generationJob.update({ where: { id: outputJob.id }, data: { status: "PROCESSING", workerId: "first" } });
      const acquired = await repository.acquireForJob({ jobId: outputJob.id, workerId: "first" });
      expect(acquired.token).not.toBe(reserved.token);
      const location = await repository.registerLocation(imageLocalLocation(randomUUID()));
      const request = {
        reservationId: reserved.id, token: acquired.token, slot: 0, locationId: location.id, key: `generated/${randomUUID()}.png`,
        byteLength: 10, mimeType: "image/png", sha256: "a".repeat(64), purpose: "GENERATED" as const,
      };
      await imageFailure(tx, "IMAGE_RESERVATION_CONFLICT", () => repository.beginObject({ ...request, token: reserved.token }));
      const ticket = await repository.beginObject(request);
      expect(ticket.writeGranted).toBe(true);
      expect((await repository.beginObject(request)).writeGranted).toBe(false);
      const mid = await repository.getUsage();
      expect(BigInt(mid.usedBytes) - BigInt(initial.usedBytes)).toBe(BigInt("10"));
      expect(BigInt(mid.reservedBytes) - BigInt(initial.reservedBytes)).toBe(BigInt(MAX_IMAGE_BYTES));
      await tx.generationJob.update({ where: { id: outputJob.id }, data: { workerId: "second" } });
      await imageFailure(tx, "IMAGE_RESERVATION_CONFLICT", () => repository.acquireForJob({ jobId: outputJob.id, workerId: "first" }));
      const late = await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "CONFIRMED" });
      expect(late).toMatchObject({ accepted: false, object: { state: "UNKNOWN", accounted: true, putOutcome: "UNKNOWN" } });
      const takeover = await repository.acquireForJob({ jobId: outputJob.id, workerId: "second" });
      expect(takeover.token).not.toBe(acquired.token);
      await imageFailure(tx, "IMAGE_RESERVATION_CONFLICT", () => repository.beginObject({ ...request, slot: 1 }));
      expect((await repository.beginObject({ ...request, token: takeover.token })).writeGranted).toBe(false);
      await tx.generationJob.update({ where: { id: outputJob.id }, data: { status: "FAILED" } });
      await repository.closeReservation({ reservationId: reserved.id, token: takeover.token });
      const after = await repository.getUsage();
      expect(after.reservedBytes).toBe(initial.reservedBytes);
      expect(BigInt(after.usedBytes) - BigInt(initial.usedBytes)).toBe(BigInt("10"));
    });
  });

  it("releases only a proven NOT_WRITTEN object and keeps unknown writes accounted", async () => {
    await rolledBack(async (tx, repository) => {
      const initial = await repository.getUsage();
      const { ticket, reservation } = await inputObject(repository);
      const noWrite = await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "NOT_WRITTEN" });
      expect(noWrite).toMatchObject({ accepted: true, object: { state: "DELETED", accounted: false }, asset: { state: "QUARANTINED" } });
      await repository.closeReservation({ reservationId: reservation.id, token: reservation.token });
      expect((await repository.getUsage()).usedBytes).toBe(initial.usedBytes);
      const late = await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "CONFIRMED" });
      expect(late.accepted).toBe(false);
      const uncertain = await inputObject(repository);
      await repository.finishObject({ objectId: uncertain.ticket.object.id, writeToken: uncertain.ticket.object.writeToken, outcome: "UNKNOWN" });
      await imageFailure(tx, "IMAGE_WRITE_CONFLICT", () => repository.finishObject({ objectId: uncertain.ticket.object.id, writeToken: uncertain.ticket.object.writeToken, outcome: "NOT_WRITTEN" }));
      expect((await repository.finishObject({ objectId: uncertain.ticket.object.id, writeToken: uncertain.ticket.object.writeToken, outcome: "CONFIRMED" })).accepted).toBe(false);
      await repository.closeReservation({ reservationId: uncertain.reservation.id, token: uncertain.reservation.token });
      const after = await repository.getUsage();
      expect(BigInt(after.usedBytes) - BigInt(initial.usedBytes)).toBe(BigInt("10"));
      expect(after.reservedBytes).toBe(initial.reservedBytes);
      const expired = await repository.reserveInput({ ownerId: randomUUID(), intentKey: randomUUID(), byteLength: 1 });
      await tx.imageWriteReservation.update({ where: { id: expired.id }, data: { leaseExpiresAt: new Date(0) } });
      await imageFailure(tx, "IMAGE_RESERVATION_EXPIRED", () => repository.beginObject({
        reservationId: expired.id, token: expired.token, slot: 0, locationId: uncertain.location.id,
        key: `expired/${randomUUID()}.png`, byteLength: 1, mimeType: "image/png", sha256: "a".repeat(64), purpose: "REFERENCE",
      }));
    });
  });

  it("bridges actual showcase, site cover and cross-owner permanent input roots", async () => {
    await rolledBack(async (tx, repository) => {
      const generated = await generatedObject(tx, repository);
      const assetId = generated.ticket.asset.id;
      expect(await tx.imageReference.count({ where: { assetId } })).toBe(0); // Being an output is not an input root.
      for (const showcaseStatus of ["PENDING", "FEATURED", "TAKEDOWN_PENDING"] as const) {
        await tx.generationImage.update({ where: { id: generated.imageId }, data: { showcaseStatus } });
        expect(await tx.imageReference.count({ where: { assetId, kind: "SHOWCASE" } })).toBe(1);
      }
      await tx.generationImage.update({ where: { id: generated.imageId }, data: { showcaseStatus: "PRIVATE" } });
      expect(await tx.imageReference.count({ where: { assetId } })).toBe(0);
      const cover = await tx.loginCoverConfig.create({ data: { scope: randomUUID(), mode: "custom", customUrl: generated.url } });
      expect(await tx.imageReference.count({ where: { assetId, kind: "SITE_COVER" } })).toBe(1);
      await tx.loginCoverConfig.update({ where: { id: cover.id }, data: { mode: "featured" } });
      expect(await tx.imageReference.count({ where: { assetId } })).toBe(0);
      const otherOwner = await user(tx);
      const consumer = await job(tx, otherOwner, { generationType: "IMAGE_TO_IMAGE", sourceImageUrls: [generated.url] });
      expect(await tx.imageReference.findMany({ where: { assetId } })).toMatchObject([{ ownerId: otherOwner, kind: "JOB_INPUT", permanent: true }]);
      await tx.generationJob.update({ where: { id: consumer.id }, data: { sourceImageUrls: [] } });
      await tx.user.delete({ where: { id: otherOwner } });
      expect(await tx.imageReference.count({ where: { assetId, permanent: true } })).toBe(1);
      await imageFailure(tx, "IMAGE_REFERENCE_CONFLICT", () => tx.imageAsset.update({ where: { id: assetId }, data: { state: "DELETING" } }));
      await tx.user.delete({ where: { id: generated.ownerId } });
      expect(await repository.getByToken(generated.ticket.asset.publicToken)).toMatchObject({ asset: { id: assetId, state: "AVAILABLE" }, object: { accounted: true } });
      expect(await tx.imageReference.count({ where: { assetId, permanent: true } })).toBe(1);
    });
  });

  it("keeps replica byte counts, immutable S3 identity and current-object CAS aligned", async () => {
    await rolledBack(async (tx, repository) => {
      const initial = await repository.getUsage();
      const generated = await generatedObject(tx, repository);
      const assetId = generated.ticket.asset.id;
      const location = await repository.registerLocation(imageLocalLocation(randomUUID()));
      const copy = await repository.prepareCopy({ assetId, ownerId: generated.ownerId, intentKey: randomUUID(), byteLength: "10" });
      const replica = await repository.beginObject({
        reservationId: copy.id, token: copy.token, slot: 0, assetId, locationId: location.id, key: `copies/${randomUUID()}.png`,
        byteLength: 10, mimeType: "image/png", sha256: generated.ticket.asset.sha256, purpose: "GENERATED",
      });
      await repository.finishObject({ objectId: replica.object.id, writeToken: replica.object.writeToken, outcome: "CONFIRMED" });
      await repository.closeReservation({ reservationId: copy.id, token: copy.token });
      expect((await repository.getByAssetId(assetId))?.object?.id).toBe(generated.ticket.object.id);
      expect(await repository.activateObject({ assetId, objectId: replica.object.id, expectedObjectId: randomUUID() })).toBe(false);
      expect(await repository.activateObject({ assetId, objectId: replica.object.id, expectedObjectId: generated.ticket.object.id })).toBe(true);
      expect((await repository.resolveUrl(generated.url))?.object?.id).toBe(replica.object.id);
      expect(BigInt((await repository.getUsage()).usedBytes) - BigInt(initial.usedBytes)).toBe(BigInt("20"));
      await imageFailure(tx, "IMAGE_REFERENCE_CONFLICT", () => tx.imageObject.update({ where: { id: replica.object.id }, data: { state: "DELETING" } }));
      await imageFailure(tx, "IMAGE_WRITE_CONFLICT", () => tx.imageObject.update({ where: { id: generated.ticket.object.id }, data: { state: "DELETING" } }));
      const bucket = randomUUID();
      const s3a = await repository.registerLocation(imageS3Location({ endpoint: "https://storage.example.test", region: "auto", bucket }));
      const s3b = await repository.registerLocation(imageS3Location({ endpoint: "https://storage.example.test", region: "region-two", bucket }));
      expect(s3a.id).not.toBe(s3b.id);
      expect(s3a.physicalNamespace).toBe(s3b.physicalNamespace);
      const first = await repository.prepareCopy({ assetId, ownerId: generated.ownerId, intentKey: randomUUID(), byteLength: "10" });
      const duplicate = { slot: 0, assetId, key: "copies/same.png", byteLength: 10, mimeType: "image/png", sha256: generated.ticket.asset.sha256, purpose: "GENERATED" as const };
      const copied = await repository.beginObject({ ...duplicate, reservationId: first.id, token: first.token, locationId: s3a.id });
      await repository.finishObject({ objectId: copied.object.id, writeToken: copied.object.writeToken, outcome: "CONFIRMED" });
      await repository.closeReservation({ reservationId: first.id, token: first.token });
      const second = await repository.prepareCopy({ assetId, ownerId: generated.ownerId, intentKey: randomUUID(), byteLength: "10" });
      await imageFailure(tx, "IMAGE_WRITE_CONFLICT", () => repository.beginObject({ ...duplicate, reservationId: second.id, token: second.token, locationId: s3b.id }));
      await repository.closeReservation({ reservationId: second.id, token: second.token });
      expect(BigInt((await repository.getUsage()).usedBytes) - BigInt(initial.usedBytes)).toBe(BigInt("30"));
    });
  });

  it("allows quota-reserved legacy backfill only for its proven immutable image origin", async () => {
    await rolledBack(async (tx, repository) => {
      const initial = await repository.getUsage();
      const ownerId = await user(tx);
      const originalJob = await job(tx, ownerId, { status: "SUCCEEDED" });
      const imageId = randomUUID();
      const originalUrl = `https://legacy.example.test/${imageId}.png`;
      await tx.generationImage.create({ data: { id: imageId, jobId: originalJob.id, url: originalUrl } });
      const location = await repository.registerLocation(imageLocalLocation(randomUUID()));
      const reservation = await repository.reserveInput({ ownerId, intentKey: `backfill-image:${imageId}`, byteLength: 10 });
      const request = {
        reservationId: reservation.id, token: reservation.token, slot: 0, locationId: location.id,
        key: `backfill/${imageId}.png`, byteLength: 10, mimeType: "image/png", sha256: "c".repeat(64), purpose: "GENERATED" as const, originId: imageId,
      };
      await imageFailure(tx, "IMAGE_INVALID_INPUT", () => repository.beginObject({ ...request, originId: randomUUID() }));
      const ordinary = await repository.reserveInput({ ownerId, intentKey: randomUUID(), byteLength: 10 });
      await imageFailure(tx, "IMAGE_INVALID_INPUT", () => repository.beginObject({ ...request, reservationId: ordinary.id, token: ordinary.token }));
      const foreign = await repository.reserveInput({ ownerId: await user(tx), intentKey: `backfill-image:${imageId}`, byteLength: 10 });
      await imageFailure(tx, "IMAGE_INVALID_INPUT", () => repository.beginObject({ ...request, reservationId: foreign.id, token: foreign.token }));
      await tx.generationImage.update({ where: { id: imageId }, data: { mediaStorage: "S3" } });
      await imageFailure(tx, "IMAGE_INVALID_INPUT", () => repository.beginObject(request));
      await tx.generationImage.update({ where: { id: imageId }, data: { mediaStorage: null } });
      await tx.generationJob.update({ where: { id: originalJob.id }, data: { generationType: "TEXT_TO_VIDEO" } });
      await imageFailure(tx, "IMAGE_INVALID_INPUT", () => repository.beginObject(request));
      await tx.generationJob.update({ where: { id: originalJob.id }, data: { generationType: "TEXT_TO_IMAGE" } });
      const ticket = await repository.beginObject(request);
      expect(ticket.writeGranted).toBe(true);
      expect((await repository.beginObject(request)).writeGranted).toBe(false);
      await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "CONFIRMED" });
      const url = imagePublicUrl("https://images.example.test", ticket.asset.publicToken);
      const update = () => tx.generationImage.updateMany({
        where: { id: imageId, mediaStorage: null, mediaAssetId: null, url: originalUrl },
        data: { mediaStorage: "LOCAL", mediaAssetId: ticket.asset.id, storageKey: ticket.object.key, url },
      });
      // A legacy row changed while the copy was in flight. Its conditional bind
      // fails; the completed physical inventory and quota remain recoverable.
      await tx.generationImage.update({ where: { id: imageId }, data: { url: `https://changed.example.test/${imageId}.png` } });
      expect((await update()).count).toBe(0);
      expect((await repository.getByAssetId(ticket.asset.id))?.object?.accounted).toBe(true);
      await tx.generationImage.update({ where: { id: imageId }, data: { url: originalUrl } });
      expect((await update()).count).toBe(1);
      expect((await update()).count).toBe(0);
      expect((await repository.beginObject(request)).writeGranted).toBe(false);
      expect(BigInt((await repository.getUsage()).usedBytes) - BigInt(initial.usedBytes)).toBe(BigInt(10));
      await repository.closeReservation({ reservationId: reservation.id, token: reservation.token });
    });
  });

  it("serializes two real connections competing for the last quota bytes", async () => {
    const repository = new ImageRepository(prisma);
    const initial = await repository.getUsage();
    const first = await connection();
    const second = await connection();
    const ownerId = randomUUID();
    const intentKey = randomUUID();
    let reservation: ImageReservation | undefined;
    let competing: Promise<{ error?: { code?: string; message?: string } }> | undefined;
    try {
      await prisma.imageStoragePolicy.update({ where: { scope: "images" }, data: { limitBytes: BigInt(initial.usedBytes) + BigInt(initial.reservedBytes) + BigInt("10") } });
      await first.query("BEGIN");
      await second.query("BEGIN");
      const firstPid = (await first.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const secondPid = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const payload = { ownerId, intentKey, kind: "INPUT", slotBytes: ["10"] };
      const claimed = await first.query<{ result: unknown }>("SELECT image_reserve_write($1::jsonb) AS result", [JSON.stringify(payload)]);
      reservation = imageReservationSchema.parse(claimed.rows[0].result);
      competing = second.query("SELECT image_reserve_write($1::jsonb)", [JSON.stringify({ ...payload, intentKey: randomUUID() })])
        .then(() => ({}), (error: { code?: string; message?: string }) => ({ error }));
      await waitForBlock(secondPid, firstPid);
      await first.query("COMMIT");
      expect((await competing).error).toMatchObject({ code: "23514", message: "IMAGE_QUOTA_EXCEEDED" });
      await second.query("ROLLBACK");
      const after = await repository.getUsage();
      expect(after.usedBytes).toBe(initial.usedBytes);
      expect(BigInt(after.reservedBytes) - BigInt(initial.reservedBytes)).toBe(BigInt("10"));
    } finally {
      await first.query("ROLLBACK");
      await competing;
      await second.query("ROLLBACK");
      if (reservation && await prisma.imageWriteReservation.findUnique({ where: { id: reservation.id } })) {
        await repository.closeReservation({ reservationId: reservation.id, token: reservation.token });
      }
      await prisma.imageStoragePolicy.update({ where: { scope: "images" }, data: { limitBytes: BigInt(initial.policy.limitBytes) } });
    }
    expect((await repository.getUsage()).reservedBytes).toBe(initial.reservedBytes);
  });

  it("makes a cleanup state change wait for a concurrently committed reference", async () => {
    const repository = new ImageRepository(prisma);
    const object = await inputObject(repository);
    await repository.finishObject({ objectId: object.ticket.object.id, writeToken: object.ticket.object.writeToken, outcome: "CONFIRMED" });
    await repository.closeReservation({ reservationId: object.reservation.id, token: object.reservation.token });
    const first = await connection();
    const second = await connection();
    const reference = { ownerId: object.ticket.asset.ownerId, kind: "CANVAS_SAVED" as const, referenceKey: `canvas:${randomUUID()}`, assetIds: [object.ticket.asset.id] };
    let deleting: Promise<{ error?: { code?: string; message?: string } }> | undefined;
    try {
      await first.query("BEGIN");
      await second.query("BEGIN");
      const firstPid = (await first.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const secondPid = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await first.query("SELECT image_replace_references($1::jsonb)", [JSON.stringify(reference)]);
      deleting = second.query('UPDATE "ImageAsset" SET state=\'DELETING\' WHERE id=$1::uuid', [object.ticket.asset.id])
        .then(() => ({}), (error: { code?: string; message?: string }) => ({ error }));
      await waitForBlock(secondPid, firstPid);
      await first.query("COMMIT");
      expect((await deleting).error).toMatchObject({ code: "23514", message: "IMAGE_REFERENCE_CONFLICT" });
      await second.query("ROLLBACK");
      expect((await repository.getByAssetId(object.ticket.asset.id))?.asset.state).toBe("AVAILABLE");
    } finally {
      await first.query("ROLLBACK");
      await deleting;
      await second.query("ROLLBACK");
      await repository.replaceReferences({ ...reference, assetIds: [] });
    }
  });
});
