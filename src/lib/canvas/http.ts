import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getEnv } from "@/lib/env";
import { stringifyLogRecord } from "@/lib/logging/redact";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { CANVAS_ERRORS, CanvasContractError, type CanvasApiErrorV1, type CanvasApiSuccessV1, type CanvasErrorCode } from "./contracts";
import { canvasDatabaseError } from "./transactions";

export function isCanvasEnabled(environment: { CANVAS_ENABLED?: boolean } = getEnv() as ReturnType<typeof getEnv> & { CANVAS_ENABLED?: boolean }): boolean {
  return environment.CANVAS_ENABLED === true;
}

export async function requireCanvasOwner(dependencies: {
  getUser?: () => Promise<{ id: string } | null>;
  enabled?: () => boolean;
} = {}): Promise<string> {
  const user = await (dependencies.getUser ?? getCurrentUserRecord)();
  if (!user) throw new CanvasContractError("CANVAS_UNAUTHENTICATED");
  if (!(dependencies.enabled ?? isCanvasEnabled)()) throw new CanvasContractError("CANVAS_DISABLED");
  return user.id;
}

export function parseCanvasInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  let code: CanvasErrorCode = "CANVAS_INVALID_INPUT";
  if (issue?.path.at(-1) === "schemaVersion") code = "CANVAS_VERSION_UNSUPPORTED";
  else if (issue?.code === "too_big") code = "CANVAS_LIMIT_EXCEEDED";
  else {
    const known = (Object.keys(CANVAS_ERRORS) as CanvasErrorCode[]).find((key) => CANVAS_ERRORS[key].userMessage === issue?.message);
    if (known) code = known;
  }
  throw new CanvasContractError(code);
}

export function canvasJson<T>(data: T, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "private, no-store");
  return NextResponse.json({ data } satisfies CanvasApiSuccessV1<T>, { status, headers: responseHeaders });
}

export function canvasErrorResponse(error: unknown) {
  const known = error instanceof CanvasContractError ? error : canvasDatabaseError(error);
  const failure = known ?? new CanvasContractError("CANVAS_INTERNAL_ERROR");
  if (!known) {
    // Do not log query text, input snapshots, or arbitrary adapter error objects.
    console.error(stringifyLogRecord({ event: "canvas.request.failed", code: failure.code }));
  }
  return NextResponse.json({ code: failure.code, error: failure.message } satisfies CanvasApiErrorV1, {
    status: failure.status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function withCanvasOwner(operation: (ownerId: string) => Promise<Response>): Promise<Response> {
  try {
    return await operation(await requireCanvasOwner());
  } catch (error) {
    return canvasErrorResponse(error);
  }
}
