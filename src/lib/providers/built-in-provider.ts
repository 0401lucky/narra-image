import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { decryptProviderSecret } from "@/lib/providers/provider-secret";

/**
 * Resolved channel config used for generation.
 */
export type ResolvedChannel = {
  apiKey: string;
  baseUrl: string;
  creditCost: number;
  defaultModel: string;
  id: string;
  models: string[];
  name: string;
};

/**
 * Get all active provider channels, ordered by sortOrder.
 */
export async function getActiveChannels(): Promise<ResolvedChannel[]> {
  const env = getEnv();
  const channels = await db.providerChannel.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  if (channels.length === 0) {
    // Fallback to env config if no channels in DB
    const envKey = env.BUILTIN_PROVIDER_API_KEY || "";
    const envBase = env.BUILTIN_PROVIDER_BASE_URL || "";
    if (!envKey || !envBase) return [];

    return [
      {
        apiKey: envKey,
        baseUrl: envBase,
        creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,
        defaultModel: env.BUILTIN_PROVIDER_MODEL,
        id: "__env__",
        models: [],
        name: env.BUILTIN_PROVIDER_NAME,
      },
    ];
  }

  return Promise.all(
    channels.map(async (ch) => ({
      apiKey: await decryptProviderSecret(ch.apiKeyEncrypted, env.AUTH_SECRET),
      baseUrl: ch.baseUrl,
      creditCost: ch.creditCost,
      defaultModel: ch.defaultModel,
      id: ch.id,
      models: ch.models,
      name: ch.name,
    })),
  );
}

/**
 * Get a single channel by ID — used during generation.
 */
export async function getChannelById(id: string): Promise<ResolvedChannel | null> {
  const env = getEnv();

  // env fallback
  if (id === "__env__") {
    const envKey = env.BUILTIN_PROVIDER_API_KEY || "";
    const envBase = env.BUILTIN_PROVIDER_BASE_URL || "";
    if (!envKey || !envBase) return null;

    return {
      apiKey: envKey,
      baseUrl: envBase,
      creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,
      defaultModel: env.BUILTIN_PROVIDER_MODEL,
      id: "__env__",
      models: [],
      name: env.BUILTIN_PROVIDER_NAME,
    };
  }

  const ch = await db.providerChannel.findUnique({ where: { id } });
  if (!ch) return null;

  return {
    apiKey: await decryptProviderSecret(ch.apiKeyEncrypted, env.AUTH_SECRET),
    baseUrl: ch.baseUrl,
    creditCost: ch.creditCost,
    defaultModel: ch.defaultModel,
    id: ch.id,
    models: ch.models,
    name: ch.name,
  };
}

/**
 * Get all channels for admin — without decrypting API keys.
 * Also auto-migrates legacy BuiltInProviderConfig data if no channels exist.
 */
export async function getChannelsForAdmin() {
  let channels = await db.providerChannel.findMany({
    orderBy: { sortOrder: "asc" },
  });

  // Auto-migrate from legacy BuiltInProviderConfig if no channels yet
  if (channels.length === 0) {
    const legacy = await db.builtInProviderConfig.findFirst();
    if (legacy) {
      const migrated = await db.providerChannel.create({
        data: {
          apiKeyEncrypted: legacy.apiKeyEncrypted,
          baseUrl: legacy.baseUrl,
          creditCost: legacy.creditCost,
          defaultModel: legacy.model,
          isActive: true,
          models: legacy.models,
          name: legacy.name || "默认渠道",
          slug: "default",
          sortOrder: 0,
        },
      });
      channels = [migrated];
    }
  }

  return channels.map((ch) => ({
    apiKeyConfigured: Boolean(ch.apiKeyEncrypted),
    baseUrl: ch.baseUrl,
    creditCost: ch.creditCost,
    defaultModel: ch.defaultModel,
    id: ch.id,
    isActive: ch.isActive,
    models: ch.models,
    name: ch.name,
    slug: ch.slug,
    sortOrder: ch.sortOrder,
  }));
}

/**
 * Backwards-compat: get the first active channel as "built-in config"
 * Used by generate route when no channelId is provided.
 */
export async function getBuiltInProviderConfig() {
  const channels = await getActiveChannels();
  const first = channels[0];
  if (!first) {
    const env = getEnv();
    return {
      apiKey: env.BUILTIN_PROVIDER_API_KEY || "",
      baseUrl: env.BUILTIN_PROVIDER_BASE_URL || "",
      creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,
      id: "__env__",
      model: env.BUILTIN_PROVIDER_MODEL,
      models: [] as string[],
      name: env.BUILTIN_PROVIDER_NAME,
    };
  }

  return {
    apiKey: first.apiKey,
    baseUrl: first.baseUrl,
    creditCost: first.creditCost,
    id: first.id,
    model: first.defaultModel,
    models: first.models,
    name: first.name,
  };
}
