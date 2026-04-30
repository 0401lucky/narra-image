import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function POST() {
  try {
    await requireAdminRecord();

    const result = await db.generationJob.deleteMany({
      where: { status: GenerationStatus.FAILED },
    });

    return jsonOk({ deleted: result.count });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}
