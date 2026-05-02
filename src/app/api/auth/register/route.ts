import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { DEFAULT_INITIAL_CREDITS } from "@/lib/constants";
import { attachSessionCookie } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { requireTurnstile } from "@/lib/auth/turnstile";
import { fromPrismaRole } from "@/lib/prisma-mappers";
import { parseJsonBody, getErrorMessage, jsonError } from "@/lib/server/http";
import { registerUser } from "@/lib/auth/register-user";
import { registerSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const body = registerSchema.parse(await parseJsonBody(request));
    await requireTurnstile("register", body.turnstileToken);
    const bootstrapInviteCode =
      process.env.BOOTSTRAP_INVITE_CODE?.trim() || "FOUNDING-ACCESS";

    await db.inviteCode.upsert({
      where: {
        code: bootstrapInviteCode,
      },
      update: {},
      create: {
        code: bootstrapInviteCode,
        note: "初始管理员邀请码",
      },
    });

    const result = await db.$transaction(async (tx) =>
      registerUser(body, {
        bootstrapAdminEmail: getEnv().BOOTSTRAP_ADMIN_EMAIL || undefined,
        initialCredits: DEFAULT_INITIAL_CREDITS,
        findUserByEmail: (email) =>
          tx.user.findUnique({
            where: { email },
            select: { email: true, id: true },
          }),
        findInviteByCode: (code) =>
          tx.inviteCode.findUnique({
            where: { code },
            select: { code: true, id: true, usedAt: true },
          }),
        hashPassword,
        createUser: async (data) => {
          const user = await tx.user.create({
            data: {
              credits: data.credits,
              email: data.email,
              passwordHash: data.passwordHash,
              role: data.role === "admin" ? Role.ADMIN : Role.USER,
            },
          });

          return {
            credits: user.credits,
            email: user.email,
            id: user.id,
            passwordHash: user.passwordHash,
            role: fromPrismaRole(user.role),
          };
        },
        markInviteUsed: async ({ inviteId, userId }) => {
          await tx.inviteCode.update({
            where: { id: inviteId },
            data: {
              usedAt: new Date(),
              usedById: userId,
            },
          });
        },
      }),
    );

    if (!result.ok) {
      return jsonError(result.message, 400);
    }

    const response = NextResponse.json({
      data: {
        user: result.user,
      },
    });

    await attachSessionCookie(response, {
      role: result.user.role,
      userId: result.user.id,
    });

    return response;
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
