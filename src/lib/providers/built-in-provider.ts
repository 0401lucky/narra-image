import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { mergeBuiltInProviderConfigInput, resolveBuiltInProviderConfig } from "@/lib/providers/built-in-provider-core";
import { decryptProviderSecret } from "@/lib/providers/provider-secret";

type BasicBuiltInProviderConfig = {
  apiKey: string;
  baseUrl: string;
  creditCost: number;
  model: string;
  models: string[];
  name: string;
};

export { mergeBuiltInProviderConfigInput, resolveBuiltInProviderConfig };

export async function getBuiltInProviderConfig() {
  const env = getEnv();
  const envConfig: BasicBuiltInProviderConfig = {
    apiKey: env.BUILTIN_PROVIDER_API_KEY || "",
    baseUrl: env.BUILTIN_PROVIDER_BASE_URL || "",
    creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,
    model: env.BUILTIN_PROVIDER_MODEL,
    models: [],
    name: env.BUILTIN_PROVIDER_NAME,
  };

  const stored = await db.builtInProviderConfig.findUnique({
    where: { scope: "default" },
  });

  if (!stored) {
    return envConfig;
  }

  return resolveBuiltInProviderConfig(envConfig, {
    apiKey: await decryptProviderSecret(stored.apiKeyEncrypted, env.AUTH_SECRET),
    baseUrl: stored.baseUrl,
    creditCost: stored.creditCost,
    model: stored.model,
    models: stored.models,
    name: stored.name,
  });
}

export async function getBuiltInProviderConfigForAdmin() {
  const env = getEnv();
  const stored = await db.builtInProviderConfig.findUnique({
    where: { scope: "default" },
  });

  return {
    apiKeyConfigured: Boolean(stored?.apiKeyEncrypted || env.BUILTIN_PROVIDER_API_KEY),
    baseUrl: stored?.baseUrl || env.BUILTIN_PROVIDER_BASE_URL || "",
    creditCost: stored?.creditCost || env.BUILTIN_PROVIDER_CREDIT_COST,
    model: stored?.model || env.BUILTIN_PROVIDER_MODEL,
    models: stored?.models || [],
    name: stored?.name || env.BUILTIN_PROVIDER_NAME,
    source: (stored ? "database" : "env") as "database" | "env",
  };
}
