import type { ImageAvailability } from "@/lib/types";

export const IMAGE_AVAILABILITIES = ["available", "cleaned", "unavailable"] as const;

export function isImageAvailability(value: unknown): value is ImageAvailability {
  return typeof value === "string" && IMAGE_AVAILABILITIES.some((state) => state === value);
}

export type ImageAvailabilitySource = {
  mediaAssetId?: string | null;
  mediaAsset?: { state: string; activeObjectId: string | null; publicToken?: string | null } | null;
};

export const imageAvailabilityInclude = {
  mediaAsset: { select: { state: true, activeObjectId: true, publicToken: true } },
} as const;

export function getImageAvailability(image: ImageAvailabilitySource): ImageAvailability {
  if (!image.mediaAssetId) return "available";
  if (image.mediaAsset?.state === "DELETED") return "cleaned";
  return image.mediaAsset?.state === "AVAILABLE" && image.mediaAsset.activeObjectId
    ? "available" : "unavailable";
}

// Missing availability is a legacy cached DTO; current serializers always set it.
export function isImageAvailable(availability: ImageAvailability | undefined): boolean {
  return availability === undefined || availability === "available";
}

export function imageUnavailableMessage(availability: ImageAvailability | undefined): string {
  return availability === "cleaned" ? "图片已清理" : "图片暂不可用";
}

export function mergeImageAvailabilityState(previous: ImageAvailability | undefined, incoming: ImageAvailability | undefined): ImageAvailability | undefined {
  return previous === "cleaned" ? "cleaned" : incoming ?? previous;
}

export function mergeImageAvailability<T extends { id: string; availability?: ImageAvailability }>(previous: readonly T[], incoming: readonly T[]): T[] {
  const previousImages = new Map(previous.map((image) => [image.id, image]));
  return incoming.map((image) => {
    const availability = mergeImageAvailabilityState(previousImages.get(image.id)?.availability, image.availability);
    return availability === image.availability ? image : { ...image, availability };
  });
}
