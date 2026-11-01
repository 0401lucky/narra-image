import "server-only";

import { canvasClientIdSchema, canvasKeysetCursorPayloadSchema, canvasPageQuerySchema } from "@/lib/validators";
import { CanvasContractError } from "./contracts";
import { parseCanvasInput } from "./http";

export type CanvasCursorScope = { ownerId: string; scope: "canvas" | "conversation"; parentId: string | null };
export type CanvasKeyset = { at: Date; id: string };

export function encodeCanvasCursor(scope: CanvasCursorScope, key: CanvasKeyset): string {
  const id = scope.scope === "canvas" ? parseCanvasInput(canvasClientIdSchema, key.id) : key.id;
  const payload = parseCanvasInput(canvasKeysetCursorPayloadSchema, { schemaVersion: 1, ...scope, at: key.at.toISOString(), id });
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCanvasCursor(cursor: string, scope: CanvasCursorScope): CanvasKeyset {
  try {
    if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("invalid cursor");
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw new Error("noncanonical cursor");
    const value = canvasKeysetCursorPayloadSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (value.ownerId !== scope.ownerId || value.scope !== scope.scope || value.parentId !== scope.parentId) throw new Error("cursor scope mismatch");
    const at = new Date(value.at);
    if (!Number.isFinite(at.getTime()) || at.toISOString() !== value.at) throw new Error("invalid cursor date");
    const id = scope.scope === "canvas" ? canvasClientIdSchema.parse(value.id) : value.id;
    return { at, id };
  } catch {
    throw new CanvasContractError("CANVAS_INVALID_INPUT");
  }
}

export function parseCanvasPageQuery(url: string, scope: CanvasCursorScope): { limit: number; key: CanvasKeyset | null } {
  const params = new URL(url).searchParams;
  const input: Record<string, string> = {};
  for (const [name, value] of params) {
    if (Object.hasOwn(input, name)) throw new CanvasContractError("CANVAS_INVALID_INPUT");
    Object.defineProperty(input, name, { value, enumerable: true });
  }
  const page = parseCanvasInput(canvasPageQuerySchema, input);
  return { limit: page.limit, key: page.cursor ? decodeCanvasCursor(page.cursor, scope) : null };
}
