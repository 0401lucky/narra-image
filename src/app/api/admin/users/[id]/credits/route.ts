import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { creditUpdateSchema } from "@/lib/validators";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminRecord();
    const body = creditUpdateSchema.parse(await parseJsonBody(request));
    const { id } = await context.params;

    const userSelect = {
      credits: true,
      email: true,
      id: true,
    } as const;

    if (body.amount < 0) {
      // 条件扣减：余额不足时拒绝，避免把用户积分调成负数
      const deducted = await db.user.updateMany({
        where: { id, credits: { gte: -body.amount } },
        data: {
          credits: {
            increment: body.amount,
          },
        },
      });

      if (deducted.count === 0) {
        return jsonError("扣减失败：用户不存在或积分余额不足", 400);
      }

      const updatedUser = await db.user.findUniqueOrThrow({
        where: { id },
        select: userSelect,
      });

      return jsonOk({
        user: updatedUser,
      });
    }

    const updatedUser = await db.user.update({
      where: { id },
      data: {
        credits: {
          increment: body.amount,
        },
      },
      select: userSelect,
    });

    return jsonOk({
      user: updatedUser,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
