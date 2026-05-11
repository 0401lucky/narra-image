import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { inviteCreateSchema } from "@/lib/validators";

function createInviteCode() {
  return randomBytes(4).toString("hex").toUpperCase();
}

export async function GET() {
  try {
    await requireAdminRecord();

    const batches = await db.inviteBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        inviteCodes: {
          select: {
            claimedAt: true,
            id: true,
            usedAt: true,
          },
        },
      },
      take: 20,
    });
    const invites = await db.inviteCode.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        batch: {
          select: {
            id: true,
            isPublic: true,
            title: true,
          },
        },
        usedBy: {
          select: {
            email: true,
            id: true,
          },
        },
      },
      take: 50,
    });

    return jsonOk({
      batches: batches.map((batch) => ({
        id: batch.id,
        isPublic: batch.isPublic,
        remainingCount: batch.inviteCodes.filter((invite) => !invite.usedAt && !invite.claimedAt).length,
        title: batch.title,
        totalCount: batch.inviteCodes.length,
      })),
      invites: invites.map((invite) => ({
        batch: invite.batch,
        claimedAt: invite.claimedAt?.toISOString() ?? null,
        code: invite.code,
        createdAt: invite.createdAt.toISOString(),
        id: invite.id,
        note: invite.note,
        usedAt: invite.usedAt?.toISOString() ?? null,
        usedBy: invite.usedBy,
      })),
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdminRecord();
    const body = inviteCreateSchema.parse(await parseJsonBody(request));

    const count = body.count || 1;
    const batch = await db.inviteBatch.create({
      data: {
        createdById: admin.id,
        isPublic: body.isPublic,
        title: body.note || null,
      },
    });
    const data = Array.from({ length: count }).map(() => ({
      batchId: batch.id,
      code: createInviteCode(),
      createdById: admin.id,
      note: body.note || null,
    }));

    await db.inviteCode.createMany({
      data,
    });

    return jsonOk(
      {
        batchId: batch.id,
        claimPageUrl: "/invite-claim",
        codes: data.map((d) => d.code),
        message: `成功生成 ${count} 个邀请码`,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
