import "server-only";

import { Role } from "@prisma/client";

import { db } from "@/lib/db";
import { readSession } from "@/lib/auth/session";

export async function getCurrentUserRecord() {
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
