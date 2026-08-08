import { NextResponse } from "next/server";

import {
  READINESS_SCHEMA_VERSION,
  checkApplicationReadiness,
} from "@/lib/readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const result = await checkApplicationReadiness();
  return NextResponse.json(
    {
      code: result.code,
      generated_at: new Date().toISOString(),
      schema_version: READINESS_SCHEMA_VERSION,
      status: result.ready ? "ready" : "not_ready",
    },
    {
      headers: { "Cache-Control": "no-store" },
      status: result.ready ? 200 : 503,
    },
  );
}
