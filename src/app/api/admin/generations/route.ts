import { GenerationStatus, type Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { failGenerationJobAndRefundInTransaction } from "@/lib/generation/job-refund";
import { serializeGeneration } from "@/lib/prisma-mappers";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { adminGenerationBulkDeleteSchema } from "@/lib/validators";

const ADMIN_DELETE_REFUND_MESSAGE = "管理员删除生成记录。";
const ADMIN_COORDINATION_WHERE = {
  contractVersion: { gte: 1 },
  handoffState: "UNKNOWN",
  status: GenerationStatus.FAILED,
} satisfies Prisma.GenerationJobWhereInput;

export async function GET() {
  try {
    await requireAdminRecord();

    const jobs = await db.generationJob.findMany({
      where: {
        OR: [
          { status: { not: GenerationStatus.FAILED } },
          ADMIN_COORDINATION_WHERE,
        ],
      },
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
          _count: {
            select: {
              attempts: true,
            },
          },
          contractVersion: true,
          creditsSpent: true,
          id: true,
          status: true,
        },
      });

      const jobsById = new Map(jobs.map((job) => [job.id, job]));
      const deletedIds: string[] = [];
      const protectedIds: string[] = [];
      let refundedCredits = 0;
      for (const id of uniqueIds) {
        const job = jobsById.get(id);
        if (!job) continue;

        if (job.contractVersion >= 1 || job._count.attempts > 0) {
          protectedIds.push(job.id);
          continue;
        }

        const alreadyFinalizedWithoutCredits =
          job.status === GenerationStatus.FAILED && job.creditsSpent <= 0;
        if (
          job.status !== GenerationStatus.SUCCEEDED &&
          !alreadyFinalizedWithoutCredits
        ) {
          const finalized = await failGenerationJobAndRefundInTransaction(tx, {
            allowedStatuses: [job.status],
            errorMessage: ADMIN_DELETE_REFUND_MESSAGE,
            jobId: job.id,
          });
          if (!finalized.updated) {
            protectedIds.push(job.id);
            continue;
          }
          refundedCredits += finalized.refundedCredits;
        }

        const deleted = await tx.generationJob.deleteMany({
          where: {
            attempts: { none: {} },
            contractVersion: { lt: 1 },
            id: job.id,
          },
        });
        if (deleted.count === 1) {
          deletedIds.push(job.id);
        } else {
          protectedIds.push(job.id);
        }
      }

      return {
        deletedIds,
        protectedIds,
        refundedCredits,
      };
    });

    return jsonOk({
      deleted: result.deletedIds.length,
      deletedIds: result.deletedIds,
      ...(result.protectedIds.length > 0
        ? { protectedIds: result.protectedIds }
        : {}),
      refundedCredits: result.refundedCredits,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
