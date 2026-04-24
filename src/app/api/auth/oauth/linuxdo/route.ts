import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  buildLinuxDoAuthorizeUrl,
  getLinuxDoCallbackUrl,
  getLinuxDoConfig,
} from "@/lib/auth/linuxdo-oauth";

const OAUTH_STATE_COOKIE = "linuxdo_oauth_state";

export async function GET() {
  const config = await getLinuxDoConfig();
  if (!config || !config.isEnabled) {
    return NextResponse.json({ error: "LinuxDo 登录未启用" }, { status: 400 });
  }

  const state = randomUUID();
  const redirectUri = getLinuxDoCallbackUrl();
  const authorizeUrl = buildLinuxDoAuthorizeUrl(config.clientId, redirectUri, state);

  const response = NextResponse.redirect(authorizeUrl);

  // 存储 state 到 cookie 防 CSRF
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 300, // 5 分钟有效
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
