import { NextResponse } from "next/server";

import { READINESS_SCHEMA_VERSION } from "@/lib/readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(
    {
      generated_at: new Date().toISOString(),
      schema_version: READINESS_SCHEMA_VERSION,
      status: "ok",
    },
    {
      headers: { "Cache-Control": "no-store" },
      status: 200,
    },
  );
}
