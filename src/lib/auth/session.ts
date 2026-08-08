import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { getEnv } from "@/lib/env";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session-token";
import type { UserRole } from "@/lib/types";

type SessionUser = {
  userId: string;
  role: UserRole;
};

function getBaseCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: getEnv().NODE_ENV === "production",
  };
}

export async function createSession(user: SessionUser) {
  return createSessionToken(user, getEnv().AUTH_SECRET);
}

export async function readSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  try {
    const payload = await verifySessionToken(token, getEnv().AUTH_SECRET);

    return {
      role: payload.role,
      userId: payload.userId,
    };
  } catch {
    return null;
  }
}

export async function attachSessionCookie(
  response: NextResponse,
  user: SessionUser,
) {
  const token = await createSession(user);

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...getBaseCookieOptions(),
    maxAge: 60 * 60 * 24 * 14,
  });

  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...getBaseCookieOptions(),
    maxAge: 0,
  });

  return response;
}
