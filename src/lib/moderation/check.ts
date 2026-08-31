import "server-only";

import { db } from "@/lib/db";
import { resolveModerationConfig } from "@/lib/moderation/config";
import { matchSensitiveWords } from "@/lib/moderation/sensitive-words";

const MODERATION_TIMEOUT_MS = 8_000;

export const MODERATION_BLOCK_MESSAGE = "提交内容包含违规描述，已拒绝生成";

type ModerationCheckInput = {
  userId: string;
  prompt?: string | null;
  negativePrompt?: string | null;
};

export type ModerationCheckResult =
  | { allowed: true }
  | { allowed: false; message: string };

type AiModerationOutcome =
  | { blocked: false }
  | { blocked: true; score: number; category: string | null };

/**
 * 内容审核：敏感词命中或 AI 判定违规 → 记录 ContentReview 并阻断。
 * AI 审核异常/超时 → 放行（不影响正常生成）。
 */
export async function checkGenerationInput(
  input: ModerationCheckInput,
): Promise<ModerationCheckResult> {
  const cfg = await resolveModerationConfig();
  if (!cfg.isEnabled) {
    return { allowed: true };
  }

  // 1. 敏感词
  if (cfg.sensitiveWordsEnabled) {
    const hits = matchSensitiveWords(input.prompt, input.negativePrompt);
    if (hits.length > 0) {
      await db.contentReview.create({
        data: {
          category: hits[0]?.category ?? null,
          hitWords: Array.from(new Set(hits.map((hit) => hit.word))),
          kind: "sensitive_word",
          negativePrompt: input.negativePrompt || null,
          prompt: input.prompt ?? "",
          userId: input.userId,
        },
      });
      return { allowed: false, message: MODERATION_BLOCK_MESSAGE };
    }
  }

  // 2. AI 审核（仅对 prompt）
  if (cfg.aiEnabled && cfg.aiBaseUrl && cfg.aiApiKey && input.prompt) {
    try {
      const outcome = await callModerationAi(cfg, input.prompt);
      if (outcome.blocked) {
        await db.contentReview.create({
          data: {
            aiModel: cfg.aiModel,
            aiScore: outcome.score,
            category: outcome.category,
            kind: "ai_moderation",
            negativePrompt: input.negativePrompt || null,
            prompt: input.prompt,
            userId: input.userId,
          },
        });
        return { allowed: false, message: MODERATION_BLOCK_MESSAGE };
      }
    } catch (error) {
      // 审核服务异常不阻断正常生成
      console.warn("[moderation] AI 审核异常，放行本次生成:", error);
    }
  }

  return { allowed: true };
}

async function callModerationAi(
  cfg: Awaited<ReturnType<typeof resolveModerationConfig>>,
  text: string,
): Promise<AiModerationOutcome> {
  const baseUrl = (cfg.aiBaseUrl ?? "").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/moderations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.aiApiKey ? { Authorization: `Bearer ${cfg.aiApiKey}` } : {}),
    },
    body: JSON.stringify({
      input: text,
      ...(cfg.aiModel ? { model: cfg.aiModel } : {}),
    }),
    signal: AbortSignal.timeout(MODERATION_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `moderation request failed: ${response.status} ${await response.text().catch(() => "")}`,
    );
  }

  const data = (await response.json()) as {
    results?: Array<{ flagged?: boolean; category_scores?: Record<string, number> }>;
  };
  const result = data.results?.[0];
  const flagged = Boolean(result?.flagged);
  const categoryScores = result?.category_scores ?? {};
  const maxScore = Object.values(categoryScores).reduce(
    (max, score) => Math.max(max, Number(score) || 0),
    0,
  );

  if (flagged || maxScore >= cfg.aiThreshold) {
    const topCategory = Object.entries(categoryScores).sort(
      (left, right) => (right[1] ?? 0) - (left[1] ?? 0),
    )[0]?.[0] ?? null;
    return { blocked: true, score: maxScore, category: topCategory };
  }

  return { blocked: false };
}