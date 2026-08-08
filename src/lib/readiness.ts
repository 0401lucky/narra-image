import "server-only";

import { getEnv, type RuntimeEnvironment } from "@/lib/env";
import { stringifyLogRecord } from "@/lib/logging/redact";

export const READINESS_SCHEMA_VERSION = 1;

export type ApplicationReadinessCode =
  | "READY"
  | "CONFIG_INVALID"
  | "DATABASE_UNAVAILABLE"
  | "WORKER_NOT_READY"
  | "WORKER_UNAVAILABLE";

export type ApplicationReadinessResult =
  | { code: "READY"; ready: true }
  | { code: Exclude<ApplicationReadinessCode, "READY">; ready: false };

export type WorkerReadinessProbeResult =
  | { ready: true }
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
>;

type ReadinessDependencies = {
  loadEnvironment: () => ReadinessEnvironment;
  logFailure: (record: Record<string, unknown>) => void;
  pingDatabase: (timeoutMs: number) => Promise<void>;
  probeWorker: (input: {
    baseUrl: string;
    timeoutMs: number;
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

function defaultLogFailure(record: Record<string, unknown>) {
  console.error(stringifyLogRecord(record));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readUpstreamCode(payload: unknown) {
  if (!isObject(payload) || typeof payload.code !== "string") return undefined;
  return payload.code.slice(0, 64);
}

export async function probeWorkerReadiness(input: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
}): Promise<WorkerReadinessProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const readyUrl = new URL("readyz", `${input.baseUrl.replace(/\/+$/, "")}/`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
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
      return { ready: true };
    }

    return {
      kind: "not_ready",
      ready: false,
      upstreamCode: readUpstreamCode(payload),
    };
  } catch (cause) {
    return {
      cause,
      kind: "unavailable",
      ready: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

const defaultDependencies: ReadinessDependencies = {
  loadEnvironment: getEnv,
  logFailure: defaultLogFailure,
  pingDatabase: pingApplicationDatabase,
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

  if (!env.WORKER_READINESS_REQUIRED) {
    return { code: "READY", ready: true };
  }

  const worker = await dependencies.probeWorker({
    baseUrl: env.WORKER_INTERNAL_URL,
    timeoutMs: env.WORKER_READINESS_TIMEOUT_MS,
  });
  if (worker.ready) {
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
