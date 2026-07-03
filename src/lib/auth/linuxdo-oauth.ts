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

const oauthUserSelect = {
  avatarUrl: true,
  credits: true,
  email: true,
  id: true,
  nickname: true,
  role: true,
} as const;

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

export type FindOrCreateOAuthInput = {
  ldUser: LinuxDoUser;
  inviteCode?: string | null;
};

type OAuthUser = {
  avatarUrl: string | null;
  credits: number;
  email: string;
  id: string;
  nickname: string | null;
  role: "USER" | "ADMIN";
};

export type FindOrCreateOAuthResult =
  | { ok: true; user: OAuthUser }
  | { ok: false; reason: "invite_required" | "invite_invalid" };

export async function findOrCreateOAuthUser(
  input: FindOrCreateOAuthInput,
): Promise<FindOrCreateOAuthResult> {
  const { ldUser } = input;
  const inviteCode = input.inviteCode?.trim() || null;
  const oauthId = String(ldUser.id);
  const avatarUrl = ldUser.avatar_url ? buildAvatarUrl(ldUser.avatar_url) : null;

  // 先查找已有 OAuth 绑定（老用户登录路径，跳过邀请码）
  const existingOAuth = await db.user.findFirst({
    where: {
      oauthProvider: "linuxdo",
      oauthId,
    },
    // 兼容历史脏数据：如果线上已经存在重复绑定，优先取最早的一条。
    orderBy: { createdAt: "asc" },
    select: oauthUserSelect,
  });

  if (existingOAuth) {
    const updated = await db.user.update({
      where: { id: existingOAuth.id },
      data: {
        ...(ldUser.name && !existingOAuth.nickname ? { nickname: ldUser.name } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
      },
      select: oauthUserSelect,
    });
    return { ok: true, user: updated as OAuthUser };
  }

  // 使用 linuxdo 用户名生成一个占位邮箱
  const email = `${ldUser.username}@linuxdo.oauth`;

  // 邮箱已存在但未绑定 OAuth：视作绑定路径，跳过邀请码（防御性兼容历史数据）
  const existingEmail = await db.user.findUnique({
    where: { email },
    select: { id: true, nickname: true },
  });

  if (existingEmail) {
    const updated = await db.user.update({
      where: { id: existingEmail.id },
      data: {
        oauthProvider: "linuxdo",
        oauthId,
        ...(ldUser.name && !existingEmail.nickname ? { nickname: ldUser.name } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
      },
      select: oauthUserSelect,
    });
    return { ok: true, user: updated as OAuthUser };
  }

  // 全新用户：必须有有效邀请码
  if (!inviteCode) {
    return { ok: false, reason: "invite_required" };
  }

  // 事务内先条件占用邀请码再创建用户：Read Committed 下事务包裹本身挡不住写覆盖，
  // 必须靠 updateMany 的 usedAt:null 条件保证并发下一码只进一人
  return db.$transaction(async (tx) => {
    const invite = await tx.inviteCode.findUnique({
      where: { code: inviteCode },
      select: { id: true, usedAt: true },
    });

    if (!invite || invite.usedAt) {
      return { ok: false as const, reason: "invite_invalid" as const };
    }

    const claimed = await tx.inviteCode.updateMany({
      where: { id: invite.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (claimed.count === 0) {
      return { ok: false as const, reason: "invite_invalid" as const };
    }

    const newUser = await tx.user.create({
      data: {
        avatarUrl,
        credits: DEFAULT_INITIAL_CREDITS,
        email,
        nickname: ldUser.name || ldUser.username,
        oauthId,
        oauthProvider: "linuxdo",
      },
      select: oauthUserSelect,
    });

    await tx.inviteCode.update({
      where: { id: invite.id },
      data: { usedById: newUser.id },
    });

    return { ok: true as const, user: newUser as OAuthUser };
  });
}

export async function getLinuxDoConfig() {
  return getOAuthProvider("linuxdo");
}
