import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;

    const batch = await db.inviteBatch.findUnique({
      where: { id },
      select: { title: true },
    });

    if (!batch) {
      return jsonError("批次不存在", 404);
    }

    const codes = await db.inviteCode.findMany({
      where: { batchId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        code: true,
        claimedAt: true,
        usedAt: true,
        usedBy: {
          select: {
            email: true,
          },
        },
      },
    });

    return jsonOk({
      title: batch.title,
      codes,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;
    const body = (await parseJsonBody<{ isPublic: boolean }>(request)) as { isPublic: boolean };

    const batch = await db.inviteBatch.update({
      where: { id },
      data: {
        isPublic: Boolean(body.isPublic),
      },
      select: {
        id: true,
        isPublic: true,
      },
    });

    return jsonOk(batch);
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;

    const batch = await db.inviteBatch.findUnique({ where: { id } });
    if (!batch) {
      return jsonError("批次不存在", 404);
    }

    // InviteCode.batchId 关系是 SetNull，必须先在事务里删码再删批次
    const result = await db.$transaction(async (tx) => {
      const deleted = await tx.inviteCode.deleteMany({ where: { batchId: id } });
      await tx.inviteBatch.delete({ where: { id } });
      return deleted.count;
    });

    return jsonOk({
      deletedCount: result,
      message: `已删除批次及其 ${result} 个邀请码`,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
