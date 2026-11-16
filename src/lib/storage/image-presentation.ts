import "server-only";

import { getEnv } from "@/lib/env";
import type { ImageAvailability } from "@/lib/types";
import { getImageAvailability, type ImageAvailabilitySource } from "./image-availability";
import { imagePublicUrl } from "./image-contract";

export type ImagePresentation = { availability: ImageAvailability; url: string };

/** The stored URL is provenance. A managed image's browser URL follows its
 * logical token, independently of the active replica or default write backend. */
export function presentGenerationImage(image: ImageAvailabilitySource & { url: string }, appUrl?: string): ImagePresentation {
  const availability = getImageAvailability(image);
  if (availability !== "available") return { availability, url: "" };
  if (!image.mediaAssetId) return { availability, url: image.url };
  const token = image.mediaAsset?.publicToken;
  if (!token) return { availability: "unavailable", url: "" };
  try {
    return { availability, url: imagePublicUrl(appUrl ?? getEnv().APP_URL, token) };
  } catch {
    return { availability: "unavailable", url: "" };
  }
}
