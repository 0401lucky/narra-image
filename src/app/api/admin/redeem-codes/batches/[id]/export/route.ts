import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError } from "@/lib/server/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "all" ? "all" : "available";

    const batch = await db.redeemCodeBatch.findUnique({
      where: { id },
      select: { createdAt: true, id: true },
    });

    if (!batch) {
      return jsonError("批次不存在", 404);
    }

    const codes = await db.redeemCode.findMany({
      where: {
        batchId: id,
        ...(scope === "available"
          ? {
              isActive: true,
            }
          : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { code: true, maxRedemptions: true, redeemedCount: true },
    });

    const exportCodes = scope === "available"
      ? codes.filter((code) => code.redeemedCount < code.maxRedemptions)
      : codes;
    const body = exportCodes.map((code) => code.code).join("\n");
    const date = batch.createdAt.toISOString().slice(0, 10);
    const filename = `redeem-codes-${date}-${batch.id.slice(-6)}.txt`;

    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
