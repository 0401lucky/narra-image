import { readFileSync } from "node:fs";

import schema from "../../../../contracts/canvas/v1/schema.json";
import type { CanvasErrorCode } from "@/lib/canvas/contracts";

const migration = readFileSync(new URL(`../../../../prisma/migrations/${schema.migration}/migration.sql`, import.meta.url), "utf8");
const raise = /CREATE FUNCTION canvas_raise\b[\s\S]*?AS \$\$([\s\S]*?)\$\$;/.exec(migration)?.[1];
const sqlState = /ERRCODE\s*=\s*'([A-Z0-9]{5})'/.exec(raise ?? "")?.[1];
if (!sqlState) throw new Error("The canvas_raise SQLSTATE must come from the actual migration");

export const canvasGuardSqlState = sqlState;

export function canvasRawGuardError(code: CanvasErrorCode) {
  return { code: "P2010", meta: { code: canvasGuardSqlState, message: code } };
}
