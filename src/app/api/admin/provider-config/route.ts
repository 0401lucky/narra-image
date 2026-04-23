import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  getBuiltInProviderConfigForAdmin,
  mergeBuiltInProviderConfigInput,
} from "@/lib/providers/built-in-provider";
import { encryptProviderSecret } from "@/lib/providers/provider-secret";
import { requireAdminRecord } from "@/lib/server/current-user";
import {
  getErrorMessage,
  jsonError,
  jsonOk,
  parseJsonBody,
} from "@/lib/server/http";
import { builtInProviderConfigSchema } from "@/lib/validators";

export async function GET() {
  try {
    await requireAdminRecord();

    return jsonOk({
      providerConfig: await getBuiltInProviderConfigForAdmin(),
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdminRecord();
    const body = builtInProviderConfigSchema.parse(await parseJsonBody(request));
    const env = getEnv();
    const current = await db.builtInProviderConfig.findUnique({
      where: { scope: "default" },
    });
    const merged = mergeBuiltInProviderConfigInput(body, current);

    await db.builtInProviderConfig.upsert({
      where: { scope: "default" },
      update: {
        apiKeyEncrypted:
          merged.apiKey !== null
            ? await encryptProviderSecret(merged.apiKey, env.AUTH_SECRET)
            : current?.apiKeyEncrypted ?? "",
        baseUrl: merged.baseUrl,
        creditCost: merged.creditCost,
        model: merged.model,
        models: merged.models,
        name: merged.name,
      },
      create: {
        apiKeyEncrypted:
          merged.apiKey !== null
            ? await encryptProviderSecret(merged.apiKey, env.AUTH_SECRET)
            : await encryptProviderSecret(
                env.BUILTIN_PROVIDER_API_KEY || "",
                env.AUTH_SECRET,
              ),
        baseUrl: merged.baseUrl,
        creditCost: merged.creditCost,
        model: merged.model,
        models: merged.models,
        name: merged.name,
        scope: "default",
      },
    });

    return jsonOk({
      providerConfig: await getBuiltInProviderConfigForAdmin(),
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
