import { z } from "zod";

import {
  getModerationConfigMeta,
  updateModerationConfig,
} from "@/lib/moderation/config";
import { requireAdminRecord } from "@/lib/server/current-user";
import {
  getErrorMessage,
  jsonError,
  jsonOk,
  parseJsonBody,
} from "@/lib/server/http";

const patchSchema = z.object({
  isEnabled: z.boolean().optional(),
  sensitiveWordsEnabled: z.boolean().optional(),
  aiEnabled: z.boolean().optional(),
  aiBaseUrl: z.string().optional(),
  aiApiKey: z.string().optional(),
  aiModel: z.string().optional(),
  aiThreshold: z.number().min(0).max(1).optional(),
});

export async function GET() {
  try {
    await requireAdminRecord();
    const config = await getModerationConfigMeta();
    return jsonOk({ config });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdminRecord();
    const body = patchSchema.parse(await parseJsonBody(request));
    await updateModerationConfig(body);
    const config = await getModerationConfigMeta();
    return jsonOk({ config });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}