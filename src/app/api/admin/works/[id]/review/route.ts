import { db } from "@/lib/db";
import { getAdminWorkById, getWorkMutationTarget } from "@/lib/server/works";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { applyAdminWorkReview } from "@/lib/work-showcase";
import { adminWorkReviewSchema } from "@/lib/validators";

function resolveStatusCode(error: unknown) {
  if (error instanceof Error && error.message === "当前状态不允许执行该审核操作") {
    return 409;
  }

  return 400;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdminRecord();
    const body = adminWorkReviewSchema.parse(await parseJsonBody(request));
    const { id } = await context.params;

    const work = await getWorkMutationTarget(id);
    if (!work) {
      return jsonError("作品不存在", 404);
    }

    const data = applyAdminWorkReview({
      action: body.action,
      currentFeaturedAt: work.featuredAt,
      currentStatus: work.showcaseStatus,
      reviewNote: body.reviewNote,
      reviewerId: admin.id,
    });

    await db.generationImage.update({
      where: { id },
      data,
    });

    const updatedWork = await getAdminWorkById(id);

    return jsonOk({
      work: updatedWork,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), resolveStatusCode(error));
  }
}
