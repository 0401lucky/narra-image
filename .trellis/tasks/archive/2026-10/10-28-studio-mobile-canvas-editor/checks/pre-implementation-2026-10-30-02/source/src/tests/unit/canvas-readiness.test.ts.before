import { beforeEach, describe, expect, it, vi } from "vitest";

const { transaction, execute, query, createStorage, verifyStorage, closeStorage } = vi.hoisted(() => ({
  transaction: vi.fn(), execute: vi.fn(), query: vi.fn(), createStorage: vi.fn(), verifyStorage: vi.fn(), closeStorage: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: transaction } }));
vi.mock("@/lib/canvas/storage", () => ({ createCanvasStorageAdapter: createStorage, verifyCanvasStorageCapability: verifyStorage }));

import { CANVAS_CAPABILITY_CONTRACT } from "@/lib/canvas/contracts";
import { CANVAS_SCHEMA_CONTRACT, CANVAS_SCHEMA_QUERY_V1 } from "@/lib/canvas/schema-probe";
import { checkApplicationReadiness, probeApplicationCanvasSchema, probeApplicationCanvasStorage, probeWorkerReadiness } from "@/lib/readiness";

const readyCapability = CANVAS_CAPABILITY_CONTRACT.readyCapability;
const environment = {
  CANVAS_ENABLED: true,
  WORKER_INTERNAL_URL: "http://worker:8081",
  WORKER_READINESS_REQUIRED: false,
  WORKER_READINESS_TIMEOUT_MS: 2000,
};

function enabledDependencies() {
  return {
    loadEnvironment: () => environment,
    logFailure: vi.fn(),
    pingDatabase: vi.fn().mockResolvedValue(undefined),
    probeCanvasSchema: vi.fn().mockResolvedValue(true),
    probeCanvasStorage: vi.fn().mockResolvedValue(undefined),
    probeWorker: vi.fn().mockResolvedValue({ ready: true, canvas: readyCapability }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue(1);
  query.mockResolvedValue(CANVAS_SCHEMA_CONTRACT.objects);
  transaction.mockImplementation(async (operation) => operation({ $executeRaw: execute, $queryRawUnsafe: query }));
  createStorage.mockReturnValue({ location: { id: "location", endpoint: "https://s3.example.invalid", region: "auto", bucket: "imports" }, close: closeStorage });
  verifyStorage.mockResolvedValue(undefined);
});

describe("enabled canvas readiness", () => {
  it("requires actual Node schema, own storage and the explicit Worker capability even when generic checks are disabled", async () => {
    const dependencies = enabledDependencies();
    await expect(checkApplicationReadiness(dependencies)).resolves.toEqual({ ready: true, code: "READY" });
    expect(dependencies.probeCanvasSchema).toHaveBeenCalledWith(2000);
    expect(dependencies.probeCanvasStorage).toHaveBeenCalledWith(2000);
    expect(dependencies.probeWorker).toHaveBeenCalledWith({ baseUrl: environment.WORKER_INTERNAL_URL, timeoutMs: 2000, requireCanvas: true });
  });

  it("does not trust an old/disabled worker's generic ready response", async () => {
    const dependencies = enabledDependencies();
    dependencies.probeWorker.mockResolvedValue({ ready: true });
    await expect(checkApplicationReadiness(dependencies)).resolves.toEqual({ ready: false, code: "WORKER_NOT_READY" });
  });

  it("rejects a live DB with a missing or changed canvas guard before storage/Worker probes", async () => {
    const dependencies = enabledDependencies();
    dependencies.probeCanvasSchema.mockResolvedValue(false);
    await expect(checkApplicationReadiness(dependencies)).resolves.toEqual({ ready: false, code: "CANVAS_SCHEMA_CONTRACT_MISMATCH" });
    expect(dependencies.probeCanvasStorage).not.toHaveBeenCalled();
    expect(dependencies.probeWorker).not.toHaveBeenCalled();
  });

  it.each(["schema", "storage"])("only returns safe codes for %s failures, without SQL, DSN or secrets", async (kind) => {
    const dependencies = enabledDependencies();
    const error = new Error("postgresql://operator:private@db/live?token=secret SELECT sensitive");
    if (kind === "schema") dependencies.probeCanvasSchema.mockRejectedValue(error);
    else dependencies.probeCanvasStorage.mockRejectedValue(error);
    const result = await checkApplicationReadiness(dependencies);
    expect(result).toEqual({ ready: false, code: kind === "schema" ? "CANVAS_SCHEMA_CONTRACT_MISMATCH" : "CANVAS_STORAGE_CAPABILITY_INVALID" });
    expect(JSON.stringify(result)).not.toMatch(/postgresql|SELECT|private|secret/);
    expect(dependencies.probeWorker).not.toHaveBeenCalled();
  });

  it("preserves feature-off readiness and never loads canvas dependencies", async () => {
    const dependencies = enabledDependencies();
    dependencies.loadEnvironment = () => ({ ...environment, CANVAS_ENABLED: false });
    await expect(checkApplicationReadiness(dependencies)).resolves.toEqual({ ready: true, code: "READY" });
    expect(dependencies.probeCanvasSchema).not.toHaveBeenCalled();
    expect(dependencies.probeCanvasStorage).not.toHaveBeenCalled();
    expect(dependencies.probeWorker).not.toHaveBeenCalled();
  });
});

describe("Worker canvas capability wire", () => {
  it("reads the shared capability location and exact v1 DTO", async () => {
    expect(CANVAS_CAPABILITY_CONTRACT.readyCapabilityPath).toEqual(["capabilities", "canvas"]);
    await expect(probeWorkerReadiness({
      baseUrl: environment.WORKER_INTERNAL_URL, requireCanvas: true, timeoutMs: 100,
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ status: "ready", capabilities: { canvas: readyCapability }, future: true })),
    })).resolves.toEqual({ ready: true, canvas: readyCapability });
  });

  it.each([
    {},
    { canvas: readyCapability },
    { capabilities: {} },
    { capabilities: { canvas: null } },
    { capabilities: { canvas: { ...readyCapability, version: 2 } } },
    { capabilities: { canvas: { ...readyCapability, version: "1" } } },
    { capabilities: { canvas: { ...readyCapability, schema: "missing" } } },
    { capabilities: { canvas: { ...readyCapability, storage: "suspended" } } },
    { capabilities: { canvas: { ...readyCapability, storage: "unknown" } } },
    { capabilities: { canvas: { ...readyCapability, gc: "stopped" } } },
    { capabilities: { canvas: { ...readyCapability, gc: "disabled" } } },
    { capabilities: { canvas: { ...readyCapability, privateExtension: true } } },
  ])("rejects absent, stale or mismatched capability %#", async (fields) => {
    await expect(probeWorkerReadiness({
      baseUrl: environment.WORKER_INTERNAL_URL, requireCanvas: true, timeoutMs: 100,
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ status: "ready", ...fields })),
    })).resolves.toEqual({ ready: false, kind: "not_ready", upstreamCode: "CANVAS_CAPABILITY_MISMATCH" });
  });

  it("bounds a fetch that ignores AbortSignal and aborts the underlying request", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    await expect(probeWorkerReadiness({ baseUrl: environment.WORKER_INTERNAL_URL, requireCanvas: true, timeoutMs: 10, fetchImpl })).resolves.toMatchObject({ ready: false, kind: "unavailable" });
    expect(signal?.aborted).toBe(true);
  });

  it("does not copy arbitrary upstream errors into diagnostic codes", async () => {
    await expect(probeWorkerReadiness({
      baseUrl: environment.WORKER_INTERNAL_URL, requireCanvas: true, timeoutMs: 100,
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ status: "not_ready", code: "postgresql://operator:secret@db/private" }, { status: 503 })),
    })).resolves.toEqual({ ready: false, kind: "not_ready", upstreamCode: undefined });
  });
});

describe("real readiness adapter composition with fake dependencies", () => {
  it("queries the actual shared catalog within a bounded transaction", async () => {
    await expect(probeApplicationCanvasSchema(2000)).resolves.toBe(true);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 2000, timeout: 2000 });
    expect(query).toHaveBeenCalledWith(CANVAS_SCHEMA_QUERY_V1);
    expect(execute).toHaveBeenCalled();
    query.mockResolvedValue(CANVAS_SCHEMA_CONTRACT.objects.slice(1));
    await expect(probeApplicationCanvasSchema(2000)).resolves.toBe(false);
  });

  it.each([false, true])("checks the Node adapter with the timeout and always closes it (failure=%s)", async (fail) => {
    if (fail) verifyStorage.mockRejectedValue(new Error("versioning unknown"));
    const operation = probeApplicationCanvasStorage(125);
    if (fail) await expect(operation).rejects.toThrow("versioning unknown");
    else await expect(operation).resolves.toBeUndefined();
    const adapter = createStorage.mock.results[0].value;
    expect(verifyStorage).toHaveBeenCalledWith(adapter, adapter.location, 125);
    expect(closeStorage).toHaveBeenCalledOnce();
  });
});
