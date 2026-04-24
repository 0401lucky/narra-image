import { db } from "@/lib/db";
import { serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { jsonError, jsonOk, getErrorMessage, parseJsonBody } from "@/lib/server/http";
import { profileUpdateSchema } from "@/lib/validators";

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUserRecord();
    if (!user) {
      return jsonError("未登录", 401);
    }

    const body = await parseJsonBody<unknown>(request);
    const parsed = profileUpdateSchema.parse(body);

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        ...(parsed.nickname !== undefined && { nickname: parsed.nickname }),
        ...(parsed.avatarUrl !== undefined && { avatarUrl: parsed.avatarUrl }),
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

    return jsonOk({ user: serializeUser(updated) });
  } catch (error) {
    return jsonError(getErrorMessage(error));
  }
}
