import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ success: true });
  return clearSessionCookie(response);
}
