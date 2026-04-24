import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { attachSessionCookie } from "@/lib/auth/session";
import { serializeUser } from "@/lib/prisma-mappers";
import { parseJsonBody, getErrorMessage, jsonError } from "@/lib/server/http";
import { loginSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const body = loginSchema.parse(await parseJsonBody(request));
    const user = await db.user.findUnique({
      where: { email: body.email.toLowerCase() },
      select: {
        avatarUrl: true,
        credits: true,
        email: true,
        id: true,
        nickname: true,
        passwordHash: true,
        role: true,
      },
    });

    if (!user) {
      return jsonError("邮箱或密码错误", 401);
    }

    if (!user.passwordHash) {
      return jsonError("该账号通过第三方登录创建，请使用对应的登录方式", 401);
    }

    const isValid = await verifyPassword(body.password, user.passwordHash);
    if (!isValid) {
      return jsonError("邮箱或密码错误", 401);
    }

    const response = NextResponse.json({
      data: {
        user: serializeUser(user),
      },
    });

    await attachSessionCookie(response, {
      role: serializeUser(user).role,
      userId: user.id,
    });

    return response;
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
