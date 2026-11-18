import { db } from "@/lib/db";
import { fromPrismaRole } from "@/lib/prisma-mappers";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import { imageAvailabilityInclude } from "@/lib/storage/image-availability";
import { presentGenerationImage } from "@/lib/storage/image-presentation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;

    const record = await db.user.findUnique({
      select: {
        _count: {
          select: {
            apiKeys: true,
            canvases: true,
            checkInRecords: true,
            contentReviews: true,
            generations: true,
            likedWorks: true,
            redeemRedemptions: true,
          },
        },
        apiKeys: {
          orderBy: { createdAt: "desc" },
          select: {
            _count: { select: { generations: true } },
            createdAt: true,
            id: true,
            keyPrefix: true,
            lastUsedAt: true,
            name: true,
            revokedAt: true,
          },
          take: 10,
        },
        avatarUrl: true,
        bannedAt: true,
        checkInRecords: {
          orderBy: { createdAt: "desc" },
          select: {
            createdAt: true,
            dateKey: true,
            id: true,
            rewardCredits: true,
          },
          take: 8,
        },
        createdAt: true,
        credits: true,
        email: true,
        generations: {
          orderBy: { createdAt: "desc" },
          select: {
            createdAt: true,
            creditsSpent: true,
            errorMessage: true,
            generationType: true,
            id: true,
            images: {
              include: imageAvailabilityInclude,
              orderBy: { createdAt: "asc" },
              take: 1,
            },
            model: true,
            prompt: true,
            status: true,
          },
          take: 8,
        },
        id: true,
        inviteUsed: {
          select: {
            batch: { select: { title: true } },
            code: true,
            note: true,
          },
        },
        nickname: true,
        oauthProvider: true,
        redeemRedemptions: {
          orderBy: { createdAt: "desc" },
          select: {
            code: { select: { code: true } },
            createdAt: true,
            id: true,
            rewardCredits: true,
          },
          take: 8,
        },
        role: true,
      },
      where: { id },
    });

    if (!record) {
      return jsonError("用户不存在", 404);
    }

    return jsonOk({
      user: {
        apiKeys: record.apiKeys.map((key) => ({
          createdAt: key.createdAt.toISOString(),
          generationCount: key._count.generations,
          id: key.id,
          keyPrefix: key.keyPrefix,
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          name: key.name,
          status: key.revokedAt ? ("revoked" as const) : ("active" as const),
        })),
        avatarUrl: record.avatarUrl,
        banned: record.bannedAt !== null,
        bannedAt: record.bannedAt?.toISOString() ?? null,
        checkIns: record.checkInRecords.map((c) => ({
          createdAt: c.createdAt.toISOString(),
          dateKey: c.dateKey,
          id: c.id,
          rewardCredits: c.rewardCredits,
        })),
        counts: record._count,
        createdAt: record.createdAt.toISOString(),
        credits: record.credits,
        email: record.email,
        id: record.id,
        inviteUsed: record.inviteUsed
          ? {
              batchTitle: record.inviteUsed.batch?.title ?? null,
              code: record.inviteUsed.code,
              note: record.inviteUsed.note,
            }
          : null,
        nickname: record.nickname,
        oauthProvider: record.oauthProvider,
        recentGenerations: record.generations.map((job) => {
          const firstImg = job.images[0];
          const presented = firstImg ? presentGenerationImage(firstImg) : null;
          return {
            createdAt: job.createdAt.toISOString(),
            creditsSpent: job.creditsSpent,
            errorMessage: job.errorMessage,
            generationType: job.generationType,
            id: job.id,
            model: job.model,
            prompt: job.prompt,
            status: job.status,
            thumbUrl:
              presented?.availability === "available" ? presented.url : null,
          };
        }),
        redemptions: record.redeemRedemptions.map((r) => ({
          code: r.code.code,
          createdAt: r.createdAt.toISOString(),
          id: r.id,
          rewardCredits: r.rewardCredits,
        })),
        role: fromPrismaRole(record.role),
      },
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdminRecord();
    const { id } = await context.params;

    if (id === admin.id) {
      return jsonError("不能删除自己的账号", 400);
    }

    const user = await db.user.findUnique({
      select: { email: true, id: true },
      where: { id },
    });
    if (!user) {
      return jsonError("用户不存在", 404);
    }

    await db.user.delete({ where: { id } });

    return jsonOk({
      deleted: { email: user.email, id: user.id },
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
