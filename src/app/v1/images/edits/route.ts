import { parseExternalImageEditRequest } from "@/lib/external-api/image-edits";
import { formatImageGenerationData } from "@/lib/external-api/images";
import {
  isImageJsonKeepAliveRequest,
  openAiError,
  openAiImageJsonResponse,
  unixSeconds,
} from "@/lib/external-api/http";
import {
  isGatewayEnabled,
  runExternalGenerationViaGateway,
} from "@/lib/generation/gateway-client";
import { runExternalGeneration } from "@/lib/generation/external-api";
import { checkGenerationInput } from "@/lib/moderation/check";
import { requireApiUser } from "@/lib/server/api-auth";

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser(request);
    const { body, sourceImages } = await parseExternalImageEditRequest(request);

    // 内容审核：敏感词 / AI 命中则阻断（与 WEB 相同策略，防绕过）
    const moderation = await checkGenerationInput({
      negativePrompt: body.negativePrompt,
      prompt: body.prompt,
      userId: auth.user.id,
    });
    if (!moderation.allowed) {
      return openAiError(new Error(moderation.message));
    }

    if (isGatewayEnabled()) {
      const gatewayResponse = await runExternalGenerationViaGateway({
        apiKeyId: auth.apiKey.id,
        input: {
          count: body.count,
          generationType: "image_to_image",
          model: body.model,
          moderation: body.moderation,
          negativePrompt: body.negativePrompt,
          outputCompression: body.outputCompression,
          outputFormat: body.outputFormat,
          prompt: body.prompt,
          quality: body.quality,
          seed: body.seed,
          size: body.size,
          sourceImages,
        },
        signal: request.signal,
        user: auth.user,
        endpoint: "images.edits",
        responseFormat: body.responseFormat,
      });
      if (isImageJsonKeepAliveRequest(request)) {
        return openAiImageJsonResponse(request, async () => gatewayResponse.json());
      }
      return gatewayResponse;
    }

    return await openAiImageJsonResponse(request, async () => {
      const job = await runExternalGeneration({
        apiKeyId: auth.apiKey.id,
        input: {
          count: body.count,
          generationType: "image_to_image",
          model: body.model,
          moderation: body.moderation,
          negativePrompt: body.negativePrompt,
          outputCompression: body.outputCompression,
          outputFormat: body.outputFormat,
          prompt: body.prompt,
          quality: body.quality,
          seed: body.seed,
          size: body.size,
          sourceImages,
        },
        signal: request.signal,
        user: auth.user,
      });
      const data = await formatImageGenerationData(job.images, body.responseFormat);

      return {
        created: unixSeconds(job.createdAt),
        data,
        generation_id: job.id,
      };
    });
  } catch (error) {
    return openAiError(error);
  }
}
