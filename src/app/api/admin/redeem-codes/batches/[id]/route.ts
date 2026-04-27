import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { redeemCodeToggleSchema } from "@/lib/validators";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;
    const body = redeemCodeToggleSchema.parse(await parseJsonBody(request));

    const batch = await db.redeemCodeBatch.update({
      where: { id },
      data: {
        isActive: body.isActive,
      },
      select: {
        id: true,
        isActive: true,
      },
    });

    return jsonOk(batch);
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
