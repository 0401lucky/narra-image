// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Client } from "pg";

import { assertDisposableTestDatabaseUrl } from "../../../../scripts/lib/disposable-test-environment.mjs";
import { CANVAS_CAPABILITY_CONTRACT, canonicalCanvasJson, canvasStorageLocationMaterialV1, type CanvasRunWireV1, type CanvasSceneV1 } from "@/lib/canvas/contracts";
import { probeCanvasSchemaV1 } from "@/lib/canvas/schema-probe";
import type { ConversationGenerationsPage } from "@/lib/conversations/contracts";
import { canvasRunSchema, canvasSceneSchema } from "@/lib/validators";

// Only session identity is a fixture. All loaders, handlers, Prisma queries,
// deletion transactions, and database guards below are the production modules.
const fixtureAuth = vi.hoisted(() => ({ get: vi.fn(), require: vi.fn() }));
vi.mock("@/lib/server/current-user", () => ({
  getCurrentUserRecord: fixtureAuth.get,
  requireCurrentUserRecord: fixtureAuth.require,
}));

function requiredDatabase() {
  if (process.env.CANVAS_CONTRACTS_REQUIRE_DB !== "1") throw new Error("CANVAS_CONTRACTS_REQUIRE_DB=1 is mandatory; this suite must not skip");
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw || raw !== process.env.DATABASE_URL) throw new Error("A runner-owned TEST_DATABASE_URL is mandatory; no environment fallback");
  const url = assertDisposableTestDatabaseUrl(raw);
  if (!/^\/narra_canvas_(full|additive)_[a-f0-9]{16}$/.test(url.pathname) || url.username !== "narra_canvas" || !/^[0-9a-f-]{36}$/.test(process.env.CANVAS_CONTRACTS_OWNER_TOKEN ?? "")) throw new Error("Not a canvas runner database");
  url.search = "";
  return url.toString();
}

const databaseUrl = requiredDatabase();
const connections: Client[] = [];
const db = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 8000, query_timeout: 10000 });
const digest = (value: unknown) => createHash("sha256").update(canonicalCanvasJson(value)).digest("hex");
const parameters = { providerMode: "built_in", channelId: null, model: "gpt-image-2", size: "auto", quality: "auto", outputFormat: "png", outputCompression: null, moderation: "auto", count: 1, negativePrompt: null, seed: null, generationType: "text_to_image" };

async function loadApplication() {
  const [{ db: prisma }, conversations, conversationRoute, conversationContentRoute, works, worksRoute, workRoute, documents, cursors] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/server/conversation-generations"),
    import("@/app/api/me/conversations/[id]/route"),
    import("@/app/api/me/conversations/[id]/generations/route"),
    import("@/lib/server/works"),
    import("@/app/api/me/works/route"),
    import("@/app/api/me/works/[id]/route"),
    import("@/lib/canvas/documents"),
    import("@/lib/canvas/cursors"),
  ]);
  return { prisma, conversations, conversationRoute, conversationContentRoute, works, worksRoute, workRoute, documents, cursors };
}

let app: Awaited<ReturnType<typeof loadApplication>> | undefined;

function application() {
  if (!app) throw new Error("Production modules require the verified disposable database sentinel");
  return app;
}

async function signIn(userId: string) {
  const user = await application().prisma.user.findUniqueOrThrow({ where: { id: userId } });
  fixtureAuth.get.mockResolvedValue(user);
  fixtureAuth.require.mockResolvedValue(user);
}

function jobFixture(userId: string, overrides: Partial<Prisma.GenerationJobCreateManyInput> = {}): Prisma.GenerationJobCreateManyInput & { id: string } {
  return {
    id: randomUUID(), userId, providerMode: "BUILT_IN", model: "gpt-image-2", prompt: "synthetic retained job", size: "auto", count: 1,
    creditsSpent: 5, ...overrides,
  };
}

function readConversation(id: string, query = "") {
  return application().conversationContentRoute.GET(
    new Request(`https://studio.invalid/api/me/conversations/${encodeURIComponent(id)}/generations${query}`),
    { params: Promise.resolve({ id }) },
  );
}

async function conversationPage(response: Response): Promise<ConversationGenerationsPage> {
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return (await response.json() as { data: ConversationGenerationsPage }).data;
}

function removeConversation(id: string) {
  return application().conversationRoute.DELETE(
    new Request(`https://studio.invalid/api/me/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  );
}

function removeWork(id: string) {
  return application().workRoute.DELETE(
    new Request(`https://studio.invalid/api/me/works/${encodeURIComponent(id)}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  );
}

async function connection() {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 8000, query_timeout: 10000 });
  await client.connect();
  connections.push(client);
  return client;
}

async function waitForBlock(waiter: number, blocker: number) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if ((await db.query('SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked', [waiter, blocker])).rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Expected a real PostgreSQL row-lock wait");
}

async function owner(client = db) {
  const id = randomUUID();
  await client.query('INSERT INTO "User" (id,email,credits,"updatedAt") VALUES ($1,$2,100,CURRENT_TIMESTAMP)', [id, `${id}@example.test`]);
  return id;
}

async function canvas(user: string, client = db) {
  const id = randomUUID();
  await client.query('INSERT INTO "Canvas" (id,"ownerId","userId",title) VALUES ($1,$2::text,$2::text,\'Canvas\')', [id, user]);
  return id;
}

function storageLocation(user: string) {
  return `s3-v1:${createHash("sha256").update(canvasStorageLocationMaterialV1({ endpoint: "https://storage.invalid", region: "auto", bucket: user })).digest("hex")}`;
}

async function asset(user: string, ready = true, client = db) {
  const id = randomUUID();
  const uploadId = randomUUID();
  const token = randomUUID();
  await client.query(`INSERT INTO "CanvasImportAsset" (id,"ownerId","userId","uploadId",sha256,"byteLength","mimeType","storageLocation","storageEndpoint","storageRegion","storageBucket","storageKey","uploadToken","uploadExpiresAt")
    VALUES ($1,$2::text,$2::text,$3,$4,1024,'image/png',$5,'https://storage.invalid','auto',$2::text,$1,$6,clock_timestamp())`, [id, user, uploadId, "a".repeat(64), storageLocation(user), token]);
  if (ready) await client.query(`UPDATE "CanvasImportAsset" SET state='READY',"putOutcome"='CONFIRMED' WHERE id=$1 AND "uploadToken"=$2`, [id, token]);
  return { id, uploadId, token, location: storageLocation(user), key: id };
}

function scene(assetIds: string[] = []): CanvasSceneV1 {
  return canvasSceneSchema.parse({ schemaVersion: 1, nodes: [
    { id: randomUUID(), kind: "prompt", position: { x: -42, y: 11 }, text: "" },
    ...assetIds.map((assetId) => ({ id: randomUUID(), kind: "reference", position: { x: 0, y: 0 }, source: { kind: "imported", assetId } })),
  ], edges: [], viewport: { x: -10, y: 0, zoom: 1 }, runBindings: [] });
}

async function save(user: string, id: string, value: CanvasSceneV1, revision = 0, saveId: string = randomUUID(), client = db) {
  return (await client.query('SELECT * FROM canvas_save_snapshot($1,$2,$3,$4,$5::jsonb,$6)', [user, id, revision, saveId, JSON.stringify(value), digest(value)])).rows[0];
}

function wire(canvasId: string, assetId?: string, nodeId: string = randomUUID(), runId: string = randomUUID()): CanvasRunWireV1 {
  return canvasRunSchema.parse({ canvasId, nodeId, runId, input: { prompt: { sourceNodeId: randomUUID(), text: "frozen prompt" }, references: assetId ? [{ sourceNodeId: randomUUID(), ordinal: 1, kind: "imported", assetId }] : [] }, parameters: { ...parameters, generationType: assetId ? "image_to_image" : "text_to_image" } });
}

async function reserve(user: string, value: CanvasRunWireV1, client = db) {
  return (await client.query('SELECT * FROM canvas_reserve_run($1,$2,$3,$4,$5,$6::jsonb)', [user, value.canvasId, value.nodeId, value.runId, digest(value), JSON.stringify(value)])).rows[0];
}

async function commit(user: string, value: CanvasRunWireV1, token: string, client = db, jobId = randomUUID()) {
  await client.query("BEGIN");
  try {
    await client.query(`INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"creditsSpent","updatedAt") VALUES ($1,$2,'BUILT_IN','gpt-image-2','frozen prompt','auto',1,5,CURRENT_TIMESTAMP)`, [jobId, user]);
    await client.query('UPDATE "User" SET credits=credits-5 WHERE id=$1 AND credits>=5', [user]);
    await client.query('SELECT canvas_commit_run($1,$2,$3,$4)', [user, value.runId, token, jobId]);
    await client.query("COMMIT");
    return jobId;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

// Fixture-only clock seeding in the sentinel-verified disposable DB. Production
// functions still use clock_timestamp(), their real guards, and real row locks.
async function fixtureSql(sql: string, values: unknown[] = []) {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL session_replication_role = replica");
    await db.query(sql, values);
    await db.query("SET LOCAL session_replication_role = origin");
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}

async function age(id: string, seconds = 604801) {
  await fixtureSql(`UPDATE "CanvasImportAsset" SET "uploadExpiresAt"=clock_timestamp()-interval '10 days',"preparationExpiresAt"=NULL,"detachedAt"=clock_timestamp()-make_interval(secs=>$2::integer),"nextDeleteAt"=NULL,"deleteExpiresAt"=CASE WHEN "deleteToken" IS NULL THEN NULL ELSE clock_timestamp()-interval '1 second' END WHERE id=$1`, [id, seconds]);
}

async function claim(location: string, client = db) {
  const token = randomUUID();
  await client.query('UPDATE "CanvasGcLease" SET token=NULL,"expiresAt"=NULL WHERE id=\'canvas-imports\'');
  expect((await client.query('SELECT canvas_acquire_gc_lease($1) AS ok', [token])).rows[0].ok).toBe(true);
  return (await client.query('SELECT * FROM canvas_claim_imports($1,$2,20)', [token, location])).rows;
}

describe("canvas v1 disposable PostgreSQL (not ordinary Vitest)", () => {
  beforeAll(async () => {
    await db.connect();
    const rows = (await db.query('SELECT token::text FROM "_canvas_contracts_owner"')).rows;
    if (rows.length !== 1 || rows[0].token !== process.env.CANVAS_CONTRACTS_OWNER_TOKEN) throw new Error("Disposable database owner sentinel mismatch; refusing mutations");
    // Import the real application client only after the runner URL and live
    // owner sentinel have both been checked; never replace it with a mock DB.
    app = await loadApplication();
    const prismaSentinel = await app.prisma.$queryRaw<Array<{ token: string }>>`SELECT token::text FROM "_canvas_contracts_owner"`;
    expect(prismaSentinel).toEqual(rows);
  });
  afterAll(async () => {
    await app?.prisma.$disconnect();
    await Promise.all(connections.map((client) => client.end()));
    await db.end();
  });

  it("accepts complete and previous-history-plus-additive schemas without upgrading legacy jobs", async () => {
    const report = await probeCanvasSchemaV1(async (sql) => (await db.query(sql)).rows);
    expect(report, JSON.stringify(report)).toMatchObject({ version: 1, ready: true, issues: [] });
    if (process.env.CANVAS_CONTRACTS_SCENARIO === "additive") {
      const legacy = (await db.query('SELECT j."contractVersion",j."handoffState",i.url FROM "GenerationJob" j JOIN "GenerationImage" i ON i."jobId"=j.id WHERE j.id=\'canvas_legacy_job\'')).rows;
      expect(legacy).toEqual([{ contractVersion: 0, handoffState: null, url: "https://legacy.invalid/retained.png" }]);
    }
  });

  it.each([
    'ALTER TABLE "CanvasSavedAssetUse" DISABLE TRIGGER "CanvasSavedAssetUse_ready_guard"',
    'ALTER TABLE "CanvasRun" DROP CONSTRAINT "CanvasRun_state_check"',
    'DROP INDEX "CanvasImportAsset_gc_idx"',
    `ALTER TABLE "CanvasRun" ALTER COLUMN state SET DEFAULT 'COMMITTED'`,
    'CREATE OR REPLACE FUNCTION canvas_lock_assets(p_owner TEXT,p_ids TEXT[],p_require_ready BOOLEAN DEFAULT true) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$',
    `ALTER TABLE "CanvasGcLease" DROP CONSTRAINT "CanvasGcLease_singleton_check";
      ALTER TABLE "CanvasGcLease" ADD CONSTRAINT "CanvasGcLease_singleton_check" CHECK (id = 'canvas-imports' AND (token IS NULL AND "expiresAt" IS NULL) OR (token IS NOT NULL AND "expiresAt" IS NOT NULL))`,
  ])("does not advertise readiness with drifted guards: %s", async (sql) => {
    await db.query("BEGIN");
    try {
      await db.query(sql);
      expect((await probeCanvasSchemaV1(async (query) => (await db.query(query)).rows)).ready).toBe(false);
    } finally { await db.query("ROLLBACK"); }
  });

  it.each(["default", "body-carriage-return"])("detects function %s drift even with the same argument types", async (change) => {
    await db.query("BEGIN");
    try {
      const original = (await db.query("SELECT pg_get_functiondef('canvas_lock_assets(text,text[],boolean)'::regprocedure) AS definition")).rows[0].definition as string;
      const altered = change === "default" ? original.replace(/\bDEFAULT true\b/, "DEFAULT false") : original.replace("CANVAS_INVALID_INPUT", "CANVAS_INVALID_INPUT\r");
      expect(altered).not.toBe(original);
      await db.query(altered);
      expect((await probeCanvasSchemaV1(async (query) => (await db.query(query)).rows)).issues).toContainEqual({ kind: "function", name: "canvas_lock_assets", reason: "mismatch" });
    } finally { await db.query("ROLLBACK"); }
  });

  it("uses full database timestamps for upload/preparation leases and fixed elapsed-time grace across DST", async () => {
    const user = await owner(); const id = await canvas(user); const original = await asset(user, false);
    const reservation = await reserve(user, wire(id));
    expect((await db.query('SELECT EXTRACT(EPOCH FROM ("uploadExpiresAt"-"createdAt"))::int AS seconds FROM "CanvasImportAsset" WHERE id=$1', [original.id])).rows[0].seconds).toBe(120);
    expect((await db.query('SELECT EXTRACT(EPOCH FROM ("preparationExpiresAt"-"createdAt"))::int AS seconds FROM "CanvasRun" WHERE id=$1', [reservation.id])).rows[0].seconds).toBe(120);
    const client = await connection();
    await client.query("SET TIME ZONE 'America/New_York'");
    const duration = (await client.query(`SELECT
      EXTRACT(EPOCH FROM ((TIMESTAMPTZ '2026-03-07 12:00:00' + interval '604800 seconds') - TIMESTAMPTZ '2026-03-07 12:00:00'))::int AS elapsed,
      EXTRACT(EPOCH FROM ((TIMESTAMPTZ '2026-03-07 12:00:00' + interval '7 days') - TIMESTAMPTZ '2026-03-07 12:00:00'))::int AS calendar`)).rows[0];
    expect(duration).toEqual({ elapsed: 604800, calendar: 601200 });
  });

  it("atomically saves every disconnected original and distinguishes revision from its save receipt", async () => {
    const user = await owner(); const id = await canvas(user); const original = await asset(user); const value = scene([original.id]); const saveId = randomUUID();
    expect((await db.query('SELECT scene,"lastSavedAt",revision FROM "Canvas" WHERE id=$1', [id])).rows[0]).toEqual({ scene: null, lastSavedAt: null, revision: 0 });
    expect(await save(user, id, value, 0, saveId)).toMatchObject({ acknowledgedRevision: 1, currentRevision: 1, replayed: false });
    expect((await db.query('SELECT count(*)::int AS count FROM "CanvasSavedAssetUse" WHERE "canvasId"=$1', [id])).rows[0].count).toBe(1);
    await db.query('UPDATE "Canvas" SET title=\'Renamed\',revision=revision+1 WHERE id=$1', [id]);
    expect(await save(user, id, value, 0, saveId)).toMatchObject({ acknowledgedRevision: 1, currentRevision: 2, replayed: true });
    await expect(save(user, id, scene(), 0, saveId)).rejects.toMatchObject({ message: "CANVAS_SAVE_CONFLICT" });
    await expect(save(user, id, value, 0)).rejects.toMatchObject({ message: "CANVAS_REVISION_CONFLICT" });
    expect((await db.query('SELECT "detachedAt" FROM "CanvasImportAsset" WHERE id=$1', [original.id])).rows[0].detachedAt).toBeNull();
  });

  it("serializes concurrent saves and fences delayed writes behind tombstones", async () => {
    const user = await owner(); const id = await canvas(user); const a = await connection(); const b = await connection();
    const results = await Promise.allSettled([save(user, id, scene(), 0, randomUUID(), a), save(user, id, scene(), 0, randomUUID(), b)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(db.query('SELECT canvas_delete_document($1,$2,0)', [user, id])).rejects.toMatchObject({ message: "CANVAS_REVISION_CONFLICT" });
    await db.query('SELECT canvas_delete_document($1,$2,1)', [user, id]);
    await expect(save(user, id, scene(), 2)).rejects.toMatchObject({ message: "CANVAS_DELETED" });
    await expect(db.query('UPDATE "Canvas" SET "deletedAt"=NULL,revision=revision+1 WHERE id=$1', [id])).rejects.toMatchObject({ message: "CANVAS_DELETED" });
    await expect(db.query('DELETE FROM "Canvas" WHERE id=$1', [id])).rejects.toMatchObject({ message: "CANVAS_INVENTORY_IMMUTABLE" });
  });

  it("prevents owner mismatches and fabricated accepted bindings", async () => {
    const user = await owner(); const other = await owner(); const id = await canvas(user); const foreign = await asset(other);
    await expect(save(user, id, scene([foreign.id]))).rejects.toMatchObject({ message: "CANVAS_INPUT_UNAVAILABLE" });
    await expect(save(other, id, scene())).rejects.toMatchObject({ message: "CANVAS_NOT_FOUND" });
    const nodeId = randomUUID();
    const value = canvasSceneSchema.parse({ ...scene(), nodes: [{ id: nodeId, kind: "generation", position: { x: 0, y: 0 }, parameters: Object.fromEntries(Object.entries(parameters).filter(([key]) => key !== "generationType")) }], runBindings: [{ nodeId, runId: randomUUID(), jobId: "fabricated-job", outputsHandled: false }] });
    await expect(save(user, id, value)).rejects.toMatchObject({ message: "CANVAS_ORIGIN_MISMATCH" });
  });

  it("serializes owner live-shell and active-upload quotas", async () => {
    const user = await owner(); const a = await connection(); const b = await connection();
    await db.query('INSERT INTO "Canvas" (id,"ownerId","userId",title) SELECT gen_random_uuid(),$1::text,$1::text,\'quota\' FROM generate_series(1,99)', [user]);
    const shells = await Promise.allSettled([canvas(user, a), canvas(user, b)]);
    expect(shells.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await asset(user, false); await asset(user, false);
    const uploads = await Promise.allSettled([asset(user, false, a), asset(user, false, b)]);
    expect(uploads.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it.each([[128, 8388608], [1000, 1]])("keeps uncertain physical byte/count reservations in quota (%i x %i)", async (count, bytes) => {
    const user = await owner();
    await fixtureSql(`INSERT INTO "CanvasImportAsset" (id,"ownerId","userId","uploadId",sha256,"byteLength","mimeType","storageLocation","storageEndpoint","storageRegion","storageBucket","storageKey",state,"uploadToken","uploadExpiresAt","detachedAt","putOutcome")
      SELECT gen_random_uuid()::text,$1::text,$1::text,gen_random_uuid(),repeat('a',64),$2,'image/png',$3,'https://storage.invalid','auto',$1::text,gen_random_uuid()::text,'QUARANTINED',gen_random_uuid(),clock_timestamp()-interval '1 day',clock_timestamp(),'UNKNOWN' FROM generate_series(1,$4::int)`, [user, bytes, storageLocation(user), count]);
    await expect(asset(user)).rejects.toMatchObject({ message: "CANVAS_QUOTA_EXCEEDED" });
  });

  it("uses exact seven-day rootless grace and reattachment resets detach", async () => {
    const user = await owner(); const id = await canvas(user); const original = await asset(user);
    await age(original.id, 604799);
    expect(await claim(original.location)).toEqual([]);
    await save(user, id, scene([original.id]));
    await age(original.id);
    expect(await claim(original.location)).toEqual([]);
    await save(user, id, scene(), 1);
    expect(await claim(original.location)).toEqual([]);
    await age(original.id);
    expect((await claim(original.location)).map((row) => row.id)).toEqual([original.id]);
  });

  it("save wins the input lock or GC wins it, never both", async () => {
    const user = await owner(); const id = await canvas(user); const first = await asset(user); const a = await connection(); const b = await connection();
    await age(first.id);
    await a.query("BEGIN");
    try {
      await save(user, id, scene([first.id]), 0, randomUUID(), a);
      expect(await claim(first.location, b)).toEqual([]);
      await a.query("COMMIT");
    } catch (error) { await a.query("ROLLBACK"); throw error; }
    const second = await asset(user); await age(second.id);
    await a.query("BEGIN");
    try {
      const claimed = await claim(second.location, a);
      expect(claimed.map((row) => row.id)).toEqual([second.id]);
      const pendingSave = save(user, id, scene([second.id]), 1, randomUUID(), b).then(() => null, (error: unknown) => error);
      await a.query("COMMIT");
      expect(await pendingSave).toMatchObject({ message: "CANVAS_INPUT_UNAVAILABLE" });
    } catch (error) { await a.query("ROLLBACK"); throw error; }
  });

  it("reserves one run/key and one active node without creating a billable job", async () => {
    const user = await owner(); const id = await canvas(user); const value = wire(id); const a = await connection(); const b = await connection();
    const reservations = await Promise.all([reserve(user, value, a), reserve(user, value, b)]);
    expect(new Set(reservations.map((row) => row.id)).size).toBe(1);
    expect(reservations.filter((row) => !row.replayed)).toHaveLength(1);
    await expect(reserve(user, wire(id, undefined, value.nodeId))).rejects.toMatchObject({ message: "CANVAS_NODE_BUSY" });
    await expect(reserve(user, { ...value, input: { ...value.input, prompt: { ...value.input.prompt, text: "changed prompt" } } })).rejects.toMatchObject({ message: "CANVAS_RUN_CONFLICT" });
    expect((await db.query('SELECT count(*)::int AS count FROM "GenerationJob" WHERE "userId"=$1', [user])).rows[0].count).toBe(0);
    // The same external UUID is legal under a different owner; internal IDs differ.
    const other = await owner(); const otherCanvas = await canvas(other);
    expect((await reserve(other, wire(otherCanvas, undefined, randomUUID(), value.runId))).id).not.toBe(reservations[0].id);
  });

  it("serializes two different run UUIDs at the same node admission scope", async () => {
    const user = await owner(); const id = await canvas(user); const nodeId = randomUUID(); const a = await connection(); const b = await connection();
    const attempts = await Promise.allSettled([reserve(user, wire(id, undefined, nodeId), a), reserve(user, wire(id, undefined, nodeId), b)]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((result) => result.status === "rejected")).toMatchObject({ reason: { message: "CANVAS_NODE_BUSY" } });
    expect((await db.query('SELECT count(*)::int AS count FROM "CanvasRun" WHERE "canvasId"=$1 AND "nodeId"=$2', [id, nodeId])).rows[0].count).toBe(1);
    expect((await db.query('SELECT credits FROM "User" WHERE id=$1', [user])).rows[0].credits).toBe(100);
  });

  it.each(["PENDING", "PROCESSING"])("uses canonical %s job status for node admission, not the UI pending projection", async (status) => {
    const user = await owner(); const id = await canvas(user); const value = wire(id); const pending = await reserve(user, value);
    const jobId = await commit(user, value, pending.preparationToken);
    await db.query('UPDATE "GenerationJob" SET status=$2::"GenerationStatus" WHERE id=$1', [jobId, status]);
    expect(await reserve(user, value)).toMatchObject({ state: "COMMITTED", originalJobId: jobId, replayed: true });
    await expect(reserve(user, wire(id, undefined, value.nodeId))).rejects.toMatchObject({ message: "CANVAS_NODE_BUSY" });
    await db.query('UPDATE "GenerationJob" SET status=\'SUCCEEDED\' WHERE id=$1', [jobId]);
    expect(await reserve(user, wire(id, undefined, value.nodeId))).toMatchObject({ state: "PREPARING", replayed: false });
    expect((await db.query('SELECT credits FROM "User" WHERE id=$1', [user])).rows[0].credits).toBe(95);
  });

  it("commits job/root/charge in one transaction and replays after organization/job/account deletion", async () => {
    const user = await owner(); const id = await canvas(user); const original = await asset(user); const value = wire(id, original.id); const pending = await reserve(user, value);
    const jobId = await commit(user, value, pending.preparationToken);
    await expect(commit(user, value, pending.preparationToken)).rejects.toThrow();
    expect((await db.query('SELECT credits FROM "User" WHERE id=$1', [user])).rows[0].credits).toBe(95);
    expect((await db.query('SELECT count(*)::int AS count FROM "GenerationJob" WHERE "userId"=$1', [user])).rows[0].count).toBe(1);
    await db.query('SELECT canvas_delete_document($1,$2,0)', [user, id]);
    for (const status of ["PENDING", "SUCCEEDED", "FAILED"]) {
      await db.query('UPDATE "GenerationJob" SET status=$2::"GenerationStatus" WHERE id=$1', [jobId, status]);
      await age(original.id);
      expect(await claim(original.location)).toEqual([]);
    }
    await db.query('DELETE FROM "GenerationJob" WHERE id=$1', [jobId]);
    expect(await reserve(user, value)).toMatchObject({ state: "COMMITTED", originalJobId: jobId, liveJobId: null, replayed: true });
    await db.query('DELETE FROM "User" WHERE id=$1', [user]);
    expect((await db.query('SELECT "ownerId","userId","storageKey" FROM "CanvasImportAsset" WHERE id=$1', [original.id])).rows[0]).toEqual({ ownerId: user, userId: null, storageKey: original.key });
    expect((await db.query('SELECT "originalJobId","liveJobId" FROM "CanvasJobAssetUse" WHERE "assetId"=$1', [original.id])).rows).toEqual([{ originalJobId: jobId, liveJobId: null }]);
    expect(await claim(original.location)).toEqual([]);
    await expect(db.query('DELETE FROM "CanvasJobAssetUse" WHERE "assetId"=$1', [original.id])).rejects.toMatchObject({ message: "CANVAS_INVENTORY_IMMUTABLE" });
  });

  it("preparation protects imports, and expired takeover fences the old token", async () => {
    const user = await owner(); const id = await canvas(user); const original = await asset(user); const value = wire(id, original.id);
    await age(original.id);
    const first = await reserve(user, value);
    expect(await claim(original.location)).toEqual([]);
    await fixtureSql('UPDATE "CanvasRun" SET "preparationExpiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1', [first.id]);
    const takeover = await reserve(user, value);
    expect(takeover.preparationToken).not.toBe(first.preparationToken);
    await expect(commit(user, value, first.preparationToken)).rejects.toMatchObject({ message: "CANVAS_LEASE_LOST" });
    await commit(user, value, takeover.preparationToken);
    expect((await db.query('SELECT count(*)::int AS count FROM "CanvasJobAssetUse" WHERE "runId"=$1', [takeover.id])).rows[0].count).toBe(1);
  });

  it("rechecks preparation expiry after an actual input-lock wait and rolls back job plus debit", async () => {
    const user = await owner(); const id = await canvas(user); const original = await asset(user); const value = wire(id, original.id); const pending = await reserve(user, value);
    const a = await connection(); const b = await connection();
    const blocker = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const waiter = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    await a.query("BEGIN");
    const failure = await (async () => {
      let committing: Promise<unknown> | undefined;
      try {
        await a.query('SELECT id FROM "CanvasImportAsset" WHERE id=$1 FOR UPDATE', [original.id]);
        await fixtureSql('UPDATE "CanvasRun" SET "preparationExpiresAt"=clock_timestamp()+interval \'2 seconds\' WHERE id=$1', [pending.id]);
        committing = commit(user, value, pending.preparationToken, b).then(() => null, (error: unknown) => error);
        await waitForBlock(waiter, blocker);
        await db.query('SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM ("preparationExpiresAt"-clock_timestamp())))::double precision + 0.05) FROM "CanvasRun" WHERE id=$1', [pending.id]);
        await a.query("COMMIT");
        return await committing;
      } finally {
        await a.query("ROLLBACK");
        await committing;
      }
    })();
    expect(failure).toMatchObject({ message: "CANVAS_LEASE_LOST" });
    expect((await db.query('SELECT count(*)::int AS count FROM "GenerationJob" WHERE "userId"=$1', [user])).rows[0].count).toBe(0);
    expect((await db.query('SELECT credits FROM "User" WHERE id=$1', [user])).rows[0].credits).toBe(100);
    expect((await db.query('SELECT count(*)::int AS count FROM "CanvasJobAssetUse" WHERE "runId"=$1', [pending.id])).rows[0].count).toBe(0);
  });

  it("forbids raw committed runs without their exact roots at transaction end", async () => {
    const user = await owner(); const id = await canvas(user); const original = await asset(user); const value = wire(id, original.id); const pending = await reserve(user, value);
    const jobId = randomUUID();
    await db.query("BEGIN");
    try {
      await db.query(`INSERT INTO "GenerationJob" (id,"userId","providerMode",model,prompt,size,count,"updatedAt") VALUES ($1,$2,'BUILT_IN','gpt-image-2','prompt','auto',1,CURRENT_TIMESTAMP)`, [jobId, user]);
      await db.query('UPDATE "CanvasRun" SET state=\'COMMITTED\',"originalJobId"=$2::text,"liveJobId"=$2::text WHERE id=$1', [pending.id, jobId]);
      await expect(db.query("COMMIT")).rejects.toMatchObject({ message: "CANVAS_ORIGIN_MISMATCH" });
    } finally { await db.query("ROLLBACK"); }
    expect((await reserve(user, value)).state).toBe("PREPARING");
  });

  it("blocks stale uploads, key reuse, versioned readiness and nullable JSON enums", async () => {
    const user = await owner(); const original = await asset(user, false);
    await age(original.id);
    await expect(db.query('UPDATE "CanvasImportAsset" SET state=\'READY\',"putOutcome"=\'CONFIRMED\' WHERE id=$1', [original.id])).rejects.toMatchObject({ message: "CANVAS_LEASE_LOST" });
    await expect(db.query('UPDATE "CanvasImportAsset" SET "storageKey"=\'replacement\' WHERE id=$1', [original.id])).rejects.toMatchObject({ message: "CANVAS_INVENTORY_IMMUTABLE" });
    await expect(db.query('DELETE FROM "CanvasImportAsset" WHERE id=$1', [original.id])).rejects.toMatchObject({ message: "CANVAS_INVENTORY_IMMUTABLE" });
    const versioned = await asset(user, false);
    await db.query('UPDATE "CanvasImportAsset" SET state=\'QUARANTINED\',"putOutcome"=\'CONFIRMED\',"storageVersionId"=\'version-1\' WHERE id=$1', [versioned.id]);
    await age(versioned.id);
    expect((await claim(versioned.location)).some((row) => row.id === versioned.id)).toBe(false);
    for (const field of ["providerMode", "quality", "outputFormat", "moderation"]) {
      const invalid = { ...wire(await canvas(user)), parameters: { ...parameters, [field]: null } };
      await expect(db.query('SELECT canvas_assert_run_snapshot($1::jsonb)', [JSON.stringify(invalid)])).rejects.toMatchObject({ message: "CANVAS_INVALID_INPUT" });
    }
    await expect(db.query('SELECT * FROM canvas_claim_imports($1,$2,NULL)', [randomUUID(), original.location])).rejects.toMatchObject({ message: "CANVAS_LIMIT_EXCEEDED" });
  });

  it("retains failed deletes with backoff, verifies leases after blocking, and keeps the inventory", async () => {
    const user = await owner(); const original = await asset(user); await age(original.id);
    const [first] = await claim(original.location);
    expect((await db.query('SELECT canvas_finish_asset_delete($1,$2,\'FAILED\',\'CANVAS_STORAGE_UNAVAILABLE\') AS ok', [original.id, first.deleteToken])).rows[0].ok).toBe(true);
    expect(await claim(original.location)).toEqual([]);
    await age(original.id);
    const [retry] = await claim(original.location);
    expect(retry.deleteToken).not.toBe(first.deleteToken);
    expect((await db.query('SELECT canvas_finish_asset_delete($1,$2,\'DELETED\') AS ok', [original.id, first.deleteToken])).rows[0].ok).toBe(false);
    await fixtureSql('UPDATE "CanvasImportAsset" SET "deleteExpiresAt"=clock_timestamp()+interval \'200 milliseconds\' WHERE id=$1', [original.id]);
    const a = await connection(); const b = await connection();
    await a.query("BEGIN");
    try {
      await a.query('SELECT id FROM "CanvasImportAsset" WHERE id=$1 FOR UPDATE', [original.id]);
      const finish = b.query('SELECT canvas_finish_asset_delete($1,$2,\'DELETED\') AS ok', [original.id, retry.deleteToken]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await a.query("COMMIT");
      expect((await finish).rows[0].ok).toBe(false);
    } catch (error) { await a.query("ROLLBACK"); throw error; }
    await age(original.id); const [last] = await claim(original.location);
    await db.query('SELECT canvas_finish_asset_delete($1,$2,\'DELETED\')', [original.id, last.deleteToken]);
    expect((await db.query('SELECT state,"physicalBytesAccounted" FROM "CanvasImportAsset" WHERE id=$1', [original.id])).rows[0]).toEqual({ state: "DELETED", physicalBytesAccounted: false });
  });

  it("fences independent sweep owners before and after singleton lease takeover", async () => {
    const user = await owner(); const original = await asset(user); await age(original.id);
    const first = randomUUID(); const next = randomUUID(); const a = await connection(); const b = await connection();
    await db.query('UPDATE "CanvasGcLease" SET token=NULL,"expiresAt"=NULL WHERE id=\'canvas-imports\'');
    expect((await a.query('SELECT canvas_acquire_gc_lease($1) AS ok', [first])).rows[0].ok).toBe(true);
    expect((await b.query('SELECT canvas_acquire_gc_lease($1) AS ok', [next])).rows[0].ok).toBe(false);
    await expect(b.query('SELECT * FROM canvas_claim_imports($1,$2,20)', [next, original.location])).rejects.toMatchObject({ message: "CANVAS_LEASE_LOST" });
    await db.query('UPDATE "CanvasGcLease" SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=\'canvas-imports\'');
    expect((await b.query('SELECT canvas_acquire_gc_lease($1) AS ok', [next])).rows[0].ok).toBe(true);
    await expect(a.query('SELECT * FROM canvas_claim_imports($1,$2,20)', [first, original.location])).rejects.toMatchObject({ message: "CANVAS_LEASE_LOST" });
    expect((await b.query('SELECT * FROM canvas_claim_imports($1,$2,20)', [next, original.location])).rows.map((row) => row.id)).toEqual([original.id]);
  });

  it.each(CANVAS_CAPABILITY_CONTRACT.latePutVersionReceipt.states)("retains a late version receipt in %s without reopening or falsely reclaiming the object", async (state) => {
    const user = await owner(); const original = await asset(user, false);
    await db.query('UPDATE "CanvasImportAsset" SET state=\'QUARANTINED\',"putOutcome"=\'UNKNOWN\' WHERE id=$1', [original.id]);
    await age(original.id); const [claimed] = await claim(original.location);
    if (state === "DELETED") expect((await db.query('SELECT canvas_finish_asset_delete($1,$2,\'MISSING\') AS ok', [original.id, claimed.deleteToken])).rows[0].ok).toBe(true);
    const before = (await db.query('SELECT * FROM "CanvasImportAsset" WHERE id=$1', [original.id])).rows[0];
    const receipt = '"storageVersionId"=\'late-version-1\',"physicalBytesAccounted"=true,"needsReconciliation"=true,"lastStorageErrorCode"=\'CANVAS_STORAGE_CAPABILITY_INVALID\'';
    for (const forbidden of ['state=\'READY\'', '"deleteToken"=gen_random_uuid()', '"putOutcome"=\'CONFIRMED\'']) {
      await expect(db.query(`UPDATE "CanvasImportAsset" SET ${receipt},${forbidden} WHERE id=$1`, [original.id])).rejects.toMatchObject({ message: "CANVAS_INVENTORY_IMMUTABLE" });
    }
    await db.query(`UPDATE "CanvasImportAsset" SET ${receipt} WHERE id=$1 AND "ownerId"=$2 AND "uploadToken"=$3 AND "storageVersionId" IS NULL AND "putOutcome"='UNKNOWN'`, [original.id, user, original.token]);
    const after = (await db.query('SELECT * FROM "CanvasImportAsset" WHERE id=$1', [original.id])).rows[0];
    expect(after).toEqual({ ...before, storageVersionId: "late-version-1", physicalBytesAccounted: true, needsReconciliation: true, lastStorageErrorCode: "CANVAS_STORAGE_CAPABILITY_INVALID", updatedAt: after.updatedAt });
    expect(after.state).toBe(state);
    expect((await db.query('SELECT canvas_finish_asset_delete($1,$2,\'DELETED\') AS ok', [original.id, claimed.deleteToken])).rows[0].ok).toBe(false);
    if (state === "DELETING") await expect(db.query('UPDATE "CanvasImportAsset" SET state=\'DELETED\',"deleteOutcome"=\'DELETED\' WHERE id=$1', [original.id])).rejects.toMatchObject({ message: "CANVAS_STORAGE_CAPABILITY_INVALID" });
    await expect(db.query('UPDATE "CanvasImportAsset" SET "storageVersionId"=\'different-version\' WHERE id=$1', [original.id])).rejects.toMatchObject({ message: "CANVAS_INVENTORY_IMMUTABLE" });
    await expect(db.query('UPDATE "CanvasImportAsset" SET state=\'READY\',"putOutcome"=\'CONFIRMED\' WHERE id=$1', [original.id])).rejects.toMatchObject({ message: "CANVAS_INVENTORY_IMMUTABLE" });
    await age(original.id);
    expect(await claim(original.location)).toEqual([]);
    expect((await db.query('SELECT "storageKey","storageVersionId","physicalBytesAccounted" FROM "CanvasImportAsset" WHERE id=$1', [original.id])).rows[0]).toEqual({ storageKey: original.key, storageVersionId: "late-version-1", physicalBytesAccounted: true });
  });

  it("reconciles an ambiguous late PUT by exact registered key, never legacy/generated keys", async () => {
    const user = await owner(); const original = await asset(user, false);
    const fakeStorage = new Set(["legacy/key", "generated/key"]);
    const deletedKeys: string[] = [];
    const remoteDelete = (key: string) => { deletedKeys.push(key); return fakeStorage.delete(key) ? "DELETED" : "MISSING"; };
    await db.query('UPDATE "CanvasImportAsset" SET state=\'QUARANTINED\',"putOutcome"=\'UNKNOWN\' WHERE id=$1', [original.id]);
    await age(original.id); const [first] = await claim(original.location);
    await db.query('SELECT canvas_finish_asset_delete($1,$2,$3::"CanvasDeleteOutcome")', [original.id, first.deleteToken, remoteDelete(first.storageKey)]);
    fakeStorage.add(original.key); // the original in-flight PUT completes after DELETE
    expect((await db.query('SELECT state,"needsReconciliation","physicalBytesAccounted" FROM "CanvasImportAsset" WHERE id=$1', [original.id])).rows[0]).toEqual({ state: "DELETED", needsReconciliation: true, physicalBytesAccounted: true });
    await age(original.id); const [retry] = await claim(original.location);
    await db.query('SELECT canvas_finish_asset_delete($1,$2,$3::"CanvasDeleteOutcome")', [original.id, retry.deleteToken, remoteDelete(retry.storageKey)]);
    expect(deletedKeys).toEqual([original.key, original.key]);
    expect([...fakeStorage].sort()).toEqual(["generated/key", "legacy/key"]);
    expect((await db.query('SELECT "putOutcome","physicalBytesAccounted" FROM "CanvasImportAsset" WHERE id=$1', [original.id])).rows[0]).toEqual({ putOutcome: "UNKNOWN", physicalBytesAccounted: true });
  });

  describe("cross-child conversation/canvas retention through production Prisma modules", () => {
    beforeEach(() => {
      fixtureAuth.get.mockReset();
      fixtureAuth.require.mockReset();
    });

    it("restores every old-conversation page despite 65 newer canvas runs and 65 orphan jobs", async () => {
      const { prisma, conversations, cursors } = application();
      const user = await owner(); const other = await owner();
      const old = await prisma.conversation.create({ data: { id: `old:${user}`, userId: user, title: "Old conversation" } });
      const sibling = await prisma.conversation.create({ data: { userId: user, title: "Other conversation" } });
      const foreign = await prisma.conversation.create({ data: { userId: other, title: "Foreign conversation" } });
      const older = new Date("2026-10-01T00:00:00.000Z");
      const newer = new Date("2026-10-02T00:00:00.000Z");
      const recent = new Date("2026-10-28T00:00:00.000Z");
      const oldJobs = Array.from({ length: 75 }, (_, index) => jobFixture(user, {
        id: `${user}:chat:${String(index).padStart(3, "0")}`, conversationId: old.id, status: "SUCCEEDED",
        createdAt: index < 35 ? older : newer, updatedAt: older,
        providerApiKeyEncrypted: "fixture-private-provider-key", providerBaseUrl: "https://provider.invalid",
      }));
      await prisma.generationJob.createMany({ data: oldJobs });
      await prisma.generationImage.createMany({ data: oldJobs.map((job) => ({
        id: `${job.id}:image`, jobId: job.id, url: `https://media.invalid/${job.id}.png`, width: 96, height: 64,
        mediaStorage: "S3", storageKey: `fixture-private/${job.id}`, createdAt: older,
      })) });

      // Use actual committed run ledgers, not null-conversation jobs merely
      // labelled "canvas". Every synthetic debit has sufficient fixture credit.
      await prisma.user.update({ where: { id: user }, data: { credits: 1_000 } });
      const canvasId = await canvas(user);
      const canvasJobs: string[] = [];
      for (let index = 0; index < 65; index += 1) {
        const value = wire(canvasId);
        const reservation = await reserve(user, value);
        canvasJobs.push(await commit(user, value, reservation.preparationToken));
      }
      await prisma.generationJob.updateMany({ where: { id: { in: canvasJobs } }, data: { createdAt: recent } });
      const siblingJob = jobFixture(user, { conversationId: sibling.id, createdAt: recent });
      await prisma.generationJob.createMany({ data: [
        ...Array.from({ length: 65 }, () => jobFixture(user, { conversationId: null, createdAt: recent })),
        siblingJob,
        jobFixture(other, { conversationId: foreign.id, createdAt: recent }),
        // Legacy independent FKs permit this mismatch; both query scopes matter.
        jobFixture(other, { conversationId: old.id, createdAt: recent }),
      ] });
      expect(await prisma.canvasRun.count({ where: { canvasId, state: "COMMITTED" } })).toBe(65);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user } })).credits).toBe(675);

      const expectedIds = oldJobs.map((job) => job.id).reverse();
      const globalRecent = await prisma.generationJob.findMany({ where: { userId: user }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
      expect(globalRecent).toHaveLength(50);
      expect(globalRecent.every((job) => !expectedIds.includes(job.id))).toBe(true);
      const first = await conversations.listConversationGenerations({ ownerId: user, conversationId: old.id });
      expect(first.generations.map((job) => job.id)).toEqual(expectedIds.slice(0, 50));
      expect(first.nextCursor).not.toBeNull();
      expect(first.generations[0]).toMatchObject({
        conversationId: old.id, status: "succeeded", createdAt: newer.toISOString(),
        images: [{ id: `${expectedIds[0]}:image`, url: `https://media.invalid/${expectedIds[0]}.png`, actualWidth: 96, actualHeight: 64 }],
      });
      expect(JSON.stringify(first)).not.toMatch(/fixture-private|providerApiKeyEncrypted|storageKey|"userId"/);
      const key = cursors.decodeCanvasCursor(first.nextCursor!, { ownerId: user, scope: "conversation", parentId: old.id });
      expect(key).toEqual({ at: older, id: expectedIds[49] });

      await signIn(user);
      expect(await conversationPage(await readConversation(old.id))).toEqual(first);
      // A status/read refresh must not reorder an older job across the cursor.
      await prisma.generationJob.update({ where: { id: oldJobs[0].id }, data: { updatedAt: recent } });
      const second = await conversationPage(await readConversation(old.id, `?cursor=${first.nextCursor}`));
      expect(second.generations.map((job) => job.id)).toEqual(expectedIds.slice(50));
      expect(second.generations).toHaveLength(25);
      expect(second.nextCursor).toBeNull();
      expect(await conversations.listConversationGenerations({ ownerId: user, conversationId: old.id, key })).toEqual(second);
      expect(await conversationPage(await readConversation(old.id, `?cursor=${first.nextCursor}`))).toEqual(second);
      const restored = [...first.generations, ...second.generations];
      expect(restored.map((job) => job.id)).toEqual(expectedIds);
      expect(new Set(restored.map((job) => job.id)).size).toBe(75);
      expect(restored.every((job) => job.conversationId === old.id)).toBe(true);
      expect((await conversationPage(await readConversation(sibling.id))).generations.map((job) => job.id)).toEqual([siblingJob.id]);
      expect(await conversations.listStudioConversations(user)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: old.id, generationCount: 75 }),
        expect.objectContaining({ id: sibling.id, generationCount: 1 }),
      ]));
    });

    it("rejects foreign/missing parents and owner/parent/canvas cursor reuse without global fallback", async () => {
      const { prisma, conversations, documents } = application();
      const user = await owner(); const other = await owner();
      const first = await prisma.conversation.create({ data: { userId: user, title: "First" } });
      const sibling = await prisma.conversation.create({ data: { userId: user, title: "Sibling" } });
      const empty = await prisma.conversation.create({ data: { userId: user, title: "Empty" } });
      const foreign = await prisma.conversation.create({ data: { userId: other, title: "Foreign" } });
      await prisma.generationJob.createMany({ data: [first, sibling, foreign].flatMap((parent) => [
        jobFixture(parent.userId, { conversationId: parent.id }), jobFixture(parent.userId, { conversationId: parent.id }),
      ]) });
      const ownPage = await conversations.listConversationGenerations({ ownerId: user, conversationId: first.id, limit: 1 });
      const foreignPage = await conversations.listConversationGenerations({ ownerId: other, conversationId: foreign.id, limit: 1 });
      await canvas(user); await canvas(user);
      const canvasPage = await documents.listCanvases(user, { limit: 1, key: null });
      expect(ownPage.nextCursor).not.toBeNull();
      expect(foreignPage.nextCursor).not.toBeNull();
      expect(canvasPage.nextCursor).not.toBeNull();

      await signIn(user);
      for (const id of [randomUUID(), foreign.id]) {
        const response = await readConversation(id);
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
        await expect(conversations.listConversationGenerations({ ownerId: user, conversationId: id })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND", status: 404 });
      }
      for (const [id, cursor] of [[sibling.id, ownPage.nextCursor], [first.id, foreignPage.nextCursor], [first.id, canvasPage.nextCursor]]) {
        const response = await readConversation(id!, `?cursor=${cursor}`);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "CONVERSATION_INVALID_INPUT" });
      }
      expect(await conversationPage(await readConversation(empty.id))).toEqual({ conversationId: empty.id, generations: [], nextCursor: null });
      await signIn(other);
      expect((await readConversation(first.id)).status).toBe(404);
      const ownCursorAsForeign = await readConversation(first.id, `?cursor=${ownPage.nextCursor}`);
      expect(ownCursorAsForeign.status).toBe(400);
      expect(await ownCursorAsForeign.json()).toMatchObject({ code: "CONVERSATION_INVALID_INPUT" });
      fixtureAuth.get.mockResolvedValue(null);
      const anonymous = await readConversation(first.id);
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toMatchObject({ code: "CONVERSATION_UNAUTHENTICATED" });
    });

    it("keeps conversation jobs/images in production owner works after DELETE with no cancel/refund/credit changes", async () => {
      const { prisma, conversations, works, worksRoute } = application();
      const user = await owner(); const other = await owner();
      const removed = await prisma.conversation.create({ data: { userId: user, title: "Remove organization only" } });
      const retained = await prisma.conversation.create({ data: { userId: user, title: "Retained conversation" } });
      const foreign = await prisma.conversation.create({ data: { userId: other, title: "Foreign conversation" } });
      const at = new Date("2026-10-01T00:00:00.000Z");
      const jobs = (["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"] as const).map((status) => jobFixture(user, {
        conversationId: removed.id, status, count: status === "SUCCEEDED" ? 2 : 1, createdAt: at, updatedAt: at,
        cancelRequestedAt: status === "FAILED" ? at : null, refundAppliedAt: status === "FAILED" ? at : null,
      }));
      const siblingJob = jobFixture(user, { conversationId: retained.id, status: "SUCCEEDED" });
      const foreignJob = jobFixture(other, { conversationId: foreign.id, status: "SUCCEEDED" });
      const jobIds = [...jobs, siblingJob, foreignJob].map((job) => job.id);
      await prisma.generationJob.createMany({ data: [...jobs, siblingJob, foreignJob] });
      const images = [
        ...["first", "second"].map((suffix) => ({ id: `${jobs[2].id}:${suffix}`, jobId: jobs[2].id, url: `https://media.invalid/${suffix}.png`, createdAt: at })),
        { id: randomUUID(), jobId: siblingJob.id, url: "https://media.invalid/sibling.png", createdAt: at },
        { id: randomUUID(), jobId: foreignJob.id, url: "https://media.invalid/foreign.png", createdAt: new Date("2026-09-01T00:00:00.000Z") },
      ];
      await prisma.generationImage.createMany({ data: images });
      const beforeJobs = await prisma.generationJob.findMany({ where: { id: { in: jobIds } }, orderBy: { id: "asc" } });
      const beforeImages = await prisma.generationImage.findMany({ where: { jobId: { in: jobIds } }, orderBy: { id: "asc" } });
      const beforeCredits = await prisma.user.findMany({ where: { id: { in: [user, other] } }, select: { id: true, credits: true }, orderBy: { id: "asc" } });
      const beforeWorks = await works.listUserWorksPage({ userId: user, limit: 60 });
      expect(beforeWorks.items.map((item) => item.id).sort()).toEqual(images.slice(0, 3).map((image) => image.id).sort());
      const firstPage = await works.listUserWorksPage({ userId: user, limit: 1 });
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.nextCursor).not.toBeNull();

      await signIn(other);
      expect((await removeConversation(removed.id)).status).toBe(404);
      expect((await removeWork(images[0].id)).status).toBe(404);
      const foreignWorks = await worksRoute.GET(new Request(`https://studio.invalid/api/me/works?limit=60&userId=${user}&cursor=${firstPage.nextCursor}`));
      expect(foreignWorks.status).toBe(200);
      expect(await foreignWorks.json()).toMatchObject({ data: {
        items: [{ id: images[3].id, jobId: foreignJob.id, ownerId: other }], hasMore: false, nextCursor: null,
      } });
      await signIn(user);
      expect((await removeConversation(foreign.id)).status).toBe(404);
      const deleted = await removeConversation(removed.id);
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ data: { ok: true } });
      expect(await prisma.conversation.findUnique({ where: { id: removed.id } })).toBeNull();
      expect(await prisma.generationJob.findMany({ where: { id: { in: jobIds } }, orderBy: { id: "asc" } })).toEqual(
        beforeJobs.map((job) => ({ ...job, conversationId: job.conversationId === removed.id ? null : job.conversationId })),
      );
      expect(await prisma.generationImage.findMany({ where: { jobId: { in: jobIds } }, orderBy: { id: "asc" } })).toEqual(beforeImages);
      expect(await prisma.user.findMany({ where: { id: { in: [user, other] } }, select: { id: true, credits: true }, orderBy: { id: "asc" } })).toEqual(beforeCredits);
      expect(await works.listUserWorksPage({ userId: user, limit: 60 })).toEqual(beforeWorks);
      const retrieved = await worksRoute.GET(new Request("https://studio.invalid/api/me/works?limit=60"));
      expect(retrieved.status).toBe(200);
      expect(await retrieved.json()).toEqual({ data: beforeWorks });
      expect((await works.listUserWorksPage({ userId: other })).items.map((item) => item.id)).toEqual([images[3].id]);
      expect((await conversations.listStudioConversations(user)).map((item) => item.id)).toEqual([retained.id]);
      expect((await readConversation(removed.id)).status).toBe(404);
      expect((await removeConversation(removed.id)).status).toBe(404);
      expect(await prisma.conversation.count({ where: { id: removed.id } })).toBe(0);
    });

    it.each(["PENDING", "PROCESSING"] as const)("retains works and run roots after production canvas deletion during %s, without resurrection", async (status) => {
      const { prisma, documents, works, worksRoute } = application();
      const user = await owner(); const other = await owner();
      const id = await canvas(user); const foreignCanvas = await canvas(other); const original = await asset(user);
      const savedScene = scene([original.id]);
      await save(user, id, savedScene);
      const completedRun = wire(id, original.id); const activeRun = wire(id, original.id);
      const completedReservation = await reserve(user, completedRun); const activeReservation = await reserve(user, activeRun);
      const completedId = await commit(user, completedRun, completedReservation.preparationToken);
      const activeId = await commit(user, activeRun, activeReservation.preparationToken);
      await prisma.generationJob.update({ where: { id: completedId }, data: { status: "SUCCEEDED" } });
      await prisma.generationJob.update({ where: { id: activeId }, data: { status } });
      const foreignJob = await prisma.generationJob.create({ data: jobFixture(other, { status: "SUCCEEDED" }) });
      const completedImage = { id: randomUUID(), jobId: completedId, url: "https://media.invalid/canvas-retained.png", mediaStorage: "S3", storageKey: "generated/retained.png" };
      const foreignImage = { id: randomUUID(), jobId: foreignJob.id, url: "https://media.invalid/foreign-canvas.png" };
      await prisma.generationImage.createMany({ data: [completedImage, foreignImage] });
      const jobIds = [completedId, activeId, foreignJob.id];
      const beforeJobs = await prisma.generationJob.findMany({ where: { id: { in: jobIds } }, orderBy: { id: "asc" } });
      const beforeImages = await prisma.generationImage.findMany({ where: { jobId: { in: jobIds } }, orderBy: { id: "asc" } });
      const beforeCredits = await prisma.user.findMany({ where: { id: { in: [user, other] } }, select: { id: true, credits: true }, orderBy: { id: "asc" } });
      const beforeRuns = await prisma.canvasRun.findMany({ where: { canvasId: id }, orderBy: { id: "asc" } });
      const beforeRoots = await prisma.canvasJobAssetUse.findMany({ where: { assetId: original.id }, orderBy: { id: "asc" } });
      const beforeWorks = await works.listUserWorksPage({ userId: user });
      expect(beforeWorks.items.map((item) => item.id)).toEqual([completedImage.id]);
      expect(beforeRuns).toHaveLength(2);
      expect(beforeRoots).toHaveLength(2);
      expect(beforeCredits.find((entry) => entry.id === user)?.credits).toBe(90);
      expect(await prisma.canvasSavedAssetUse.count({ where: { canvasId: id } })).toBe(1);

      await expect(documents.deleteCanvas(other, id, 1)).rejects.toMatchObject({ code: "CANVAS_NOT_FOUND" });
      await expect(documents.getCanvas(other, id)).rejects.toMatchObject({ code: "CANVAS_NOT_FOUND" });
      await signIn(other);
      expect((await removeWork(completedImage.id)).status).toBe(404);
      expect((await works.listUserWorksPage({ userId: other })).items.map((item) => item.id)).toEqual([foreignImage.id]);
      expect(await documents.deleteCanvas(user, id, 1)).toEqual({ id, deleted: true, revision: 2 });
      const tombstone = await prisma.canvas.findUniqueOrThrow({ where: { id } });
      expect(tombstone).toMatchObject({ scene: null, revision: 2, deletedAt: expect.any(Date) });
      expect(await prisma.canvasSavedAssetUse.count({ where: { canvasId: id } })).toBe(0);
      expect(await prisma.generationJob.findMany({ where: { id: { in: jobIds } }, orderBy: { id: "asc" } })).toEqual(beforeJobs);
      expect(await prisma.generationImage.findMany({ where: { jobId: { in: jobIds } }, orderBy: { id: "asc" } })).toEqual(beforeImages);
      expect(await prisma.canvasRun.findMany({ where: { canvasId: id }, orderBy: { id: "asc" } })).toEqual(beforeRuns);
      expect(await prisma.canvasJobAssetUse.findMany({ where: { assetId: original.id }, orderBy: { id: "asc" } })).toEqual(beforeRoots);
      expect(await works.listUserWorksPage({ userId: user })).toEqual(beforeWorks);
      expect(await prisma.canvasImportAsset.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ state: "READY", detachedAt: null });

      // Synthetic completion in one real transaction, not a worker/provider run.
      // The production works reader must retain this later output without
      // recreating the deleted organization or changing cancellation/refunds.
      const lateImage = { id: randomUUID(), url: "https://media.invalid/canvas-late.png", mediaStorage: "S3", storageKey: "generated/late.png" };
      const completedAt = new Date();
      const completed = await prisma.generationJob.update({ where: { id: activeId }, data: {
        status: "SUCCEEDED", completedAt, images: { create: lateImage },
      } });
      const afterWorks = await works.listUserWorksPage({ userId: user });
      expect(afterWorks.items.map((item) => item.id).sort()).toEqual([completedImage.id, lateImage.id].sort());
      expect(afterWorks.items.every((item) => item.ownerId === user && item.generationStatus === "succeeded")).toBe(true);
      await signIn(user);
      const retrieved = await worksRoute.GET(new Request("https://studio.invalid/api/me/works"));
      expect(retrieved.status).toBe(200);
      expect(await retrieved.json()).toEqual({ data: afterWorks });
      expect(await prisma.generationJob.findMany({ where: { id: { in: jobIds } }, orderBy: { id: "asc" } })).toEqual(
        beforeJobs.map((job) => job.id === activeId ? { ...job, status: "SUCCEEDED", completedAt, updatedAt: completed.updatedAt } : job),
      );
      expect(await prisma.generationImage.findMany({ where: { id: { in: beforeImages.map((image) => image.id) } }, orderBy: { id: "asc" } })).toEqual(beforeImages);
      expect(await prisma.user.findMany({ where: { id: { in: [user, other] } }, select: { id: true, credits: true }, orderBy: { id: "asc" } })).toEqual(beforeCredits);
      expect(await prisma.canvasRun.findMany({ where: { canvasId: id }, orderBy: { id: "asc" } })).toEqual(beforeRuns);
      expect(await prisma.canvasJobAssetUse.findMany({ where: { assetId: original.id }, orderBy: { id: "asc" } })).toEqual(beforeRoots);
      await expect(documents.getCanvas(user, id)).rejects.toMatchObject({ code: "CANVAS_DELETED" });
      await expect(documents.createCanvas(user, { id, title: "Must not resurrect" })).rejects.toMatchObject({ code: "CANVAS_DELETED" });
      expect(await documents.deleteCanvas(user, id, 1)).toEqual({ id, deleted: true, revision: 2 });
      expect(await documents.listCanvases(user, { limit: 100, key: null })).toEqual({ canvases: [], nextCursor: null });
      expect((await documents.listCanvases(other, { limit: 100, key: null })).canvases.map((item) => item.id)).toEqual([foreignCanvas]);
      expect(await prisma.canvas.findUniqueOrThrow({ where: { id } })).toEqual(tombstone);
    });
  });
});
