import "server-only";

import { cache } from "react";
import { Role } from "@prisma/client";

import { db } from "@/lib/db";
import { readSession } from "@/lib/auth/session";

export const getCurrentUserRecord = cache(async () => {
  const session = await readSession();
  if (!session) {
    return null;
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      avatarUrl: true,
      bannedAt: true,
      credits: true,
      email: true,
      id: true,
      nickname: true,
      oauthProvider: true,
      role: true,
    },
  });

  // 封禁用户按未登录处理：等效登出，无需等待 token 过期
  if (!user || user.bannedAt) {
    return null;
  }

  return user;
});

export const getCurrentSession = cache(async () => {
  return readSession();
});

export async function requireCurrentSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("请先登录");
  }
  return session;
}

export async function requireCurrentUserRecord() {
  const user = await getCurrentUserRecord();
  if (!user) {
    throw new Error("请先登录");
  }

  return user;
}

export async function requireAdminRecord() {
  const user = await requireCurrentUserRecord();
  if (user.role !== Role.ADMIN) {
    throw new Error("没有管理员权限");
  }

  return user;
}
