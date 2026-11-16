// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ config: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { loginCoverConfig: { findUnique: mocks.config } } }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ APP_URL: "https://app.unit.invalid" }) }));
vi.mock("@/lib/storage/managed-image-storage", () => ({ resolveManagedImageUrl: mocks.resolve }));

import { getLoginCoverConfig, getLoginCoverDisplayConfig } from "@/lib/server/login-cover";
import { ImageStorageError } from "@/lib/storage/image-contract";

const rawUrl = "https://old-r2.unit.invalid/login-cover.png";
const token = "b".repeat(64);
const raw = Object.freeze({ scope: "default", mode: "custom", customUrl: rawUrl });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockResolvedValue(raw);
});

describe("site cover display and configuration provenance", () => {
  it("renders the current managed URL while keeping the configured source for admin editing", async () => {
    for (const activeObjectId of ["old-s3-copy", "new-local-copy"]) {
      mocks.resolve.mockResolvedValue({ asset: { id: "asset", state: "AVAILABLE", publicToken: token, activeObjectId } });
      expect(await getLoginCoverDisplayConfig()).toEqual({ mode: "custom", customUrl: `https://app.unit.invalid/media/images/${token}` });
      expect(await getLoginCoverConfig()).toEqual({ mode: "custom", customUrl: rawUrl });
    }
    expect(mocks.resolve).toHaveBeenCalledWith(rawUrl);
    expect(raw.customUrl).toBe(rawUrl);
  });

  it.each(["DELETED", "DELETING", "QUARANTINED"])("omits the source URL for a %s cover", async (state) => {
    mocks.resolve.mockResolvedValue({ asset: { id: "asset", state, publicToken: token, activeObjectId: null } });
    expect(await getLoginCoverDisplayConfig()).toEqual({ mode: "custom", customUrl: null });
    expect((await getLoginCoverConfig()).customUrl).toBe(rawUrl);
  });

  it("preserves unregistered external covers and never infers an alias by query/prefix", async () => {
    const variant = `${rawUrl}?variant=external`;
    mocks.config.mockResolvedValue({ ...raw, customUrl: variant });
    mocks.resolve.mockResolvedValue(null);
    expect((await getLoginCoverDisplayConfig()).customUrl).toBe(variant);
    expect(mocks.resolve).toHaveBeenCalledWith(variant);
  });

  it("does not resolve unused custom values in featured mode or fall back after a query failure", async () => {
    mocks.config.mockResolvedValue({ ...raw, mode: "featured" });
    expect((await getLoginCoverDisplayConfig()).mode).toBe("featured");
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.config.mockResolvedValue(raw);
    mocks.resolve.mockRejectedValue(new ImageStorageError("IMAGE_INTERNAL_ERROR"));
    await expect(getLoginCoverDisplayConfig()).rejects.toMatchObject({ code: "IMAGE_INTERNAL_ERROR" });
    mocks.resolve.mockRejectedValue(new ImageStorageError("IMAGE_UNAVAILABLE"));
    expect((await getLoginCoverDisplayConfig()).customUrl).toBeNull();
  });
});
