import { revalidateTag } from "next/cache";

import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdminRecord();
    const { featured } = (await parseJsonBody<{ featured?: boolean }>(request)) ?? {};
    const { id } = await context.params;

    const updatedJob = await db.generationJob.update({
      where: { id },
      data: {
        featuredAt: featured ? new Date() : null,
        featuredById: featured ? admin.id : null,
      },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    revalidateTag("featured-works", "max");

    return jsonOk({
      generation: updatedJob,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
