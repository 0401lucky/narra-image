import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  exchangeLinuxDoToken,
  fetchLinuxDoUser,
  findOrCreateOAuthUser,
  getLinuxDoCallbackUrl,
  getLinuxDoConfig,
  linkLinuxDoAccount,
} from "@/lib/auth/linuxdo-oauth";
import { attachSessionCookie, readSession } from "@/lib/auth/session";
import { fromPrismaRole } from "@/lib/prisma-mappers";
import { getEnv } from "@/lib/env";
import { Role } from "@prisma/client";

const OAUTH_STATE_COOKIE = "linuxdo_oauth_state";
const OAUTH_INVITE_COOKIE = "linuxdo_invite_code";

export async function GET(request: Request) {
  const appUrl = getEnv().APP_URL;

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return NextResponse.redirect(`${appUrl}/login?error=缺少授权参数`);
    }

    // 验证 state 防 CSRF；同时取出邀请码并清理 cookie
    const cookieStore = await cookies();
    const savedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
    const inviteCode = cookieStore.get(OAUTH_INVITE_COOKIE)?.value || null;
    cookieStore.delete(OAUTH_STATE_COOKIE);
    cookieStore.delete(OAUTH_INVITE_COOKIE);

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

    // 已登录态：把 LinuxDo 绑定到当前账号（个人设置发起）
    const session = await readSession();
    if (session) {
      const linkResult = await linkLinuxDoAccount({
        ldUser,
        userId: session.userId,
      });

      if (!linkResult.ok) {
        if (linkResult.reason === "banned") {
          // 封禁用户访问 /settings 会被 getCurrentUserRecord 拦截跳登录，错误需直接带到登录页
          return NextResponse.redirect(
            `${appUrl}/login?error=${encodeURIComponent("账号已被封禁")}`,
          );
        }
        const message =
          linkResult.reason === "conflict"
            ? "该 LinuxDo 账号已绑定其他 Narra 账号"
            : "绑定失败，请重试";
        return NextResponse.redirect(
          `${appUrl}/settings?error=${encodeURIComponent(message)}`,
        );
      }

      return NextResponse.redirect(`${appUrl}/settings?linked=linuxdo`);
    }

    // 未登录：查找或创建用户（新用户必须有有效邀请码）
    const result = await findOrCreateOAuthUser({ ldUser, inviteCode });
    if (!result.ok) {
      const message =
        result.reason === "invite_required"
          ? "首次使用 LinuxDo 登录需要填写邀请码"
          : result.reason === "banned"
            ? "账号已被封禁"
            : "邀请码已失效";
      return NextResponse.redirect(
        `${appUrl}/login?error=${encodeURIComponent(message)}`,
      );
    }

    // 设置 session
    const response = NextResponse.redirect(`${appUrl}/create`);
    await attachSessionCookie(response, {
      role: fromPrismaRole(result.user.role as Role),
      userId: result.user.id,
    });

    return response;
  } catch (error) {
    console.error("LinuxDo OAuth callback error:", error);
    return NextResponse.redirect(`${appUrl}/login?error=第三方登录失败`);
  }
}
