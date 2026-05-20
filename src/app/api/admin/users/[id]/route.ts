import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdminRecord();
    const { id } = await context.params;

    if (id === admin.id) {
      return jsonError("不能删除自己的账号", 400);
    }

    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!user) {
      return jsonError("用户不存在", 404);
    }

    await db.user.delete({ where: { id } });

    return jsonOk({
      deleted: { id: user.id, email: user.email },
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
