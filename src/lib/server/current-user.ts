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

  return db.user.findUnique({
    where: { id: session.userId },
    select: {
      avatarUrl: true,
      credits: true,
      email: true,
      id: true,
      nickname: true,
      role: true,
    },
  });
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
