import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { redeemCodeToggleSchema } from "@/lib/validators";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;

    const [batch, redemptions] = await Promise.all([
      db.redeemCodeBatch.findUnique({
        select: {
          codes: {
            orderBy: { createdAt: "asc" },
            select: {
              code: true,
              id: true,
              isActive: true,
              maxRedemptions: true,
              redeemedCount: true,
            },
          },
          id: true,
          isActive: true,
          title: true,
        },
        where: { id },
      }),
      db.redeemRedemption.findMany({
        include: {
          code: { select: { code: true } },
          user: { select: { email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        where: {
          code: { batchId: id },
        },
      }),
    ]);

    if (!batch) {
      return jsonError("批次不存在", 404);
    }

    return jsonOk({
      codes: batch.codes,
      redemptions: redemptions.map((item) => ({
        code: item.code.code,
        createdAt: item.createdAt.toISOString(),
        id: item.id,
        rewardCredits: item.rewardCredits,
        userEmail: item.user.email,
      })),
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
    const body = redeemCodeToggleSchema.parse(await parseJsonBody(request));

    const batch = await db.redeemCodeBatch.update({
      data: {
        isActive: body.isActive,
      },
      select: {
        id: true,
        isActive: true,
      },
      where: { id },
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

    const batch = await db.redeemCodeBatch.findUnique({
      select: { _count: { select: { codes: true } } },
      where: { id },
    });
    if (!batch) {
      return jsonError("批次不存在", 404);
    }

    // RedeemCode 与 RedeemRedemption 都是 onDelete: Cascade，删除批次会级联清理
    await db.redeemCodeBatch.delete({ where: { id } });

    return jsonOk({
      deletedCount: batch._count.codes,
      message: `已删除批次及其 ${batch._count.codes} 个兑换码`,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
