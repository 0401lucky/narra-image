import "server-only";

import { db } from "@/lib/db";
import { DEFAULT_INITIAL_CREDITS } from "@/lib/constants";
import { getOAuthProvider } from "@/lib/auth/oauth-config";
import { getEnv } from "@/lib/env";

const LINUXDO_AUTHORIZE_URL = "https://connect.linux.do/oauth2/authorize";
const LINUXDO_TOKEN_URL = "https://connect.linux.do/oauth2/token";
const LINUXDO_USER_URL = "https://connect.linux.do/api/user";

export type LinuxDoUser = {
  id: number;
  username: string;
  name: string;
  avatar_url: string;
  trust_level: number;
  active: boolean;
  silenced: boolean;
};

export function buildLinuxDoAuthorizeUrl(clientId: string, redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `${LINUXDO_AUTHORIZE_URL}?${params.toString()}`;
}

export function getLinuxDoCallbackUrl() {
  return `${getEnv().APP_URL}/api/auth/oauth/linuxdo/callback`;
}

export async function exchangeLinuxDoToken(code: string, clientId: string, clientSecret: string, redirectUri: string) {
  const response = await fetch(LINUXDO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LinuxDo token exchange failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { access_token: string; token_type: string };
  return data.access_token;
}

export async function fetchLinuxDoUser(accessToken: string): Promise<LinuxDoUser> {
  const response = await fetch(LINUXDO_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`LinuxDo user fetch failed: ${response.status}`);
  }

  return response.json() as Promise<LinuxDoUser>;
}

/**
 * 构建 LinuxDo 头像完整 URL
 * avatar_url 可能是完整 URL，也可能是 avatar_template 格式
 */
function buildAvatarUrl(avatarUrl: string): string {
  if (avatarUrl.startsWith("http")) {
    return avatarUrl;
  }
  // avatar_template 格式: /user_avatar/linux.do/username/{size}/xxx.png
  return `https://linux.do${avatarUrl.replace("{size}", "120")}`;
}

export async function findOrCreateOAuthUser(ldUser: LinuxDoUser) {
  // 先查找已有 OAuth 绑定
  const existingOAuth = await db.user.findUnique({
    where: {
      oauthProvider_oauthId: {
        oauthProvider: "linuxdo",
        oauthId: String(ldUser.id),
      },
    },
    select: {
      avatarUrl: true,
      credits: true,
      email: true,
      id: true,
      nickname: true,
      role: true,
    },
  });

  if (existingOAuth) {
    // 更新昵称和头像（如果用户在 LinuxDo 更新了）
    await db.user.update({
      where: { id: existingOAuth.id },
      data: {
        ...(ldUser.name && !existingOAuth.nickname ? { nickname: ldUser.name } : {}),
        ...(ldUser.avatar_url ? { avatarUrl: buildAvatarUrl(ldUser.avatar_url) } : {}),
      },
    });

    return existingOAuth;
  }

  // 使用 linuxdo 用户名生成一个占位邮箱
  const email = `${ldUser.username}@linuxdo.oauth`;

  // 检查邮箱是否已被注册（理论上不会，但防御性检查）
  const existingEmail = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingEmail) {
    // 绑定 OAuth 到已有邮箱账号
    const updated = await db.user.update({
      where: { id: existingEmail.id },
      data: {
        oauthProvider: "linuxdo",
        oauthId: String(ldUser.id),
        ...(ldUser.avatar_url ? { avatarUrl: buildAvatarUrl(ldUser.avatar_url) } : {}),
      },
      select: {
        avatarUrl: true,
        credits: true,
        email: true,
        id: true,
        nickname: true,
        role: true,
      },
    });
    return updated;
  }

  // 创建新用户
  const newUser = await db.user.create({
    data: {
      avatarUrl: ldUser.avatar_url ? buildAvatarUrl(ldUser.avatar_url) : null,
      credits: DEFAULT_INITIAL_CREDITS,
      email,
      nickname: ldUser.name || ldUser.username,
      oauthId: String(ldUser.id),
      oauthProvider: "linuxdo",
    },
    select: {
      avatarUrl: true,
      credits: true,
      email: true,
      id: true,
      nickname: true,
      role: true,
    },
  });

  return newUser;
}

export async function getLinuxDoConfig() {
  return getOAuthProvider("linuxdo");
}
