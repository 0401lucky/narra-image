import "server-only";

import { getEnv, type RuntimeEnvironment } from "@/lib/env";
import { stringifyLogRecord } from "@/lib/logging/redact";
import { CANVAS_CAPABILITY_CONTRACT, type CanvasWorkerCapabilityV2 } from "@/lib/canvas/contracts";
import { canvasWorkerCapabilitySchema } from "@/lib/validators";
import type { ImageReadyCapability } from "@/lib/storage/managed-image-storage";
import type { CanvasSchemaCatalogRowV1 } from "@/lib/canvas/schema-probe";
import { IMAGE_STORAGE_REVISION, IMAGE_READER_REVISION, IMAGE_MAINTENANCE_REVISION } from "@/lib/storage/image-maintenance-types";

export const READINESS_SCHEMA_VERSION = 1;

export type ApplicationReadinessCode =
  | "READY"
  | "CONFIG_INVALID"
  | "CANVAS_SCHEMA_CONTRACT_MISMATCH"
  | "CANVAS_STORAGE_CAPABILITY_INVALID"
  | "IMAGE_STORAGE_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
  | "WORKER_NOT_READY"
  | "WORKER_UNAVAILABLE";

export type ApplicationReadinessResult =
  | { code: "READY"; ready: true }
  | { code: Exclude<ApplicationReadinessCode, "READY">; ready: false };

export type WorkerReadinessProbeResult =
  | { ready: true; canvas?: CanvasWorkerCapabilityV2; images?: ImageReadyCapability }
  | {
      cause?: unknown;
      kind: "not_ready" | "unavailable";
      ready: false;
      upstreamCode?: string;
    };

type ReadinessEnvironment = Pick<
  RuntimeEnvironment,
  | "WORKER_INTERNAL_URL"
  | "WORKER_READINESS_REQUIRED"
  | "WORKER_READINESS_TIMEOUT_MS"
> & Partial<Pick<RuntimeEnvironment, "CANVAS_ENABLED" | "IMAGE_STORAGE_MANAGED_ENABLED">>;

type ReadinessDependencies = {
  loadEnvironment: () => ReadinessEnvironment;
  logFailure: (record: Record<string, unknown>) => void;
  pingDatabase: (timeoutMs: number) => Promise<void>;
  probeCanvasSchema: (timeoutMs: number) => Promise<boolean>;
  probeCanvasStorage: (timeoutMs: number) => Promise<CanvasWorkerCapabilityV2>;
  probeImageStorage: (timeoutMs: number) => Promise<ImageReadyCapability>;
  probeWorker: (input: {
    baseUrl: string;
    timeoutMs: number;
    requireCanvas?: boolean;
    requireImages?: boolean;
    expectedCanvas?: CanvasWorkerCapabilityV2;
    expectedImages?: ImageReadyCapability;
  }) => Promise<WorkerReadinessProbeResult>;
};

const DATABASE_READINESS_TIMEOUT_MS = 2_000;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function pingApplicationDatabase(timeoutMs: number) {
  const { db } = await import("@/lib/db");
  await withTimeout(db.$queryRawUnsafe("SELECT 1"), timeoutMs, "数据库就绪检查");
}

export async function probeApplicationCanvasSchema(timeoutMs: number): Promise<boolean> {
  const [{ db }, { probeCanvasSchemaV1 }] = await Promise.all([
    import("@/lib/db"), import("@/lib/canvas/schema-probe"),
  ]);
  const report = await withTimeout(db.$transaction(async (tx) => {
    // Bound the server-side catalogue query too, not only the HTTP waiter.
    await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`;
    return probeCanvasSchemaV1((sql) => tx.$queryRawUnsafe<CanvasSchemaCatalogRowV1[]>(sql));
  }, { maxWait: timeoutMs, timeout: timeoutMs }), timeoutMs, "Canvas schema readiness");
  return report.ready;
}

export async function probeApplicationCanvasStorage(timeoutMs: number): Promise<CanvasWorkerCapabilityV2> {
  const { createCanvasStorageAdapter, verifyCanvasStorageCapability, canvasStorageReadyCapability } = await import("@/lib/canvas/storage");
  const storage = createCanvasStorageAdapter();
  try { await verifyCanvasStorageCapability(storage, storage.location, timeoutMs); return canvasStorageReadyCapability(storage.location); }
  finally { storage.close?.(); }
}

export async function probeApplicationImageStorage(timeoutMs: number): Promise<ImageReadyCapability> {
  const { verifyManagedImageStorage } = await import("@/lib/storage/managed-image-storage");
  return withTimeout(verifyManagedImageStorage(), timeoutMs, "Image storage readiness");
}

function defaultLogFailure(record: Record<string, unknown>) {
  console.error(stringifyLogRecord(record));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanvasReadyCapability(value: unknown): value is CanvasWorkerCapabilityV2 {
  return canvasWorkerCapabilitySchema.safeParse(value).success;
}

function sameCapability(actual: unknown, expected: unknown): boolean {
  return isObject(actual) && isObject(expected) && Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function readImageReadyCapability(payload: unknown): ImageReadyCapability | undefined {
  if (!isObject(payload) || !isObject(payload.capabilities)) return undefined;
  const value = payload.capabilities.images;
  if (!isObject(value) || Object.keys(value).length !== 8 || value.version !== 1 || value.schema !== "ready" || typeof value.locationId !== "string"
    || value.storageRevision !== IMAGE_STORAGE_REVISION || value.readerRevision !== IMAGE_READER_REVISION
    || value.executorRevision !== IMAGE_MAINTENANCE_REVISION || value.maintenance !== "running") return undefined;
  if (value.provider === "S3" && /^s3-v1:[0-9a-f]{64}(?![\s\S])/.test(value.locationId)) return value as ImageReadyCapability;
  if (value.provider === "LOCAL" && /^local-v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/.test(value.locationId)) return value as ImageReadyCapability;
  return undefined;
}

function readCanvasReadyCapability(payload: unknown) {
  let value = payload;
  for (const key of CANVAS_CAPABILITY_CONTRACT.readyCapabilityPath) {
    if (!isObject(value)) return undefined;
    value = value[key];
  }
  return isCanvasReadyCapability(value) ? value : undefined;
}

function readUpstreamCode(payload: unknown) {
  if (!isObject(payload) || typeof payload.code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(payload.code)) return undefined;
  return payload.code;
}

export async function probeWorkerReadiness(input: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  requireCanvas?: boolean;
  requireImages?: boolean;
  expectedCanvas?: CanvasWorkerCapabilityV2;
  expectedImages?: ImageReadyCapability;
}): Promise<WorkerReadinessProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const readyUrl = new URL("readyz", `${input.baseUrl.replace(/\/+$/, "")}/`);
  const controller = new AbortController();
  const operation = async (): Promise<WorkerReadinessProbeResult> => {
    const response = await fetchImpl(readyUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      method: "GET",
      signal: controller.signal,
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      return {
        cause,
        kind: "not_ready",
        ready: false,
      };
    }

    if (
      response.status === 200 &&
      isObject(payload) &&
      payload.status === "ready"
    ) {
      const canvas = input.requireCanvas ? readCanvasReadyCapability(payload) : undefined;
      const images = input.requireImages ? readImageReadyCapability(payload) : undefined;
      if (input.requireCanvas && (!canvas || (input.expectedCanvas && !sameCapability(canvas, input.expectedCanvas)))) {
        return {
          kind: "not_ready", ready: false, upstreamCode: "CANVAS_CAPABILITY_MISMATCH",
        };
      }
      if (input.requireImages && (!images || (input.expectedImages && !sameCapability(images, input.expectedImages)))) {
        return { kind: "not_ready", ready: false, upstreamCode: "IMAGE_CAPABILITY_MISMATCH" };
      }
      return { ready: true, ...(canvas ? { canvas } : {}), ...(images ? { images } : {}) };
    }

    return {
      kind: "not_ready",
      ready: false,
      upstreamCode: readUpstreamCode(payload),
    };
  };
  try {
    return await withTimeout(operation(), input.timeoutMs, "Worker readiness");
  } catch (cause) {
    return {
      cause,
      kind: "unavailable",
      ready: false,
    };
  } finally {
    controller.abort();
  }
}

const defaultDependencies: ReadinessDependencies = {
  loadEnvironment: getEnv,
  logFailure: defaultLogFailure,
  pingDatabase: pingApplicationDatabase,
  probeCanvasSchema: probeApplicationCanvasSchema,
  probeCanvasStorage: probeApplicationCanvasStorage,
  probeImageStorage: probeApplicationImageStorage,
  probeWorker: probeWorkerReadiness,
};

function reportFailure(
  dependencies: ReadinessDependencies,
  code: Exclude<ApplicationReadinessCode, "READY">,
  details: Record<string, unknown> = {},
) {
  dependencies.logFailure({
    component: "next",
    error_code: code,
    event: "readiness_check_failed",
    ...details,
  });
  return { code, ready: false } as const;
}

export async function checkApplicationReadiness(
  overrides: Partial<ReadinessDependencies> = {},
): Promise<ApplicationReadinessResult> {
  const dependencies = { ...defaultDependencies, ...overrides };

  let env: ReadinessEnvironment;
  try {
    env = dependencies.loadEnvironment();
  } catch (cause) {
    return reportFailure(dependencies, "CONFIG_INVALID", { cause });
  }

  try {
    await dependencies.pingDatabase(DATABASE_READINESS_TIMEOUT_MS);
  } catch (cause) {
    return reportFailure(dependencies, "DATABASE_UNAVAILABLE", { cause });
  }

  let expectedImages: ImageReadyCapability | undefined;
  let expectedCanvas: CanvasWorkerCapabilityV2 | undefined;
  if (env.IMAGE_STORAGE_MANAGED_ENABLED) {
    try { expectedImages = await dependencies.probeImageStorage(env.WORKER_READINESS_TIMEOUT_MS); }
    catch (cause) { return reportFailure(dependencies, "IMAGE_STORAGE_UNAVAILABLE", { cause }); }
  }
  if (env.CANVAS_ENABLED) {
    try {
      if (!await dependencies.probeCanvasSchema(DATABASE_READINESS_TIMEOUT_MS)) {
        return reportFailure(dependencies, "CANVAS_SCHEMA_CONTRACT_MISMATCH");
      }
    } catch (cause) {
      return reportFailure(dependencies, "CANVAS_SCHEMA_CONTRACT_MISMATCH", { cause });
    }
    try {
      expectedCanvas = await dependencies.probeCanvasStorage(env.WORKER_READINESS_TIMEOUT_MS);
    } catch (cause) {
      return reportFailure(dependencies, "CANVAS_STORAGE_CAPABILITY_INVALID", { cause });
    }
  }

  if (!env.WORKER_READINESS_REQUIRED && !env.CANVAS_ENABLED && !env.IMAGE_STORAGE_MANAGED_ENABLED) {
    return { code: "READY", ready: true };
  }

  const worker = await dependencies.probeWorker({
    baseUrl: env.WORKER_INTERNAL_URL,
    timeoutMs: env.WORKER_READINESS_TIMEOUT_MS,
    ...(env.CANVAS_ENABLED ? { requireCanvas: true, expectedCanvas } : {}),
    ...(env.IMAGE_STORAGE_MANAGED_ENABLED ? { requireImages: true, expectedImages } : {}),
  });
  if (worker.ready) {
    if (env.CANVAS_ENABLED && (!isCanvasReadyCapability(worker.canvas) || !sameCapability(worker.canvas, expectedCanvas))) {
      return reportFailure(dependencies, "WORKER_NOT_READY", { upstream_error_code: "CANVAS_CAPABILITY_MISMATCH" });
    }
    if (env.IMAGE_STORAGE_MANAGED_ENABLED && !sameCapability(worker.images, expectedImages)) {
      return reportFailure(dependencies, "WORKER_NOT_READY", { upstream_error_code: "IMAGE_CAPABILITY_MISMATCH" });
    }
    return { code: "READY", ready: true };
  }

  const code = worker.kind === "unavailable"
    ? "WORKER_UNAVAILABLE"
    : "WORKER_NOT_READY";
  return reportFailure(dependencies, code, {
    cause: worker.cause,
    upstream_error_code: worker.upstreamCode,
  });
}
