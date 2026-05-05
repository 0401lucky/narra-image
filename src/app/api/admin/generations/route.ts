import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { serializeGeneration } from "@/lib/prisma-mappers";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { adminGenerationBulkDeleteSchema } from "@/lib/validators";

export async function GET() {
  try {
    await requireAdminRecord();

    const jobs = await db.generationJob.findMany({
      where: { status: { not: GenerationStatus.FAILED } },
      orderBy: { createdAt: "desc" },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
        },
        user: {
          select: {
            email: true,
            id: true,
          },
        },
      },
      take: 60,
    });

    return jsonOk({
      generations: jobs.map((job) => ({
        ...serializeGeneration(job),
        user: job.user,
      })),
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdminRecord();
    const body = adminGenerationBulkDeleteSchema.parse(
      await parseJsonBody(request),
    );

    const uniqueIds = Array.from(new Set(body.ids));
    const result = await db.generationJob.deleteMany({
      where: {
        id: {
          in: uniqueIds,
        },
      },
    });

    return jsonOk({
      deleted: result.count,
      ids: uniqueIds,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
