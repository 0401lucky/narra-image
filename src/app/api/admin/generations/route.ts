import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { serializeGeneration } from "@/lib/prisma-mappers";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { adminGenerationBulkDeleteSchema } from "@/lib/validators";

const ADMIN_DELETE_REFUND_MESSAGE = "管理员删除生成记录，已退还预扣积分。";

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
    const result = await db.$transaction(async (tx) => {
      const jobs = await tx.generationJob.findMany({
        where: {
          id: {
            in: uniqueIds,
          },
        },
        select: {
          creditsSpent: true,
          id: true,
          status: true,
          userId: true,
        },
      });

      const refundByUser = new Map<string, number>();
      for (const job of jobs) {
        if (job.status === GenerationStatus.SUCCEEDED || job.creditsSpent <= 0) {
          continue;
        }
        const refunded = await tx.generationJob.updateMany({
          where: {
            creditsSpent: job.creditsSpent,
            id: job.id,
            status: {
              not: GenerationStatus.SUCCEEDED,
            },
          },
          data: {
            creditsSpent: 0,
            errorMessage: ADMIN_DELETE_REFUND_MESSAGE,
            status: GenerationStatus.FAILED,
          },
        });
        if (refunded.count === 0) {
          continue;
        }
        refundByUser.set(
          job.userId,
          (refundByUser.get(job.userId) ?? 0) + job.creditsSpent,
        );
      }

      await Promise.all(
        Array.from(refundByUser.entries()).map(([userId, credits]) =>
          tx.user.update({
            where: { id: userId },
            data: {
              credits: {
                increment: credits,
              },
            },
          }),
        ),
      );

      const deleted = await tx.generationJob.deleteMany({
        where: {
          id: {
            in: uniqueIds,
          },
        },
      });

      return {
        deleted: deleted.count,
        refundedCredits: Array.from(refundByUser.values()).reduce(
          (total, credits) => total + credits,
          0,
        ),
      };
    });

    return jsonOk({
      deleted: result.deleted,
      ids: uniqueIds,
      refundedCredits: result.refundedCredits,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
