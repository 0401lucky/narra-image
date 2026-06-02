import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { requireCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { encryptProviderSecret } from "@/lib/providers/provider-secret";
import { providerConfigSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserRecord();
    const body = providerConfigSchema.parse(await parseJsonBody(request));
    const encryptedKey = await encryptProviderSecret(
      body.apiKey,
      getEnv().AUTH_SECRET,
    );

    const savedConfig = await db.savedProviderConfig.upsert({
      where: { userId: user.id },
      update: {
        apiKeyEncrypted: encryptedKey,
        baseUrl: body.baseUrl,
        label: body.label || null,
        model: body.model,
        models: body.models,
      },
      create: {
        apiKeyEncrypted: encryptedKey,
        baseUrl: body.baseUrl,
        label: body.label || null,
        model: body.model,
        models: body.models,
        userId: user.id,
      },
    });

    return jsonOk({
      savedProvider: {
        baseUrl: savedConfig.baseUrl,
        id: savedConfig.id,
        label: savedConfig.label,
        model: savedConfig.model,
        models: savedConfig.models,
        updatedAt: savedConfig.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
