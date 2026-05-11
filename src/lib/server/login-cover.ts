import "server-only";

import { db } from "@/lib/db";

export type LoginCoverMode = "featured" | "custom";

export type LoginCoverConfig = {
  mode: LoginCoverMode;
  customUrl: string | null;
};

export async function getLoginCoverConfig(): Promise<LoginCoverConfig> {
  const config = await db.loginCoverConfig.findUnique({
    where: { scope: "default" },
  });

  return {
    mode: (config?.mode as LoginCoverMode) ?? "featured",
    customUrl: config?.customUrl ?? null,
  };
}

export async function updateLoginCoverConfig(
  data: Partial<LoginCoverConfig>,
): Promise<LoginCoverConfig> {
  const config = await db.loginCoverConfig.upsert({
    where: { scope: "default" },
    create: {
      mode: data.mode ?? "featured",
      customUrl: data.customUrl ?? null,
    },
    update: {
      ...(data.mode !== undefined ? { mode: data.mode } : {}),
      ...(data.customUrl !== undefined ? { customUrl: data.customUrl } : {}),
    },
  });

  return {
    mode: config.mode as LoginCoverMode,
    customUrl: config.customUrl,
  };
}
