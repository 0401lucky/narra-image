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
import { channelUpdateSchema } from "@/lib/validators";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/channels/[id] — update a channel
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;
    const body = channelUpdateSchema.parse(await parseJsonBody(request));
    const env = getEnv();

    const existing = await db.providerChannel.findUnique({ where: { id } });
    if (!existing) return jsonError("渠道不存在", 404);

    await db.providerChannel.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.baseUrl !== undefined && { baseUrl: body.baseUrl }),
        ...(body.defaultModel !== undefined && { defaultModel: body.defaultModel }),
        ...(body.models !== undefined && { models: body.models }),
        ...(body.creditCost !== undefined && { creditCost: body.creditCost }),
        ...(body.videoCreditCost !== undefined && { videoCreditCost: body.videoCreditCost }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
        ...(body.apiKey && {
          apiKeyEncrypted: await encryptProviderSecret(body.apiKey, env.AUTH_SECRET),
        }),
      },
    });

    return jsonOk({ channels: await getChannelsForAdmin() });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}

/**
 * DELETE /api/admin/channels/[id] — delete a channel
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;

    await db.providerChannel.delete({ where: { id } });

    return jsonOk({ channels: await getChannelsForAdmin() });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
