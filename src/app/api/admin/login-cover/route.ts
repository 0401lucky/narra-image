import { getLoginCoverConfig, updateLoginCoverConfig } from "@/lib/server/login-cover";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";

export async function GET() {
  try {
    await requireAdminRecord();
    const config = await getLoginCoverConfig();
    return jsonOk(config);
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdminRecord();
    const body = (await parseJsonBody(request)) as {
      mode?: string;
      customUrl?: string | null;
    };

    if (body.mode && !["featured", "custom"].includes(body.mode)) {
      return jsonError("mode 必须是 featured 或 custom", 400);
    }

    const config = await updateLoginCoverConfig({
      mode: body.mode as "featured" | "custom" | undefined,
      customUrl: body.customUrl,
    });

    return jsonOk(config);
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
