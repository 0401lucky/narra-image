import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheckApplicationReadiness } = vi.hoisted(() => ({
  mockCheckApplicationReadiness: vi.fn(),
}));

vi.mock("@/lib/readiness", () => ({
  READINESS_SCHEMA_VERSION: 1,
  checkApplicationReadiness: mockCheckApplicationReadiness,
}));

import { GET as getHealth } from "@/app/api/healthz/route";
import { GET as getReady } from "@/app/api/readyz/route";

describe("Next healthz/readyz 路由", () => {
  beforeEach(() => {
    mockCheckApplicationReadiness.mockReset();
  });

  it("healthz 只返回进程存活，不触发依赖检查", async () => {
    const response = getHealth();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schema_version: 1,
      status: "ok",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockCheckApplicationReadiness).not.toHaveBeenCalled();
  });

  it("readyz 成功时返回 200", async () => {
    mockCheckApplicationReadiness.mockResolvedValue({ code: "READY", ready: true });

    const response = await getReady();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: "READY",
      schema_version: 1,
      status: "ready",
    });
  });

  it("readyz 失败时返回 503 和稳定错误码", async () => {
    mockCheckApplicationReadiness.mockResolvedValue({
      code: "WORKER_NOT_READY",
      ready: false,
    });

    const response = await getReady();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKER_NOT_READY",
      schema_version: 1,
      status: "not_ready",
    });
  });
});
