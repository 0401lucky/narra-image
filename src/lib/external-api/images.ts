import "server-only";

import type { ImageAvailabilitySource } from "@/lib/storage/image-availability";
import { ImageStorageError } from "@/lib/storage/image-contract";
import { presentGenerationImage } from "@/lib/storage/image-presentation";

const MAX_B64_RESPONSE_IMAGE_BYTES = 25 * 1024 * 1024;

type ExternalImageResponseFormat = "url" | "b64_json";

type GeneratedImageForResponse = ImageAvailabilitySource & {
  height: number | null;
  url: string;
  width: number | null;
};

function readDataUrlBase64(url: string) {
  const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) return null;

  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  if (isBase64) return payload.trim();

  return Buffer.from(decodeURIComponent(payload), "utf8").toString("base64");
}

async function imageUrlToBase64(image: GeneratedImageForResponse) {
  const { url } = image;
  if (image.mediaAssetId) {
    const [{ ImageRepository }, { readManagedImage }] = await Promise.all([
      import("@/lib/storage/image-repository"), import("@/lib/storage/managed-image-storage"),
    ]);
    const managed = await new ImageRepository().getByAssetId(image.mediaAssetId);
    if (!managed) throw new ImageStorageError("IMAGE_UNAVAILABLE");
    if (BigInt(managed.asset.byteLength) > BigInt(MAX_B64_RESPONSE_IMAGE_BYTES)) throw new Error("生成图片超过 b64_json 响应大小限制");
    return (await readManagedImage(managed)).toString("base64");
  }
  const dataUrlBase64 = readDataUrlBase64(url);
  if (dataUrlBase64) return dataUrlBase64;

  const { resolveManagedImageUrl, readManagedImage } = await import("@/lib/storage/managed-image-storage");
  const managed = await resolveManagedImageUrl(url);
  if (managed) {
    if (BigInt(managed.asset.byteLength) > BigInt(MAX_B64_RESPONSE_IMAGE_BYTES)) throw new Error("生成图片超过 b64_json 响应大小限制");
    return (await readManagedImage(managed)).toString("base64");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取生成图片失败，无法返回 b64_json（HTTP ${response.status}）`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_B64_RESPONSE_IMAGE_BYTES) {
    throw new Error("生成图片超过 b64_json 响应大小限制");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_B64_RESPONSE_IMAGE_BYTES) {
    throw new Error("生成图片超过 b64_json 响应大小限制");
  }

  return Buffer.from(arrayBuffer).toString("base64");
}

export async function formatImageGenerationData(
  images: GeneratedImageForResponse[],
  responseFormat: ExternalImageResponseFormat,
) {
  const presentations = images.map((image) => presentGenerationImage(image));
  if (presentations.some((image) => image.availability !== "available" || !image.url)) throw new ImageStorageError("IMAGE_UNAVAILABLE");
  if (responseFormat === "url") {
    return images.map((image, index) => ({
      height: image.height,
      url: presentations[index].url,
      width: image.width,
    }));
  }

  return Promise.all(
    images.map(async (image, index) => ({
      b64_json: await imageUrlToBase64(image),
      height: image.height,
      url: presentations[index].url,
      width: image.width,
    })),
  );
}
