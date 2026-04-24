import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import { updateBenefitConfig } from "@/lib/benefits/config";
import { benefitConfigSchema } from "@/lib/validators";

export async function PATCH(request: Request) {
  try {
    await requireAdminRecord();
    const body = benefitConfigSchema.parse(await request.json());
    const config = await updateBenefitConfig({ checkInReward: body.checkInReward });

    return jsonOk({
      checkInReward: config.checkInReward,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
