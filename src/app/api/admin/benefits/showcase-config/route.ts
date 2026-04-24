import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { getBenefitConfig, updateBenefitConfig } from "@/lib/benefits/config";

export async function GET() {
  try {
    await requireAdminRecord();
    const config = await getBenefitConfig();
    return jsonOk({ autoApproveShowcase: config.autoApproveShowcase });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdminRecord();
    const body = (await parseJsonBody(request)) as { autoApproveShowcase?: boolean };

    if (typeof body.autoApproveShowcase !== "boolean") {
      return jsonError("参数错误", 400);
    }

    const config = await updateBenefitConfig({
      autoApproveShowcase: body.autoApproveShowcase,
    });

    return jsonOk({ autoApproveShowcase: config.autoApproveShowcase });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
