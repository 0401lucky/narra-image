import "server-only";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  decryptProviderSecret,
  encryptProviderSecret,
} from "@/lib/providers/provider-secret";

export type TurnstileScope =
  | "login"
  | "register"
  | "inviteRedeem"
  | "generate";

const SCOPE_FIELD: Record<TurnstileScope, "protectLogin" | "protectRegister" | "protectInviteRedeem" | "protectGenerate"> = {
  login: "protectLogin",
  register: "protectRegister",
  inviteRedeem: "protectInviteRedeem",
  generate: "protectGenerate",
};

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

async function getOrCreateConfig() {
  const existing = await db.turnstileConfig.findUnique({
    where: { scope: "default" },
  });
  if (existing) return existing;

  return db.turnstileConfig.create({
    data: { scope: "default" },
  });
}

export async function getTurnstileConfig() {
  return getOrCreateConfig();
}

export type PublicTurnstileConfig = {
  isEnabled: boolean;
  siteKey: string | null;
  protectLogin: boolean;
  protectRegister: boolean;
  protectInviteRedeem: boolean;
  protectGenerate: boolean;
};

export async function getPublicTurnstileConfig(): Promise<PublicTurnstileConfig> {
  const cfg = await getOrCreateConfig();
  const usable = cfg.isEnabled && Boolean(cfg.siteKey) && Boolean(cfg.secretEncrypted);
  return {
    isEnabled: usable,
    siteKey: usable ? cfg.siteKey : null,
    protectLogin: cfg.protectLogin,
    protectRegister: cfg.protectRegister,
    protectInviteRedeem: cfg.protectInviteRedeem,
    protectGenerate: cfg.protectGenerate,
  };
}

export async function isTurnstileRequired(scope: TurnstileScope) {
  const cfg = await getOrCreateConfig();
  if (!cfg.isEnabled || !cfg.siteKey || !cfg.secretEncrypted) return false;
  return cfg[SCOPE_FIELD[scope]];
}

export async function updateTurnstileConfig(input: {
  isEnabled?: boolean;
  siteKey?: string | null;
  secretKey?: string | null;
  protectLogin?: boolean;
  protectRegister?: boolean;
  protectInviteRedeem?: boolean;
  protectGenerate?: boolean;
}) {
  const env = getEnv();
  await getOrCreateConfig();

  const data: Record<string, unknown> = {};
  if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
  if (input.siteKey !== undefined) data.siteKey = input.siteKey || null;
  if (input.protectLogin !== undefined) data.protectLogin = input.protectLogin;
  if (input.protectRegister !== undefined) data.protectRegister = input.protectRegister;
  if (input.protectInviteRedeem !== undefined) data.protectInviteRedeem = input.protectInviteRedeem;
  if (input.protectGenerate !== undefined) data.protectGenerate = input.protectGenerate;
  if (input.secretKey !== undefined) {
    data.secretEncrypted = input.secretKey
      ? await encryptProviderSecret(input.secretKey, env.AUTH_SECRET)
      : null;
  }

  return db.turnstileConfig.update({
    where: { scope: "default" },
    data,
  });
}

type SiteVerifyResponse = {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
};

export async function verifyTurnstileToken(token: string): Promise<{
  ok: boolean;
  reason?: string;
}> {
  if (!token) return { ok: false, reason: "missing-token" };

  const cfg = await getOrCreateConfig();
  if (!cfg.secretEncrypted) {
    return { ok: false, reason: "secret-not-configured" };
  }

  let secret: string;
  try {
    secret = await decryptProviderSecret(cfg.secretEncrypted, getEnv().AUTH_SECRET);
  } catch {
    return { ok: false, reason: "secret-decrypt-failed" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: controller.signal,
    });
    const data = (await response.json()) as SiteVerifyResponse;
    if (data.success) return { ok: true };
    return { ok: false, reason: data["error-codes"]?.join(",") || "verify-failed" };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && error.name === "AbortError" ? "timeout" : "network-error",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function requireTurnstile(scope: TurnstileScope, token: string | undefined) {
  if (!(await isTurnstileRequired(scope))) return;
  const result = await verifyTurnstileToken(token ?? "");
  if (!result.ok) {
    throw new Error(`人机验证失败：${result.reason ?? "unknown"}`);
  }
}
