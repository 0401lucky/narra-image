import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import {
  ALL_PROMPT_SOURCES,
  listPromptSourcesForAdmin,
  syncAllPromptSources,
  syncPromptSource,
} from "@/lib/prompts/service";

export async function POST(request: Request) {
  try {
    await requireAdminRecord();
    const body = await parseJsonBody<{ sourceId?: string }>(request);
    const sourceId = body.sourceId?.trim();
    if (!sourceId) return jsonError("缺少来源 ID", 400);

    const synced = sourceId === ALL_PROMPT_SOURCES
      ? await syncAllPromptSources()
      : [await syncPromptSource(sourceId)];

    return jsonOk({
      sources: await listPromptSourcesForAdmin(),
      synced,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
