import { db } from "@/lib/db";
import { getWorkMutationTarget } from "@/lib/server/works";
import { requireCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUserRecord();
    const { id } = await context.params;

    const work = await getWorkMutationTarget(id);
    if (!work || work.job.userId !== user.id) {
      return jsonError("作品不存在", 404);
    }

    await db.generationImage.delete({ where: { id } });

    return jsonOk({ id });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
