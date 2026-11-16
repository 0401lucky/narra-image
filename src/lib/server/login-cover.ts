import "server-only";

import { db } from "@/lib/db";
import { ImageStorageError } from "@/lib/storage/image-contract";
import { resolveManagedImageUrl } from "@/lib/storage/managed-image-storage";
import { presentGenerationImage } from "@/lib/storage/image-presentation";
import { bindManagedImageInputAliases } from "@/lib/storage/image-input-aliases";
import { lockImageReferenceEpoch } from "@/lib/storage/image-reference-lock";

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

/** Public display follows an exact registered alias while settings retain the
 * configured source string for editing and immutable history provenance. */
export async function getLoginCoverDisplayConfig(stored?: LoginCoverConfig): Promise<LoginCoverConfig> {
  const config = stored ?? await getLoginCoverConfig();
  if (config.mode !== "custom" || !config.customUrl) return config;
  try {
    const image = await resolveManagedImageUrl(config.customUrl);
    if (!image) return config;
    const presentation = presentGenerationImage({ url: config.customUrl, mediaAssetId: image.asset.id, mediaAsset: image.asset });
    return { mode: config.mode, customUrl: presentation.url || null };
  } catch (error) {
    if (error instanceof ImageStorageError && error.code === "IMAGE_UNAVAILABLE") return { mode: config.mode, customUrl: null };
    throw error;
  }
}

export async function updateLoginCoverConfig(
  data: Partial<LoginCoverConfig>,
): Promise<LoginCoverConfig> {
  const config = await db.$transaction(async (tx) => {
    await lockImageReferenceEpoch(tx);
    const current = await tx.loginCoverConfig.findUnique({ where: { scope: "default" } });
    const mode = data.mode ?? current?.mode ?? "featured";
    const customUrl = data.customUrl !== undefined ? data.customUrl : current?.customUrl ?? null;
    if (mode === "custom" && customUrl) await bindManagedImageInputAliases(tx, [customUrl]);
    return tx.loginCoverConfig.upsert({
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
  });

  return {
    mode: config.mode as LoginCoverMode,
    customUrl: config.customUrl,
  };
}
