import { revalidateTag } from "next/cache";

import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { getVideoMutationTarget, getWorkMutationTarget } from "@/lib/server/works";
import { adminWorkBatchReviewSchema } from "@/lib/validators";
import { applyAdminWorkReview } from "@/lib/work-showcase";

export async function POST(request: Request) {
  try {
    const admin = await requireAdminRecord();
    const body = adminWorkBatchReviewSchema.parse(await parseJsonBody(request));

    const updatedIds: string[] = [];
    const skippedIds: string[] = [];

    for (const item of body.items) {
      const target =
        item.mediaType === "video"
          ? await getVideoMutationTarget(item.id)
          : await getWorkMutationTarget(item.id);

      if (!target) {
        skippedIds.push(item.id);
        continue;
      }

      let patchData;
      try {
        patchData = applyAdminWorkReview({
          action: body.action,
          currentFeaturedAt: target.featuredAt,
          currentStatus: target.showcaseStatus,
          reviewNote: body.reviewNote,
          reviewerId: admin.id,
        });
      } catch {
        skippedIds.push(item.id);
        continue;
      }

      if (item.mediaType === "video") {
        await db.generatedVideo.update({
          data: patchData,
          where: { id: item.id },
        });
      } else {
        await db.generationImage.update({
          data: patchData,
          where: { id: item.id },
        });
      }
      updatedIds.push(item.id);
    }

    if (updatedIds.length > 0) {
      revalidateTag("featured-works", "max");
    }

    return jsonOk({
      skippedCount: skippedIds.length,
      skippedIds,
      updatedCount: updatedIds.length,
      updatedIds,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
