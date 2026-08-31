import "server-only";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  decryptProviderSecret,
  encryptProviderSecret,
} from "@/lib/providers/provider-secret";

/**
 * 审核配置：DB 单行（scope="default"）优先，env（MODERATION_*）兜底。
 * aiApiKey 仅作有效 key 内部使用，不向管理端暴露明文。
 */

export type ResolvedModerationConfig = {
  isEnabled: boolean;
  sensitiveWordsEnabled: boolean;
  aiEnabled: boolean;
  aiBaseUrl: string | null;
  aiModel: string | null;
  aiThreshold: number;
  aiApiKey: string | null;
};

export async function resolveModerationConfig(): Promise<ResolvedModerationConfig> {
  const env = getEnv();
  const row = await db.moderationConfig.findUnique({ where: { scope: "default" } });

  let aiApiKey: string | null = env.MODERATION_API_KEY?.trim() || null;
  if (row?.aiApiKeyEncrypted) {
    aiApiKey = await decryptProviderSecret(row.aiApiKeyEncrypted, env.AUTH_SECRET);
  }

  return {
    isEnabled: row?.isEnabled ?? env.MODERATION_ENABLED,
    sensitiveWordsEnabled:
      row?.sensitiveWordsEnabled ?? env.MODERATION_SENSITIVE_WORDS_ENABLED,
    aiEnabled: row?.aiEnabled ?? env.MODERATION_AI_ENABLED,
    aiBaseUrl:
      (row?.aiBaseUrl?.trim() || null) ?? (env.MODERATION_BASE_URL?.trim() || null),
    aiModel: (row?.aiModel?.trim() || null) ?? env.MODERATION_MODEL,
    aiThreshold: row?.aiThreshold ?? env.MODERATION_THRESHOLD,
    aiApiKey,
  };
}

export type ModerationConfigMeta = {
  isEnabled: boolean;
  sensitiveWordsEnabled: boolean;
  aiEnabled: boolean;
  aiBaseUrl: string;
  aiConfigured: boolean;
  aiModel: string | null;
  aiThreshold: number;
  updatedAt: string | null;
};

/** 管理端只读视图：不含明文 key，仅 aiConfigured 布尔 */
export async function getModerationConfigMeta(): Promise<ModerationConfigMeta> {
  const cfg = await resolveModerationConfig();
  const row = await db.moderationConfig.findUnique({
    where: { scope: "default" },
    select: { updatedAt: true },
  });

  return {
    isEnabled: cfg.isEnabled,
    sensitiveWordsEnabled: cfg.sensitiveWordsEnabled,
    aiEnabled: cfg.aiEnabled,
    aiBaseUrl: cfg.aiBaseUrl ?? "",
    aiConfigured: Boolean(cfg.aiApiKey),
    aiModel: cfg.aiModel || null,
    aiThreshold: cfg.aiThreshold,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export type ModerationConfigPatch = {
  isEnabled?: boolean;
  sensitiveWordsEnabled?: boolean;
  aiEnabled?: boolean;
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  aiThreshold?: number;
};

export async function updateModerationConfig(patch: ModerationConfigPatch) {
  const env = getEnv();
  const data: Record<string, unknown> = {};

  if (patch.isEnabled !== undefined) data.isEnabled = patch.isEnabled;
  if (patch.sensitiveWordsEnabled !== undefined) {
    data.sensitiveWordsEnabled = patch.sensitiveWordsEnabled;
  }
  if (patch.aiEnabled !== undefined) data.aiEnabled = patch.aiEnabled;
  if (patch.aiBaseUrl !== undefined) {
    const trimmed = patch.aiBaseUrl.trim();
    data.aiBaseUrl = trimmed.length > 0 ? trimmed : null;
  }
  if (patch.aiApiKey !== undefined && patch.aiApiKey.trim().length > 0) {
    data.aiApiKeyEncrypted = await encryptProviderSecret(
      patch.aiApiKey,
      env.AUTH_SECRET,
    );
  }
  if (patch.aiModel !== undefined) {
    data.aiModel = patch.aiModel?.trim() || null;
  }
  if (patch.aiThreshold !== undefined) data.aiThreshold = patch.aiThreshold;

  if (Object.keys(data).length === 0) {
    return db.moderationConfig.findUnique({ where: { scope: "default" } });
  }

  return db.moderationConfig.upsert({
    where: { scope: "default" },
    update: data,
    create: { scope: "default", ...data },
  });
}