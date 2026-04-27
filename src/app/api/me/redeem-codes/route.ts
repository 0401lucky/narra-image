import { claimRedeemCode } from "@/lib/redeem-codes";
import { requireCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { redeemCodeClaimSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserRecord();
    const body = redeemCodeClaimSchema.parse(await parseJsonBody(request));
    const result = await claimRedeemCode({
      code: body.code,
      userId: user.id,
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
