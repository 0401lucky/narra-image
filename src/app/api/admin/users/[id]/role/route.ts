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
    const body = (await parseJsonBody(request)) as { role?: string };

    if (id === admin.id) {
      return jsonError("不能修改自己的角色", 400);
    }

    if (body.role !== "USER" && body.role !== "ADMIN") {
      return jsonError("无效的角色值", 400);
    }

    const user = await db.user.update({
      where: { id },
      data: { role: body.role },
      select: { id: true, email: true, role: true },
    });

    return jsonOk({ user });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
