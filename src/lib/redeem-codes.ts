import "server-only";

import { Prisma, RedeemCodeMode } from "@prisma/client";

import { db } from "@/lib/db";

export function normalizeRedeemCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function toPrismaRedeemCodeMode(mode: "single_use" | "shared") {
  return mode === "shared" ? RedeemCodeMode.SHARED : RedeemCodeMode.SINGLE_USE;
}

export async function claimRedeemCode(input: {
  code: string;
  userId: string;
}) {
  const code = normalizeRedeemCode(input.code);
  if (!code) {
    throw new Error("请输入兑换码");
  }

  try {
    return await db.$transaction(async (tx) => {
      const redeemCode = await tx.redeemCode.findUnique({
        where: { code },
        include: {
          batch: {
            select: {
              isActive: true,
            },
          },
        },
      });

      if (!redeemCode || !redeemCode.isActive || redeemCode.batch?.isActive === false) {
        throw new Error("兑换码无效或已停用");
      }

      const redeemed = await tx.redeemRedemption.findUnique({
        where: {
          codeId_userId: {
            codeId: redeemCode.id,
            userId: input.userId,
          },
        },
      });

      if (redeemed) {
        throw new Error("你已兑换过这个兑换码");
      }

      const reserved = await tx.redeemCode.updateMany({
        where: {
          id: redeemCode.id,
          isActive: true,
          redeemedCount: {
            lt: redeemCode.maxRedemptions,
          },
        },
        data: {
          redeemedCount: {
            increment: 1,
          },
        },
      });

      if (reserved.count !== 1) {
        throw new Error("兑换码已被领完");
      }

      await tx.redeemRedemption.create({
        data: {
          codeId: redeemCode.id,
          rewardCredits: redeemCode.rewardCredits,
          userId: input.userId,
        },
      });

      const user = await tx.user.update({
        where: { id: input.userId },
        data: {
          credits: {
            increment: redeemCode.rewardCredits,
          },
        },
        select: {
          credits: true,
        },
      });

      return {
        code,
        credits: user.credits,
        rewardCredits: redeemCode.rewardCredits,
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("你已兑换过这个兑换码");
    }
    throw error;
  }
}
