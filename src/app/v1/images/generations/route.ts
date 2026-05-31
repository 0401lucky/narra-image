import { formatImageGenerationData } from "@/lib/external-api/images";
import { openAiError, openAiImageJsonResponse, unixSeconds } from "@/lib/external-api/http";
import { runExternalGeneration } from "@/lib/generation/external-api";
import { requireApiUser } from "@/lib/server/api-auth";
import { parseJsonBody } from "@/lib/server/http";
import { externalImageGenerationSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser(request);
    const body = externalImageGenerationSchema.parse(await parseJsonBody(request));

    return await openAiImageJsonResponse(request, async () => {
      const job = await runExternalGeneration({
        apiKeyId: auth.apiKey.id,
        input: {
          count: body.count,
          generationType: "text_to_image",
          model: body.model,
          moderation: body.moderation,
          negativePrompt: body.negativePrompt,
          outputCompression: body.outputCompression,
          outputFormat: body.outputFormat,
          prompt: body.prompt,
          quality: body.quality,
          seed: body.seed,
          size: body.size,
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
