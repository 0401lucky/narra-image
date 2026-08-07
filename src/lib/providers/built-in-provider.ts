import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  GenerationContractError,
  channelSupportsModel,
  normalizeProviderModels,
} from "@/lib/generation/contracts";
import { decryptProviderSecret } from "@/lib/providers/provider-secret";

/**
 * Resolved channel config used for generation.
 */
export type ResolvedChannel = {
  apiKey: string;
  baseUrl: string;
  creditCost: number;
  videoCreditCost: number;
  defaultModel: string;
  id: string;
  models: string[];
  name: string;
};

type StoredChannel = {
  apiKeyEncrypted: string;
  baseUrl: string;
  creditCost: number;
  defaultModel: string;
  id: string;
  isActive: boolean;
  models: string[];
  name: string;
  videoCreditCost: number;
};

async function resolveStoredChannel(channel: StoredChannel): Promise<ResolvedChannel> {
  const env = getEnv();
  let apiKey: string;
  try {
    apiKey = await decryptProviderSecret(channel.apiKeyEncrypted, env.AUTH_SECRET);
  } catch (error) {
    throw new GenerationContractError("CHANNEL_SECRET_DECRYPT_FAILED", {
      cause: error,
    });
  }

  return {
    apiKey,
    baseUrl: channel.baseUrl,
    creditCost: channel.creditCost,
    videoCreditCost: channel.videoCreditCost,
    defaultModel: channel.defaultModel,
    id: channel.id,
    models: channel.models,
    name: channel.name,
  };
}

function envChannel(): ResolvedChannel | null {
  const env = getEnv();
  const apiKey = env.BUILTIN_PROVIDER_API_KEY || "";
  const baseUrl = env.BUILTIN_PROVIDER_BASE_URL || "";
  if (!apiKey || !baseUrl) {
    return null;
  }
  return {
    apiKey,
    baseUrl,
    creditCost: env.BUILTIN_PROVIDER_CREDIT_COST,
    videoCreditCost: env.BUILTIN_PROVIDER_VIDEO_CREDIT_COST,
    defaultModel: env.BUILTIN_PROVIDER_MODEL,
    id: "__env__",
    models: [],
    name: env.BUILTIN_PROVIDER_NAME,
  };
}

/**
 * Get all active provider channels, ordered by sortOrder.
 */
export async function getActiveChannels(): Promise<ResolvedChannel[]> {
  const channels = await db.providerChannel.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  if (channels.length === 0) {
    // Fallback to env config if no channels in DB
    const fallback = envChannel();
    return fallback ? [fallback] : [];
  }

  return Promise.all(channels.map(resolveStoredChannel));
}

/**
 * Get a single channel by ID — used during generation.
 */
export async function getChannelById(id: string): Promise<ResolvedChannel | null> {
  // env fallback
  if (id === "__env__") {
    return envChannel();
  }

  const ch = await db.providerChannel.findFirst({
    where: { id, isActive: true },
  });
  if (!ch) return null;

  return resolveStoredChannel(ch);
}

/**
 * Get all channels for admin — without decrypting API keys.
 * Also auto-migrates legacy BuiltInProviderConfig data if no channels exist.
 */
export async function getChannelsForAdmin() {
  const env = getEnv();
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
          videoCreditCost: env.BUILTIN_PROVIDER_VIDEO_CREDIT_COST,
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
    videoCreditCost: ch.videoCreditCost,
  }));
}

export async function getGenerationChannelById(
  id: string,
  requestedModel: string,
): Promise<ResolvedChannel> {
  if (id === "__env__") {
    const channel = envChannel();
    if (!channel) {
      throw new GenerationContractError("CHANNEL_NOT_FOUND");
    }
    if (!channelSupportsModel({
      defaultModel: channel.defaultModel,
      model: requestedModel,
      models: channel.models,
    })) {
      throw new GenerationContractError("MODEL_NOT_SUPPORTED_BY_CHANNEL");
    }
    return channel;
  }

  const channel = await db.providerChannel.findUnique({ where: { id } });
  if (!channel) {
    throw new GenerationContractError("CHANNEL_NOT_FOUND");
  }
  if (!channel.isActive) {
    throw new GenerationContractError("CHANNEL_INACTIVE");
  }
  if (!channelSupportsModel({
    defaultModel: channel.defaultModel,
    model: requestedModel,
    models: channel.models,
  })) {
    throw new GenerationContractError("MODEL_NOT_SUPPORTED_BY_CHANNEL");
  }
  return resolveStoredChannel(channel);
}

export async function getGenerationChannelForModel(
  requestedModel: string,
): Promise<ResolvedChannel> {
  const channels = await db.providerChannel.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  if (channels.length === 0) {
    const fallback = envChannel();
    if (!fallback) {
      throw new GenerationContractError("PROVIDER_NOT_CONFIGURED");
    }
    if (!channelSupportsModel({
      defaultModel: fallback.defaultModel,
      model: requestedModel,
      models: fallback.models,
    })) {
      throw new GenerationContractError("MODEL_NOT_SUPPORTED_BY_CHANNEL");
    }
    return fallback;
  }

  const channel = channels.find((candidate) => channelSupportsModel({
    defaultModel: candidate.defaultModel,
    model: requestedModel,
    models: candidate.models,
  }));
  if (!channel) {
    throw new GenerationContractError("MODEL_NOT_SUPPORTED_BY_CHANNEL");
  }
  return resolveStoredChannel(channel);
}

export function generationChannelModelSnapshot(channel: ResolvedChannel) {
  return normalizeProviderModels(channel.defaultModel, channel.models);
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
      videoCreditCost: env.BUILTIN_PROVIDER_VIDEO_CREDIT_COST,
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
    videoCreditCost: first.videoCreditCost,
    id: first.id,
    model: first.defaultModel,
    models: first.models,
    name: first.name,
  };
}
