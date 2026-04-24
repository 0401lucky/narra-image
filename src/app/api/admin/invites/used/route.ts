import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function DELETE() {
  try {
    await requireAdminRecord();

    const result = await db.inviteCode.deleteMany({
      where: {
        usedAt: { not: null },
      },
    });

    return jsonOk({
      deletedCount: result.count,
      message: `已清除 ${result.count} 条已使用的邀请码`,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
