import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  buildLinuxDoAuthorizeUrl,
  getLinuxDoCallbackUrl,
  getLinuxDoConfig,
} from "@/lib/auth/linuxdo-oauth";
import { getEnv } from "@/lib/env";

const OAUTH_STATE_COOKIE = "linuxdo_oauth_state";
const OAUTH_INVITE_COOKIE = "linuxdo_invite_code";

export async function GET(request: Request) {
  const isProduction = getEnv().NODE_ENV === "production";
  const config = await getLinuxDoConfig();
  if (!config || !config.isEnabled) {
    return NextResponse.json({ error: "LinuxDo 登录未启用" }, { status: 400 });
  }

  const url = new URL(request.url);
  const inviteCode = url.searchParams.get("inviteCode")?.trim() || "";

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
    secure: isProduction,
  });

  // 携带邀请码到 callback：仅新用户首次绑定时使用，老用户登录会被忽略
  if (inviteCode) {
    cookieStore.set(OAUTH_INVITE_COOKIE, inviteCode, {
      httpOnly: true,
      maxAge: 600, // 10 分钟，覆盖第三方授权耗时
      path: "/",
      sameSite: "lax",
      secure: isProduction,
    });
  } else {
    cookieStore.delete(OAUTH_INVITE_COOKIE);
  }

  return response;
}
