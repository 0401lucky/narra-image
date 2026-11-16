// @vitest-environment node

import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn(), execute: vi.fn(), findCover: vi.fn(), saveCover: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ APP_URL: "https://app.history.invalid", IMAGE_STORAGE_MANAGED_ENABLED: false }) }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));

import { updateLoginCoverConfig } from "@/lib/server/login-cover";
import { imageLocalLocation, type ManagedImage } from "@/lib/storage/image-contract";
import { bindManagedImageInputAliases } from "@/lib/storage/image-input-aliases";

const token = "a".repeat(64);
const assetId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const canonical = `https://app.history.invalid/media/images/${token}`;
const variant = `https://APP.history.invalid:443/media/images/${token}`;
const stamp = "2026-11-15T00:00:00.000Z";
const transaction = {
  $queryRaw: mocks.query, $executeRaw: mocks.execute,
  loginCoverConfig: { findUnique: mocks.findCover, upsert: mocks.saveCover },
} as unknown as Prisma.TransactionClient;
let image: ManagedImage | null;
let aliases: Map<string, string>;
let events: string[];

function readyImage(): ManagedImage {
  const location = imageLocalLocation("33333333-3333-4333-8333-333333333333");
  return {
    asset: { id: assetId, ownerId: "original-owner", purpose: "REFERENCE", originId: null, publicToken: token,
      byteLength: "10", mimeType: "image/png", sha256: "b".repeat(64), state: "AVAILABLE", activeObjectId: objectId,
      detachedAt: stamp, deletedAt: null, deleteReason: null, createdAt: stamp, updatedAt: stamp },
    object: { id: objectId, assetId, provenance: "OBSERVED", sourceObservationId: "44444444-4444-4444-8444-444444444444", reconciliationObservationId: null,
      reservationId: null, slot: null, writeToken: null, writeExpiresAt: null, putOutcome: "NOT_APPLICABLE",
      locationId: location.id, physicalNamespace: location.id, key: "images/original.png", byteLength: "10", mimeType: "image/png", sha256: "b".repeat(64),
      state: "READY", versionId: null, accounted: true, needsReconciliation: false, deleteToken: null, deleteExpiresAt: null,
      deleteOutcome: "NOT_STARTED", deleteAttempts: 0, nextDeleteAt: null, deletedAt: null, lastErrorCode: null, createdAt: stamp, updatedAt: stamp },
    location: { ...location, physicalNamespace: location.id, createdAt: stamp },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  image = readyImage(); aliases = new Map([[canonical, assetId]]); events = [];
  mocks.execute.mockImplementation(async (sql: TemplateStringsArray) => {
    expect(sql.join("")).toBe("SELECT image_lock_reference_epoch()");
    events.push("epoch"); return 0;
  });
  mocks.query.mockImplementation(async (sql: Prisma.Sql) => {
    expect(events).toContain("epoch");
    if (sql.text === "SELECT image_get_by_token($1::text) AS result") {
      expect(sql.values).toEqual([token]); events.push("resolve"); return [{ result: image }];
    }
    if (sql.text === "SELECT image_register_alias($1::jsonb) AS result") {
      const binding = JSON.parse(String(sql.values[0])) as { assetId: string; url: string };
      aliases.set(binding.url, binding.assetId); events.push("alias"); return [{ result: true }];
    }
    throw new Error("Unexpected input-alias fixture query");
  });
  mocks.transaction.mockImplementation(async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = new Map(aliases);
    try { return await operation(transaction); }
    catch (error) { aliases = before; throw error; }
  });
  mocks.findCover.mockImplementation(async () => {
    events.push("cover-read"); return { scope: "default", mode: "featured", customUrl: variant };
  });
  mocks.saveCover.mockImplementation(async (input: { update: { mode?: string; customUrl?: string | null } }) => {
    events.push("cover-save");
    return { scope: "default", mode: input.update.mode ?? "featured", customUrl: input.update.customUrl ?? variant };
  });
});

describe("accepted token inputs retain exact URL identities", () => {
  it("binds normalized-authority variants with managed writes disabled without rewriting frozen inputs", async () => {
    const sources = Object.freeze([variant, canonical, variant]);
    await bindManagedImageInputAliases(transaction, sources);
    expect([...aliases]).toEqual([[canonical, assetId], [variant, assetId]]);
    expect(sources).toEqual([variant, canonical, variant]);
    expect(events[0]).toBe("epoch");
    expect(events.filter((event) => event === "resolve")).toHaveLength(1);
  });

  it.each([
    [], [""], [`https://foreign.history.invalid/media/images/${token}`], [`http://app.history.invalid/media/images/${token}`],
    [`${canonical}?download=1`], [`${canonical}#fragment`], [`${canonical}/`], [`https://app.history.invalid/media/images/../images/${token}`],
    ["https://app.history.invalid/media/images/"], [`https://app.history.invalid:444/media/images/${token}`],
  ].map((sources) => ({ sources })))("does not infer managed ownership from an empty, foreign or noncanonical input: $sources", async ({ sources }) => {
    await bindManagedImageInputAliases(transaction, sources);
    expect([...aliases]).toEqual([[canonical, assetId]]);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(["missing", "DELETED", "DELETING", "QUARANTINED", "PENDING"] as const)("rejects a %s token before registering any input alias", async (state) => {
    const ready = readyImage();
    image = state === "missing" ? null : { asset: { ...ready.asset, state, activeObjectId: null }, object: null, location: null };
    await expect(bindManagedImageInputAliases(transaction, [variant])).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE" });
    expect([...aliases]).toEqual([[canonical, assetId]]);
  });

  it("propagates lookup failure and refuses an invalid current-object relation", async () => {
    mocks.query.mockRejectedValueOnce(new Error("unavailable database"));
    await expect(bindManagedImageInputAliases(transaction, [variant])).rejects.toMatchObject({ code: "IMAGE_INTERNAL_ERROR" });
    image!.asset.activeObjectId = "55555555-5555-4555-8555-555555555555";
    await expect(bindManagedImageInputAliases(transaction, [variant])).rejects.toMatchObject({ code: "IMAGE_INTERNAL_ERROR" });
    expect([...aliases]).toEqual([[canonical, assetId]]);
  });
});

describe("current cover input binding", () => {
  it("binds the stored URL when a partial update activates custom mode", async () => {
    expect(await updateLoginCoverConfig({ mode: "custom" })).toEqual({ mode: "custom", customUrl: variant });
    expect(aliases.get(variant)).toBe(assetId);
    expect(events).toEqual(["epoch", "cover-read", "epoch", "resolve", "alias", "cover-save"]);
    expect(mocks.saveCover.mock.calls[0][0].update).toEqual({ mode: "custom" });
  });

  it("does not activate an unused custom URL when selecting featured mode", async () => {
    image = null;
    expect((await updateLoginCoverConfig({ mode: "featured" })).mode).toBe("featured");
    expect(aliases.has(variant)).toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects a missing managed cover before persisting the configuration", async () => {
    image = null;
    await expect(updateLoginCoverConfig({ mode: "custom", customUrl: variant })).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE" });
    expect(mocks.saveCover).not.toHaveBeenCalled();
    expect(aliases.has(variant)).toBe(false);
  });

  it("rolls alias registration back with a failed cover write", async () => {
    mocks.saveCover.mockRejectedValueOnce(new Error("cover transaction rolled back"));
    await expect(updateLoginCoverConfig({ mode: "custom", customUrl: variant })).rejects.toThrow("cover transaction rolled back");
    expect(aliases.has(variant)).toBe(false);
  });
});
