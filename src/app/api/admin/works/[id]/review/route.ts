import { revalidateTag } from "next/cache";

import { db } from "@/lib/db";
import { getAdminWorkById, getVideoMutationTarget, getWorkMutationTarget } from "@/lib/server/works";
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

    const isVideo = body.mediaType === "video";
    const work = isVideo ? await getVideoMutationTarget(id) : await getWorkMutationTarget(id);
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

    if (isVideo) {
      await db.generatedVideo.update({
        where: { id },
        data,
      });
    } else {
      await db.generationImage.update({
        where: { id },
        data,
      });
    }

    revalidateTag("featured-works", "max");

    const updatedWork = isVideo ? null : await getAdminWorkById(id);

    return jsonOk({
      work: updatedWork,
      mediaType: body.mediaType,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), resolveStatusCode(error));
  }
}
