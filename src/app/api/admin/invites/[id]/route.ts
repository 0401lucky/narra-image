import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;

    const invite = await db.inviteCode.findUnique({ where: { id } });
    if (!invite) {
      return jsonError("邀请码不存在", 404);
    }

    await db.inviteCode.delete({ where: { id } });

    return jsonOk({ message: "已删除" });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
