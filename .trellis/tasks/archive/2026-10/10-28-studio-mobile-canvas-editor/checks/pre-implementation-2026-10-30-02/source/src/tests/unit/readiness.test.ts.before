import { describe, expect, it, vi } from "vitest";

import {
  checkApplicationReadiness,
  probeWorkerReadiness,
} from "@/lib/readiness";

function readinessEnv(
  overrides: Partial<{
    WORKER_INTERNAL_URL: string;
    WORKER_READINESS_REQUIRED: boolean;
    WORKER_READINESS_TIMEOUT_MS: number;
  }> = {},
) {
  return {
    WORKER_INTERNAL_URL: "http://worker:8081",
    WORKER_READINESS_REQUIRED: true,
    WORKER_READINESS_TIMEOUT_MS: 2000,
    ...overrides,
  };
}

describe("Next 应用就绪检查", () => {
  it("配置无效时返回稳定错误码", async () => {
    const logFailure = vi.fn();
    const result = await checkApplicationReadiness({
      loadEnvironment: () => {
        throw new Error("invalid config");
      },
      logFailure,
    });

    expect(result).toEqual({ code: "CONFIG_INVALID", ready: false });
    expect(logFailure).toHaveBeenCalledWith(expect.objectContaining({
      error_code: "CONFIG_INVALID",
      event: "readiness_check_failed",
    }));
  });

  it("数据库不可用时不探测 Worker", async () => {
    const probeWorker = vi.fn();
    const result = await checkApplicationReadiness({
      loadEnvironment: () => readinessEnv(),
      logFailure: vi.fn(),
      pingDatabase: vi.fn().mockRejectedValue(new Error("database down")),
      probeWorker,
    });

    expect(result).toEqual({ code: "DATABASE_UNAVAILABLE", ready: false });
    expect(probeWorker).not.toHaveBeenCalled();
  });

  it("可显式关闭 Worker 就绪依赖", async () => {
    const probeWorker = vi.fn();
    const result = await checkApplicationReadiness({
      loadEnvironment: () => readinessEnv({ WORKER_READINESS_REQUIRED: false }),
      logFailure: vi.fn(),
      pingDatabase: vi.fn().mockResolvedValue(undefined),
      probeWorker,
    });

    expect(result).toEqual({ code: "READY", ready: true });
    expect(probeWorker).not.toHaveBeenCalled();
  });

  it("Worker ready 时使用统一内部地址和单次超时", async () => {
    const probeWorker = vi.fn().mockResolvedValue({ ready: true });
    const result = await checkApplicationReadiness({
      loadEnvironment: () => readinessEnv(),
      logFailure: vi.fn(),
      pingDatabase: vi.fn().mockResolvedValue(undefined),
      probeWorker,
    });

    expect(result).toEqual({ code: "READY", ready: true });
    expect(probeWorker).toHaveBeenCalledWith({
      baseUrl: "http://worker:8081",
      timeoutMs: 2000,
    });
  });

  it("Worker 返回非 ready 状态时只暴露稳定应用错误码", async () => {
    const logFailure = vi.fn();
    const result = await checkApplicationReadiness({
      loadEnvironment: () => readinessEnv(),
      logFailure,
      pingDatabase: vi.fn().mockResolvedValue(undefined),
      probeWorker: vi.fn().mockResolvedValue({
        kind: "not_ready",
        ready: false,
        upstreamCode: "SCHEMA_NOT_READY",
      }),
    });

    expect(result).toEqual({ code: "WORKER_NOT_READY", ready: false });
    expect(logFailure).toHaveBeenCalledWith(expect.objectContaining({
      error_code: "WORKER_NOT_READY",
      upstream_error_code: "SCHEMA_NOT_READY",
    }));
  });

  it("Worker 请求失败时区分为不可用", async () => {
    const result = await checkApplicationReadiness({
      loadEnvironment: () => readinessEnv(),
      logFailure: vi.fn(),
      pingDatabase: vi.fn().mockResolvedValue(undefined),
      probeWorker: vi.fn().mockResolvedValue({
        cause: new Error("connection refused"),
        kind: "unavailable",
        ready: false,
      }),
    });

    expect(result).toEqual({ code: "WORKER_UNAVAILABLE", ready: false });
  });
});

describe("Worker readyz 协议", () => {
  it("仅以 HTTP 200 且 status=ready 判定成功，并忽略扩展字段", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "ready",
      worker_id: "worker-1",
      future_field: { enabled: true },
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }));

    await expect(probeWorkerReadiness({
      baseUrl: "http://worker:8081",
      fetchImpl,
      timeoutMs: 2000,
    })).resolves.toEqual({ ready: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("http://worker:8081/readyz"),
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
  });

  it("HTTP 200 但状态不是 ready 时拒绝假绿", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "ok",
    }), { status: 200 }));

    await expect(probeWorkerReadiness({
      baseUrl: "http://worker:8081",
      fetchImpl,
      timeoutMs: 2000,
    })).resolves.toEqual({
      kind: "not_ready",
      ready: false,
      upstreamCode: undefined,
    });
  });

  it("保留 Worker 稳定错误码用于内部日志", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "DRAINING",
      status: "not_ready",
    }), { status: 503 }));

    await expect(probeWorkerReadiness({
      baseUrl: "http://worker:8081",
      fetchImpl,
      timeoutMs: 2000,
    })).resolves.toEqual({
      kind: "not_ready",
      ready: false,
      upstreamCode: "DRAINING",
    });
  });
});
