import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getChannelsForAdmin } from "@/lib/providers/built-in-provider";
import { encryptProviderSecret } from "@/lib/providers/provider-secret";
import { requireAdminRecord } from "@/lib/server/current-user";
import {
  getErrorMessage,
  jsonError,
  jsonOk,
  parseJsonBody,
} from "@/lib/server/http";
import { channelCreateSchema } from "@/lib/validators";

/**
 * GET /api/admin/channels — list all channels for admin
 */
export async function GET() {
  try {
    await requireAdminRecord();
    return jsonOk({ channels: await getChannelsForAdmin() });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}

/**
 * POST /api/admin/channels — create a new channel
 */
export async function POST(request: Request) {
  try {
    await requireAdminRecord();
    const body = channelCreateSchema.parse(await parseJsonBody(request));
    const env = getEnv();

    await db.providerChannel.create({
      data: {
        apiKeyEncrypted: await encryptProviderSecret(body.apiKey, env.AUTH_SECRET),
        baseUrl: body.baseUrl,
        creditCost: body.creditCost,
        defaultModel: body.defaultModel,
        isActive: body.isActive,
        models: body.models,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sortOrder,
        videoCreditCost: body.videoCreditCost,
      },
    });

    return jsonOk({ channels: await getChannelsForAdmin() });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
