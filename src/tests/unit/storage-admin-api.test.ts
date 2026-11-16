// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), overview: vi.fn(), policy: vi.fn(), preview: vi.fn(), confirm: vi.fn(), job: vi.fn(), cancel: vi.fn(),
}));
vi.mock("@/lib/server/current-user", () => ({ requireAdminRecord: mocks.admin }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ IMAGE_STORAGE_BACKEND: "local" }), isManagedImageStorageConfigured: () => true }));
vi.mock("@/lib/storage/image-repository", () => ({ ImageRepository: class {
  getStorageOverview = mocks.overview;
  updateStoragePolicy = mocks.policy;
  previewCleanup = mocks.preview;
  confirmCleanup = mocks.confirm;
  getMaintenanceJob = mocks.job;
  cancelMaintenance = mocks.cancel;
} }));

import { GET as overview } from "@/app/api/admin/storage/route";
import { PATCH as policy } from "@/app/api/admin/storage/policy/route";
import { POST as preview } from "@/app/api/admin/storage/cleanup/preview/route";
import { POST as confirm } from "@/app/api/admin/storage/cleanup/route";
import { GET as job } from "@/app/api/admin/storage/jobs/[id]/route";
import { POST as cancel } from "@/app/api/admin/storage/jobs/[id]/cancel/route";
import { ImageStorageError } from "@/lib/storage/image-contract";
import { cleanupJob, cleanupPreview, storageFixtureIds, storageOverview, storagePolicy } from "./helpers/storage-management-fixtures";

const url = "https://admin.unit.invalid/api/admin/storage";
const context = { params: Promise.resolve({ id: storageFixtureIds.job }) };
const request = (body: unknown, method = "POST") => new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const policyInput = { expectedVersion: 1, limitBytes: "5000000000", enabled: true, quotaCleanupEnabled: true, scheduleEnabled: false, retentionDays: 30, intervalSeconds: 86400 };
const previewInput = { previewRequestId: storageFixtureIds.request, expectedPolicyVersion: 1, mode: "MANUAL_ALL" };
const confirmInput = { previewId: storageFixtureIds.job, requestId: storageFixtureIds.request, expectedPolicyVersion: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ id: "trusted-admin" });
  mocks.overview.mockResolvedValue(storageOverview());
  mocks.policy.mockResolvedValue(storagePolicy({ version: 2 }));
  mocks.preview.mockResolvedValue(cleanupPreview());
  mocks.confirm.mockResolvedValue(cleanupJob());
  mocks.job.mockResolvedValue(cleanupJob());
  mocks.cancel.mockResolvedValue(cleanupJob({ state: "CANCELLED" }));
});

const endpoints = [
  ["overview", () => overview()],
  ["policy", () => policy(request(policyInput, "PATCH"))],
  ["preview", () => preview(request(previewInput))],
  ["confirm", () => confirm(request(confirmInput))],
  ["job", () => job(new Request(url), context)],
  ["cancel", () => cancel(request({ requestId: storageFixtureIds.request }), context)],
] as const;

describe("image storage administration API", () => {
  it.each(endpoints)("requires a current admin before %s", async (_name, call) => {
    mocks.admin.mockRejectedValueOnce(new Error("请先登录"));
    let response = await call();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "STORAGE_UNAUTHENTICATED", error: "请先登录" });
    mocks.admin.mockRejectedValueOnce(new Error("没有管理员权限"));
    response = await call();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "STORAGE_FORBIDDEN", error: "没有管理员权限" });
    for (const query of [mocks.overview, mocks.policy, mocks.preview, mocks.confirm, mocks.job, mocks.cancel]) expect(query).not.toHaveBeenCalled();
  });

  it("returns exact decimal usage and safe deployment summary without cache", async () => {
    const response = await overview();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).data).toMatchObject({ usedBytes: "2306867200", reservedBytes: "104857600", unmanagedImageCount: "7", managedEnabled: true, writeBackend: "local" });
  });

  it.each([
    { limitBytes: "5000000000\n" }, { limitBytes: "9007199254740992" }, { limitBytes: "05" },
    { retentionDays: 0 }, { retentionDays: 3651 }, { intervalSeconds: 59 }, { storagePath: "E:/private" },
  ])("rejects invalid policy input without updating: %j", async (change) => {
    const response = await policy(request({ ...policyInput, ...change }, "PATCH"));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("IMAGE_INVALID_INPUT");
    expect(mocks.policy).not.toHaveBeenCalled();
  });

  it("keeps policy CAS and expired preview conflicts explicit", async () => {
    mocks.policy.mockRejectedValueOnce(new ImageStorageError("IMAGE_POLICY_CONFLICT"));
    const policyResponse = await policy(request(policyInput, "PATCH"));
    expect(policyResponse.status).toBe(409);
    expect((await policyResponse.json()).code).toBe("IMAGE_POLICY_CONFLICT");
    mocks.confirm.mockRejectedValueOnce(new ImageStorageError("IMAGE_PREVIEW_EXPIRED"));
    const confirmation = await confirm(request(confirmInput));
    expect(confirmation.status).toBe(409);
    expect((await confirmation.json()).code).toBe("IMAGE_PREVIEW_EXPIRED");
  });

  it("binds preview and confirmation to the authenticated actor and existing snapshot", async () => {
    expect((await preview(request({ ...previewInput, actorId: "another-user" }))).status).toBe(400);
    expect((await preview(request(previewInput))).status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith({ ...previewInput, actorId: "trusted-admin" });
    const response = await confirm(request(confirmInput));
    expect(response.status).toBe(200);
    expect((await response.json()).data.id).toBe(storageFixtureIds.job);
    expect(mocks.confirm).toHaveBeenCalledWith({ ...confirmInput, actorId: "trusted-admin" });
    expect((await confirm(request({ ...confirmInput, objectIds: [storageFixtureIds.asset] }))).status).toBe(400);
  });

  it("bounds job pagination, reports missing jobs and keeps cancellation idempotency", async () => {
    expect((await job(new Request(`${url}?limit=101`), context)).status).toBe(400);
    mocks.job.mockResolvedValueOnce(null);
    const response = await job(new Request(url), context);
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("IMAGE_MAINTENANCE_NOT_FOUND");
    const stopped = await cancel(request({ requestId: storageFixtureIds.request }), context);
    expect((await stopped.json()).data.state).toBe("CANCELLED");
    expect(mocks.cancel).toHaveBeenCalledWith({ actorId: "trusted-admin", jobId: storageFixtureIds.job, requestId: storageFixtureIds.request });
  });

  it("does not publish database or storage exception details", async () => {
    mocks.overview.mockRejectedValueOnce(new Error("SELECT secret FROM private; E:/private/media; postgres://private-password"));
    const response = await overview();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "IMAGE_STORAGE_UNAVAILABLE", error: "存储管理暂不可用，请稍后重试" });
  });
});
