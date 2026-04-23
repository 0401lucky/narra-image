import { db } from "@/lib/db";
import { getWorkById, getWorkMutationTarget } from "@/lib/server/works";
import { requireCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { applyUserShowcaseAction } from "@/lib/work-showcase";
import { workShowcaseUpdateSchema } from "@/lib/validators";

function resolveStatusCode(error: unknown) {
  if (error instanceof Error && error.message === "当前状态不允许执行该操作") {
    return 409;
  }

  return 400;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUserRecord();
    const body = workShowcaseUpdateSchema.parse(await parseJsonBody(request));
    const { id } = await context.params;

    const work = await getWorkMutationTarget(id);
    if (!work || work.job.userId !== user.id) {
      return jsonError("作品不存在", 404);
    }

    const data = applyUserShowcaseAction({
      action: body.action,
      currentStatus: work.showcaseStatus,
      showPromptPublic: body.showPromptPublic,
    });

    await db.generationImage.update({
      where: { id },
      data,
    });

    const updatedWork = await getWorkById(id);

    return jsonOk({
      work: updatedWork,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), resolveStatusCode(error));
  }
}
