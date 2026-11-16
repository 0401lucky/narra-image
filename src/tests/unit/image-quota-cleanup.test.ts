// @vitest-environment node

import { ImageStorageError, type ImageReservation } from "@/lib/storage/image-contract";
import { IMAGE_QUOTA_WAIT_MS, type ImageMaintenanceJob } from "@/lib/storage/image-maintenance-types";
import { reserveImageWithCleanup } from "@/lib/storage/image-quota-cleanup";

const reservation = { id: "00112233-4455-4677-8899-aabbccddeeff", token: "11223344-5566-4788-99aa-bbccddeeff00", ownerId: "owner", intentKey: "output:one",
  kind: "OUTPUT", state: "ACTIVE", slotBytes: ["52428800"], remainingBytes: "52428800", outputJobId: null, workerId: null,
  leaseExpiresAt: "2030-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } satisfies ImageReservation;
function job(state: ImageMaintenanceJob["state"]): ImageMaintenanceJob {
  return { id: "22334455-6677-4899-aabb-ccddeeff0011", mode: "QUOTA", state, policyVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z", confirmedAt: null, expiresAt: null, completedAt: null, nextAttemptAt: null,
    estimatedBytes: "10", releasedBytes: state === "SUCCEEDED" ? "10" : "0", totalItems: 1, completedItems: state === "SUCCEEDED" ? 1 : 0,
    skippedItems: 0, failedItems: 0, pendingItems: state === "SUCCEEDED" ? 0 : 1, truncated: false, items: [], nextCursor: null };
}
function fixture() {
  const repository = { requestQuotaCleanup: vi.fn().mockResolvedValue(job("QUEUED")), getMaintenanceJob: vi.fn().mockResolvedValue(job("SUCCEEDED")) };
  const reserve = vi.fn().mockRejectedValueOnce(new ImageStorageError("IMAGE_QUOTA_EXCEEDED")).mockResolvedValue(reservation);
  return { repository, reserve, input: { repository, reserve, ownerId: "owner", intentKey: "output:one", neededBytes: BigInt(52428800) } };
}
afterEach(() => { vi.useRealTimers(); });

describe("quota recovery waits for the durable cleanup before retrying admission", () => {
  it("uses the original reservation intent after successful physical reclaim", async () => {
    vi.useFakeTimers();
    const { input, repository, reserve } = fixture();
    const result = reserveImageWithCleanup(input);
    await vi.advanceTimersByTimeAsync(249);
    expect(reserve).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(reservation);
    expect(repository.requestQuotaCleanup).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "owner", intentKey: "output:one", neededBytes: "52428800" }));
    expect(reserve).toHaveBeenCalledTimes(2);
  });
  it("keeps quota enforcement when cleanup is disabled or protected bytes cannot be reclaimed", async () => {
    const { input, repository, reserve } = fixture();
    repository.requestQuotaCleanup.mockResolvedValue(null);
    reserve.mockRejectedValue(new ImageStorageError("IMAGE_QUOTA_EXCEEDED"));
    await expect(reserveImageWithCleanup(input)).rejects.toMatchObject({ code: "IMAGE_QUOTA_EXCEEDED" });
    expect(repository.getMaintenanceJob).not.toHaveBeenCalled();
  });
  it("does not trust the cleanup estimate if another writer wins the released bytes", async () => {
    const { input, repository, reserve } = fixture();
    repository.requestQuotaCleanup.mockResolvedValue(job("SUCCEEDED"));
    reserve.mockRejectedValue(new ImageStorageError("IMAGE_QUOTA_EXCEEDED"));
    await expect(reserveImageWithCleanup(input)).rejects.toMatchObject({ code: "IMAGE_QUOTA_EXCEEDED" });
  });
  it("bounds a stalled queue read and never retries the reservation after the waiter expires", async () => {
    vi.useFakeTimers();
    const { input, repository, reserve } = fixture();
    repository.getMaintenanceJob.mockImplementation(() => new Promise(() => undefined));
    const result = reserveImageWithCleanup(input);
    const assertion = expect(result).rejects.toMatchObject({ code: "IMAGE_QUOTA_EXCEEDED" });
    await vi.advanceTimersByTimeAsync(IMAGE_QUOTA_WAIT_MS + 1);
    await assertion;
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not enqueue cleanup for non-quota errors or successful admission", async () => {
    const { input, repository, reserve } = fixture();
    reserve.mockReset().mockRejectedValue(new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE"));
    await expect(reserveImageWithCleanup(input)).rejects.toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE" });
    reserve.mockResolvedValue(reservation);
    await expect(reserveImageWithCleanup(input)).resolves.toEqual(reservation);
    expect(repository.requestQuotaCleanup).not.toHaveBeenCalled();
  });
});
