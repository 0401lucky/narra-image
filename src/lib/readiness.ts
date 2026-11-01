import "server-only";

import { getEnv, type RuntimeEnvironment } from "@/lib/env";
import { stringifyLogRecord } from "@/lib/logging/redact";
import { CANVAS_CAPABILITY_CONTRACT } from "@/lib/canvas/contracts";
import type { CanvasSchemaCatalogRowV1 } from "@/lib/canvas/schema-probe";

export const READINESS_SCHEMA_VERSION = 1;

export type ApplicationReadinessCode =
  | "READY"
  | "CONFIG_INVALID"
  | "CANVAS_SCHEMA_CONTRACT_MISMATCH"
  | "CANVAS_STORAGE_CAPABILITY_INVALID"
  | "DATABASE_UNAVAILABLE"
  | "WORKER_NOT_READY"
  | "WORKER_UNAVAILABLE";

export type ApplicationReadinessResult =
  | { code: "READY"; ready: true }
  | { code: Exclude<ApplicationReadinessCode, "READY">; ready: false };

export type WorkerReadinessProbeResult =
  | { ready: true; canvas?: typeof CANVAS_CAPABILITY_CONTRACT.readyCapability }
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
> & Partial<Pick<RuntimeEnvironment, "CANVAS_ENABLED">>;

type ReadinessDependencies = {
  loadEnvironment: () => ReadinessEnvironment;
  logFailure: (record: Record<string, unknown>) => void;
  pingDatabase: (timeoutMs: number) => Promise<void>;
  probeCanvasSchema: (timeoutMs: number) => Promise<boolean>;
  probeCanvasStorage: (timeoutMs: number) => Promise<void>;
  probeWorker: (input: {
    baseUrl: string;
    timeoutMs: number;
    requireCanvas?: boolean;
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

export async function probeApplicationCanvasStorage(timeoutMs: number): Promise<void> {
  const { createCanvasStorageAdapter, verifyCanvasStorageCapability } = await import("@/lib/canvas/storage");
  const storage = createCanvasStorageAdapter();
  try { await verifyCanvasStorageCapability(storage, storage.location, timeoutMs); }
  finally { storage.close?.(); }
}

function defaultLogFailure(record: Record<string, unknown>) {
  console.error(stringifyLogRecord(record));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanvasReadyCapability(value: unknown): boolean {
  const expected = CANVAS_CAPABILITY_CONTRACT.readyCapability;
  return isObject(value) && Object.keys(value).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, field]) => value[key] === field);
}

function readCanvasReadyCapability(payload: unknown) {
  let value = payload;
  for (const key of CANVAS_CAPABILITY_CONTRACT.readyCapabilityPath) {
    if (!isObject(value)) return undefined;
    value = value[key];
  }
  return isCanvasReadyCapability(value) ? CANVAS_CAPABILITY_CONTRACT.readyCapability : undefined;
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
      if (input.requireCanvas) {
        const canvas = readCanvasReadyCapability(payload);
        return canvas ? { ready: true, canvas } : {
          kind: "not_ready", ready: false, upstreamCode: "CANVAS_CAPABILITY_MISMATCH",
        };
      }
      return { ready: true };
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

  if (env.CANVAS_ENABLED) {
    try {
      if (!await dependencies.probeCanvasSchema(DATABASE_READINESS_TIMEOUT_MS)) {
        return reportFailure(dependencies, "CANVAS_SCHEMA_CONTRACT_MISMATCH");
      }
    } catch (cause) {
      return reportFailure(dependencies, "CANVAS_SCHEMA_CONTRACT_MISMATCH", { cause });
    }
    try {
      await dependencies.probeCanvasStorage(env.WORKER_READINESS_TIMEOUT_MS);
    } catch (cause) {
      return reportFailure(dependencies, "CANVAS_STORAGE_CAPABILITY_INVALID", { cause });
    }
  }

  if (!env.WORKER_READINESS_REQUIRED && !env.CANVAS_ENABLED) {
    return { code: "READY", ready: true };
  }

  const worker = await dependencies.probeWorker({
    baseUrl: env.WORKER_INTERNAL_URL,
    timeoutMs: env.WORKER_READINESS_TIMEOUT_MS,
    ...(env.CANVAS_ENABLED ? { requireCanvas: true } : {}),
  });
  if (worker.ready) {
    if (env.CANVAS_ENABLED && !isCanvasReadyCapability(worker.canvas)) {
      return reportFailure(dependencies, "WORKER_NOT_READY", { upstream_error_code: "CANVAS_CAPABILITY_MISMATCH" });
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
