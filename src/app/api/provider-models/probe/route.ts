import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getBuiltInProviderConfig } from "@/lib/providers/built-in-provider";
import {
  fetchOpenAICompatibleModelIds,
  looksLikeImageModel,
} from "@/lib/providers/model-catalog";
import { decryptProviderSecret } from "@/lib/providers/provider-secret";
import {
  requireAdminRecord,
  requireCurrentUserRecord,
} from "@/lib/server/current-user";
import {
  getErrorMessage,
  jsonError,
  jsonOk,
  parseJsonBody,
} from "@/lib/server/http";
import { providerProbeSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserRecord();
    const body = providerProbeSchema.parse(await parseJsonBody(request));
    const env = getEnv();
    let apiKey = body.apiKey?.trim() || "";

    if (!apiKey && body.channelId) {
      await requireAdminRecord();
      const channel = await db.providerChannel.findUnique({
        where: { id: body.channelId },
        select: {
          apiKeyEncrypted: true,
        },
      });
      if (!channel) {
        return jsonError("渠道不存在", 404);
      }
      apiKey = await decryptProviderSecret(channel.apiKeyEncrypted, env.AUTH_SECRET);
    }

    if (!apiKey) {
      const saved = await db.savedProviderConfig.findFirst({
        where: {
          baseUrl: body.baseUrl,
          userId: user.id,
        },
        select: {
          apiKeyEncrypted: true,
        },
      });
      if (saved) {
        apiKey = await decryptProviderSecret(saved.apiKeyEncrypted, env.AUTH_SECRET);
      }
    }

    const builtIn = await getBuiltInProviderConfig();
    apiKey = apiKey || builtIn.apiKey || env.BUILTIN_PROVIDER_API_KEY || "";

    if (!apiKey) {
      return jsonError("请先提供 API Key", 400);
    }

    const modelIds = await fetchOpenAICompatibleModelIds({
      apiKey,
      baseUrl: body.baseUrl,
    });

    return jsonOk({
      models: modelIds.map((id) => ({
        id,
        imageLikely: looksLikeImageModel(id),
      })),
    });
  } catch (error) {
    return jsonError(
      `当前渠道无法自动拉取模型：${getErrorMessage(error)}。请确认该渠道兼容 chatgpt2api 图片协议。`,
      400,
    );
  }
}
