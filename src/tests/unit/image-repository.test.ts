// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { ImageStorageError } from "@/lib/storage/image-contract";
import { ImageRepository, type ImageQueryer } from "@/lib/storage/image-repository";

function reservation() {
  return {
    id: "00112233-4455-4677-8899-aabbccddeeff", token: "11223344-5566-4788-99aa-bbccddeeff00",
    ownerId: "owner", intentKey: "test-intent", kind: "OUTPUT", slotBytes: ["52428800"], remainingBytes: "52428800",
    state: "ACTIVE", outputJobId: null, workerId: null, leaseExpiresAt: "2026-11-12T00:20:00Z", createdAt: "2026-11-12T00:00:00Z", updatedAt: "2026-11-12T00:00:00Z",
  };
}

describe("image repository boundary", () => {
  it("round-trips an exact budget through parameterized JSON and typed decimal DTOs", async () => {
    const query = vi.fn().mockResolvedValue([{ result: reservation() }]);
    const repository = new ImageRepository({ $queryRaw: query } as ImageQueryer);
    const result = await repository.reserveOutputs({ ownerId: "owner", intentKey: "test-intent", count: 1 });
    expect(result.remainingBytes).toBe("52428800");
    const parameter = JSON.parse(query.mock.calls[0][0].values[0]);
    expect(parameter.slotBytes).toEqual(["52428800"]);
    expect(parameter).not.toHaveProperty("enabled");
  });

  it("rejects an invalid output count before touching the database", async () => {
    const query = vi.fn();
    const repository = new ImageRepository({ $queryRaw: query } as ImageQueryer);
    expect(() => repository.reserveOutputs({ ownerId: "owner", intentKey: "test", count: 5 })).toThrow(ImageStorageError);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not leak raw DB errors or accept an incomplete result", async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error("SQL private credentials and statement"))
      .mockResolvedValueOnce([{ result: { ...reservation(), remainingBytes: 52428800 } }]);
    const repository = new ImageRepository({ $queryRaw: query } as ImageQueryer);
    await expect(repository.getReservationByJob("job")).rejects.toMatchObject({ code: "IMAGE_INTERNAL_ERROR", message: "图片存储操作失败" });
    await expect(repository.getReservationByJob("job")).rejects.toMatchObject({ code: "IMAGE_INTERNAL_ERROR" });
  });

  it("preserves a quota error as a stable business failure and nullable misses", async () => {
    const query = vi.fn().mockRejectedValueOnce({ code: "P2010", meta: { code: "23514", message: "IMAGE_QUOTA_EXCEEDED" } })
      .mockResolvedValueOnce([{ result: null }]);
    const repository = new ImageRepository({ $queryRaw: query } as ImageQueryer);
    await expect(repository.reserveOutputs({ ownerId: "owner", intentKey: "test", count: 1 })).rejects.toMatchObject({ code: "IMAGE_QUOTA_EXCEEDED" });
    await expect(repository.resolveUrl("https://images.example.test/not-registered")).resolves.toBeNull();
  });
});
