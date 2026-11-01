// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const mocks = vi.hoisted(() => ({ user: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.user }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));

import { readCanvasBody, readCanvasJson } from "@/lib/canvas/body-limit";
import { CanvasContractError } from "@/lib/canvas/contracts";
import { decodeCanvasCursor, encodeCanvasCursor, parseCanvasPageQuery } from "@/lib/canvas/cursors";
import { canvasErrorResponse, isCanvasEnabled, parseCanvasInput, requireCanvasOwner } from "@/lib/canvas/http";
import { canvasDatabaseError, canvasTransaction, isCanvasTransactionRetryable, lockCanvasOwner, type CanvasTransaction } from "@/lib/canvas/transactions";
import { canvasGuardSqlState, canvasRawGuardError } from "./helpers/canvas-sql-error";

function streamRequest(parts: Uint8Array[], headers: HeadersInit = {}) {
  const cancel = vi.fn();
  let delivered = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (delivered < parts.length) controller.enqueue(parts[delivered++]); else controller.close(); },
    cancel,
  }, { highWaterMark: 0 });
  const request = new Request("http://localhost/api", { method: "POST", headers, body, duplex: "half" } as RequestInit);
  return { request, cancel, delivered: () => delivered };
}

describe("canvas HTTP boundaries", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "owner" }); });

  it("fails closed without the sole loader flag and requires an authenticated app user", async () => {
    expect(isCanvasEnabled()).toBe(false);
    expect(isCanvasEnabled({ CANVAS_ENABLED: true })).toBe(true);
    await expect(requireCanvasOwner()).rejects.toMatchObject({ code: "CANVAS_DISABLED" });
    mocks.user.mockResolvedValue(null);
    await expect(requireCanvasOwner({ enabled: () => true })).rejects.toMatchObject({ code: "CANVAS_UNAUTHENTICATED" });
    await expect(requireCanvasOwner({ getUser: async () => ({ id: "explicit-owner" }), enabled: () => true })).resolves.toBe("explicit-owner");
  });

  it("counts streamed bytes without a Content-Length and cancels before reading the rest", async () => {
    const stream = streamRequest([Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4)]);
    await expect(readCanvasBody(stream.request, 6)).rejects.toMatchObject({ code: "CANVAS_LIMIT_EXCEEDED" });
    expect(stream.delivered()).toBe(2);
    expect(stream.cancel).toHaveBeenCalledOnce();
  });

  it("does not trust a lying smaller Content-Length", async () => {
    const stream = streamRequest([Buffer.alloc(4), Buffer.alloc(4)], { "Content-Length": "2" });
    await expect(readCanvasBody(stream.request, 6)).rejects.toMatchObject({ code: "CANVAS_LIMIT_EXCEEDED" });
  });

  it("rejects declared oversize without pulling or buffering", async () => {
    const stream = streamRequest([Buffer.alloc(2)], { "Content-Length": "200" });
    await expect(readCanvasBody(stream.request, 20)).rejects.toMatchObject({ code: "CANVAS_LIMIT_EXCEEDED" });
    expect(stream.delivered()).toBe(0);
  });

  it("accepts an exact bound across chunks and rejects truncated declared length", async () => {
    const stream = streamRequest([Buffer.from("ab"), Buffer.from("cd")], { "Content-Length": "4" });
    expect((await readCanvasBody(stream.request, 4)).toString()).toBe("abcd");
    await expect(readCanvasBody(streamRequest([Buffer.from("ab")], { "Content-Length": "4" }).request, 4)).rejects.toMatchObject({ code: "CANVAS_INVALID_INPUT" });
  });

  it("bounds slow streams and cancels them", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ cancel });
      const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
      const pending = expect(readCanvasBody(request, 20)).rejects.toMatchObject({ code: "CANVAS_INVALID_INPUT" });
      await vi.advanceTimersByTimeAsync(30_001);
      await pending;
      expect(cancel).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it.each([
    { headers: { "Content-Type": "text/plain" }, bytes: Buffer.from("{}") },
    { headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }, bytes: Buffer.from("{}") },
    { headers: { "Content-Type": "application/json" }, bytes: Buffer.from([0xff]) },
    { headers: { "Content-Type": "application/json" }, bytes: Buffer.from("{") },
  ])("rejects malformed/unsupported JSON transport %#", async ({ headers, bytes }) => {
    await expect(readCanvasJson(streamRequest([bytes], headers as HeadersInit).request, 20)).rejects.toMatchObject({ code: "CANVAS_INVALID_INPUT" });
  });

  it("serializes allowlisted errors, never unknown database messages", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = canvasErrorResponse(new Error("DSN and private query text must not escape"));
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "CANVAS_INTERNAL_ERROR" });
      expect(JSON.stringify(log.mock.calls)).not.toContain("private query");
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(canvasErrorResponse(new CanvasContractError("CANVAS_DELETED")).status).toBe(409);
      expect(() => parseCanvasInput(z.object({ title: z.string().max(2) }), { title: "long" })).toThrow(CanvasContractError);
    } finally { log.mockRestore(); }
  });
});

describe("shared strict owner keysets", () => {
  const scope = { ownerId: "owner", scope: "canvas" as const, parentId: null };
  const key = { at: new Date("2026-10-20T00:00:00.000Z"), id: "aaaaaaaa-0000-4000-8000-000000000001" };

  it("round trips owner/scope/parent/date/id and supplies bounded default pages", () => {
    expect(decodeCanvasCursor(encodeCanvasCursor(scope, key), scope)).toEqual(key);
    expect(parseCanvasPageQuery("http://localhost/api", scope)).toEqual({ limit: 50, key: null });
    expect(parseCanvasPageQuery(`http://localhost/api?limit=100&cursor=${encodeCanvasCursor(scope, key)}`, scope)).toEqual({ limit: 100, key });
  });

  it.each([
    { ...scope, ownerId: "foreign" },
    { ...scope, scope: "conversation" as const, parentId: "chat-one" },
    { ...scope, parentId: "wrong-parent" },
  ])("rejects a cursor outside its exact scope %#", (other) => {
    expect(() => decodeCanvasCursor(encodeCanvasCursor(scope, key), other)).toThrow(CanvasContractError);
  });

  it.each(["?limit=101", "?limit=0", "?limit=10&limit=20", "?ownerId=foreign", "?cursor=bad%3D", "?cursor=e30"])("rejects malformed or unbounded page query %s", (query) => {
    expect(() => parseCanvasPageQuery(`http://localhost/api${query}`, scope)).toThrow(CanvasContractError);
  });

  it("rejects an internally malformed payload and noncanonical base64", () => {
    const encoded = Buffer.from(JSON.stringify({ schemaVersion: 1, ...scope, id: key.id, at: "not-a-date" })).toString("base64url");
    expect(() => decodeCanvasCursor(encoded, scope)).toThrow(CanvasContractError);
    expect(() => decodeCanvasCursor(`${encodeCanvasCursor(scope, key)}=`, scope)).toThrow(CanvasContractError);
  });

  it("requires UUID keys for canvas pages while retaining opaque conversation job keys", () => {
    const opaque = { ...key, id: "job_opaque" };
    const encoded = Buffer.from(JSON.stringify({ schemaVersion: 1, ...scope, at: key.at.toISOString(), id: opaque.id })).toString("base64url");
    expect(() => decodeCanvasCursor(encoded, scope)).toThrow(CanvasContractError);
    expect(() => encodeCanvasCursor(scope, opaque)).toThrow(CanvasContractError);
    const conversation = { ownerId: "owner", scope: "conversation" as const, parentId: "chat_opaque" };
    expect(decodeCanvasCursor(encodeCanvasCursor(conversation, opaque), conversation)).toEqual(opaque);
  });
});

describe("bounded canvas transactions", () => {
  it.each([canvasGuardSqlState, "P0001", "40P01"])("handles the real Prisma CRUD adapter error for %s without a database", async (code) => {
    const pool = new Pool({ host: "127.0.0.1", port: 1 });
    const query = vi.spyOn(pool, "query").mockRejectedValue(Object.assign(new Error("CANVAS_QUOTA_EXCEEDED"), { code, severity: "ERROR" }));
    const connect = vi.spyOn(pool, "connect").mockRejectedValue(new Error("This fake must never open a database connection"));
    const client = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      const error = await client.canvas.create({ data: {
        id: "aaaaaaaa-0000-4000-8000-000000000001", ownerId: "owner", userId: "owner", title: "Draft",
      } }).catch((failure: unknown) => failure);
      expect(error).toMatchObject({ name: "DriverAdapterError", cause: { originalCode: code, originalMessage: "CANVAS_QUOTA_EXCEEDED" } });
      expect(connect).not.toHaveBeenCalled();
      if (code === canvasGuardSqlState || code === "P0001") expect(canvasDatabaseError(error)?.code).toBe("CANVAS_QUOTA_EXCEEDED");
      else expect(isCanvasTransactionRetryable(error)).toBe(true);
    } finally {
      await client.$disconnect();
      query.mockRestore(); connect.mockRestore();
      await pool.end();
    }
  });

  it("maps the migration's exact raw-query guard error through the real Prisma adapter", async () => {
    const pool = new Pool({ host: "127.0.0.1", port: 1 });
    const query = vi.spyOn(pool, "query").mockRejectedValue(Object.assign(new Error("CANVAS_REVISION_CONFLICT"), {
      code: canvasGuardSqlState, severity: "ERROR", constraint: "CANVAS_REVISION_CONFLICT",
    }));
    const connect = vi.spyOn(pool, "connect").mockRejectedValue(new Error("This fake must never open a database connection"));
    const client = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      const error = await client.$queryRaw`SELECT canvas_raise('CANVAS_REVISION_CONFLICT')`.catch((failure: unknown) => failure);
      expect(canvasDatabaseError(error)?.code).toBe("CANVAS_REVISION_CONFLICT");
      const response = canvasErrorResponse(error);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await client.$disconnect();
      query.mockRestore(); connect.mockRestore();
      await pool.end();
    }
  });

  it("maps only allowlisted migration guard messages, never ordinary check-constraint details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(canvasDatabaseError(canvasRawGuardError("CANVAS_LEASE_LOST"))?.code).toBe("CANVAS_LEASE_LOST");
      for (const message of ["new row violates check constraint with private row data", "CANVAS_NOT_FOUND plus private text"]) {
        for (const error of [
          { code: "P2010", meta: { code: canvasGuardSqlState, message } },
          { name: "DriverAdapterError", cause: { originalCode: canvasGuardSqlState, originalMessage: message } },
        ]) {
          expect(canvasDatabaseError(error)).toBeNull();
          expect(isCanvasTransactionRetryable(error)).toBe(false);
          const response = canvasErrorResponse(error);
          expect(response.status).toBe(500);
          expect(await response.json()).toMatchObject({ code: "CANVAS_INTERNAL_ERROR" });
        }
      }
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    } finally { log.mockRestore(); }
  });

  it("executes the owner gate without asking the real pg adapter to deserialize void (fake driver, no DB)", async () => {
    const pool = new Pool({ host: "127.0.0.1", port: 1 });
    const query = vi.spyOn(pool, "query").mockResolvedValue({ fields: [{ name: "canvas_lock_owner", dataTypeID: 2278 }], rows: [[""]], rowCount: 1 } as never);
    const adapter = await new PrismaPg(pool).connect();
    const sql = { sql: "SELECT canvas_lock_owner('owner')", args: [], argTypes: [] };
    try {
      await expect(adapter.queryRaw(sql)).rejects.toMatchObject({ cause: { kind: "UnsupportedNativeDataType", type: "void" } });
      const tx = {
        $queryRaw: () => adapter.queryRaw(sql),
        $executeRaw: () => adapter.executeRaw(sql),
      } as unknown as CanvasTransaction;
      await expect(lockCanvasOwner(tx, "owner")).resolves.toBeUndefined();
    } finally {
      await adapter.dispose();
      query.mockRestore();
      await pool.end();
    }
  });

  it("retries only known rollback conflicts with a bounded budget", async () => {
    const database = { $transaction: vi.fn().mockRejectedValueOnce({ code: "P2034" }).mockRejectedValueOnce({ code: "40P01" }).mockResolvedValue("committed") };
    await expect(canvasTransaction(async () => "unused", database)).resolves.toBe("committed");
    expect(database.$transaction).toHaveBeenCalledTimes(3);
    database.$transaction.mockReset().mockRejectedValue({ code: "40001" });
    await expect(canvasTransaction(async () => "unused", database)).rejects.toMatchObject({ code: "40001" });
    expect(database.$transaction).toHaveBeenCalledTimes(3);
  });

  it("never retries ambiguous commits/connection loss and only maps exact SQL contract messages", async () => {
    const database = { $transaction: vi.fn().mockRejectedValue({ code: "P1017" }) };
    await expect(canvasTransaction(async () => "unused", database)).rejects.toMatchObject({ code: "P1017" });
    expect(database.$transaction).toHaveBeenCalledOnce();
    expect(canvasDatabaseError({ code: "P2010", meta: { code: "P0001", message: "CANVAS_REVISION_CONFLICT" } })?.code).toBe("CANVAS_REVISION_CONFLICT");
    expect(canvasDatabaseError({ meta: { driverAdapterError: { cause: { originalCode: "P0001", originalMessage: "CANVAS_QUOTA_EXCEEDED" } } } })?.code).toBe("CANVAS_QUOTA_EXCEEDED");
    expect(canvasDatabaseError({ code: "P0001", message: "CANVAS_NOT_FOUND plus private text" })).toBeNull();
    expect(canvasDatabaseError(new Error("CANVAS_DELETED"))).toBeNull();
    expect(canvasDatabaseError({ name: "DriverAdapterError", cause: { originalCode: "P0001", originalMessage: "CANVAS_NOT_FOUND plus private text" } })).toBeNull();
    for (const code of ["08006", "40003", "42501", "XX000"]) {
      const error = { name: "DriverAdapterError", cause: { originalCode: code, originalMessage: "CANVAS_QUOTA_EXCEEDED" } };
      expect(canvasDatabaseError(error)).toBeNull();
      expect(isCanvasTransactionRetryable(error)).toBe(false);
    }
  });
});
