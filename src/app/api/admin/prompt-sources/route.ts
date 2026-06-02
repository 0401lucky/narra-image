import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { listPromptSourcesForAdmin, setPromptSourceEnabled } from "@/lib/prompts/service";

export async function GET() {
  try {
    await requireAdminRecord();
    return jsonOk({ sources: await listPromptSourcesForAdmin() });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdminRecord();
    const body = await parseJsonBody<{ id?: string; isEnabled?: boolean }>(request);
    if (!body.id) return jsonError("缺少来源 ID", 400);
    if (typeof body.isEnabled !== "boolean") return jsonError("isEnabled 参数无效", 400);

    await setPromptSourceEnabled(body.id, body.isEnabled);
    return jsonOk({ sources: await listPromptSourcesForAdmin() });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
