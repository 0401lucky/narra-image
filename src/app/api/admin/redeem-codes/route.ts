import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { normalizeRedeemCode, toPrismaRedeemCodeMode } from "@/lib/redeem-codes";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { redeemCodeCreateSchema } from "@/lib/validators";

function createRedeemCode() {
  return randomBytes(5).toString("hex").toUpperCase();
}

function createUniqueCodes(count: number) {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(createRedeemCode());
  }
  return [...codes];
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdminRecord();
    const body = redeemCodeCreateSchema.parse(await parseJsonBody(request));
    const mode = toPrismaRedeemCodeMode(body.mode);
    const isShared = body.mode === "shared";
    const codes = isShared
      ? [normalizeRedeemCode(body.code || createRedeemCode())]
      : createUniqueCodes(body.count);

    if (codes.some((code) => !code)) {
      return jsonError("兑换码不能为空", 400);
    }

    const batch = await db.redeemCodeBatch.create({
      data: {
        createdById: admin.id,
        isActive: body.isActive,
        maxRedemptions: isShared ? body.maxRedemptions : 1,
        mode,
        rewardCredits: body.rewardCredits,
        title: body.note || null,
        codes: {
          create: codes.map((code) => ({
            code,
            createdById: admin.id,
            isActive: body.isActive,
            maxRedemptions: isShared ? body.maxRedemptions : 1,
            mode,
            note: body.note || null,
            rewardCredits: body.rewardCredits,
          })),
        },
      },
      include: {
        codes: {
          select: {
            code: true,
            id: true,
          },
        },
      },
    });

    return jsonOk(
      {
        batchId: batch.id,
        codes: batch.codes,
        message: isShared
          ? `共享兑换码 ${batch.codes[0]?.code} 已创建`
          : `成功生成 ${batch.codes.length} 个兑换码`,
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError("兑换码已存在，请换一个码", 400);
    }
    return jsonError(getErrorMessage(error), 400);
  }
}
