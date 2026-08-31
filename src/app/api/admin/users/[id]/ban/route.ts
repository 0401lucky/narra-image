import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdminRecord();
    const { id } = await context.params;
    const body = (await parseJsonBody(request)) as { banned?: unknown };

    if (id === admin.id) {
      return jsonError("不能封禁自己", 400);
    }

    if (typeof body.banned !== "boolean") {
      return jsonError("无效的封禁参数", 400);
    }

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      return jsonError("用户不存在", 404);
    }

    const updated = await db.user.update({
      where: { id },
      data: { bannedAt: body.banned ? new Date() : null },
      select: { bannedAt: true, id: true },
    });

    return jsonOk({
      user: {
        banned: updated.bannedAt !== null,
        id: updated.id,
      },
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}