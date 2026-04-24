import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  exchangeLinuxDoToken,
  fetchLinuxDoUser,
  findOrCreateOAuthUser,
  getLinuxDoCallbackUrl,
  getLinuxDoConfig,
} from "@/lib/auth/linuxdo-oauth";
import { attachSessionCookie } from "@/lib/auth/session";
import { fromPrismaRole } from "@/lib/prisma-mappers";
import { getEnv } from "@/lib/env";
import { Role } from "@prisma/client";

const OAUTH_STATE_COOKIE = "linuxdo_oauth_state";

export async function GET(request: Request) {
  const appUrl = getEnv().APP_URL;

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return NextResponse.redirect(`${appUrl}/login?error=缺少授权参数`);
    }

    // 验证 state 防 CSRF
    const cookieStore = await cookies();
    const savedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
    cookieStore.delete(OAUTH_STATE_COOKIE);

    if (!savedState || savedState !== state) {
      return NextResponse.redirect(`${appUrl}/login?error=授权状态验证失败`);
    }

    const config = await getLinuxDoConfig();
    if (!config || !config.isEnabled) {
      return NextResponse.redirect(`${appUrl}/login?error=LinuxDo登录未启用`);
    }

    const redirectUri = getLinuxDoCallbackUrl();

    // 换取 access_token
    const accessToken = await exchangeLinuxDoToken(
      code,
      config.clientId,
      config.clientSecret,
      redirectUri,
    );

    // 获取用户信息
    const ldUser = await fetchLinuxDoUser(accessToken);

    if (!ldUser.active) {
      return NextResponse.redirect(`${appUrl}/login?error=LinuxDo账号未激活`);
    }

    // 查找或创建用户
    const user = await findOrCreateOAuthUser(ldUser);

    // 设置 session
    const response = NextResponse.redirect(`${appUrl}/create`);
    await attachSessionCookie(response, {
      role: fromPrismaRole(user.role as Role),
      userId: user.id,
    });

    return response;
  } catch (error) {
    console.error("LinuxDo OAuth callback error:", error);
    return NextResponse.redirect(`${appUrl}/login?error=第三方登录失败`);
  }
}
