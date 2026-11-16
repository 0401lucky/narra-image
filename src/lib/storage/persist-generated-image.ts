import "server-only";

import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { getEnv } from "@/lib/env";

const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 30_000;
const REMOTE_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

type PersistImageInput =
  | {
      b64Json: string;
      mimeType?: string;
      userId: string;
    }
  | {
      buffer: Buffer;
      fileExtension?: string;
      mimeType?: string;
      userId: string;
    }
  | {
      url: string;
      userId: string;
    };

function normalizeImageMimeType(value: string | null) {
  const mediaType = value?.split(";")[0]?.trim().toLowerCase();
  return mediaType?.startsWith("image/") ? mediaType : "image/png";
}

function extensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/png":
      return "png";
    default:
      return null;
  }
}

function extensionFromRemoteUrl(rawUrl: string, mimeType: string) {
  const mimeExtension = extensionFromMimeType(mimeType);
  if (mimeExtension) {
    return mimeExtension;
  }

  try {
    const extension = new URL(rawUrl).pathname.split(".").pop()?.toLowerCase();
    if (extension && ["gif", "jpg", "jpeg", "png", "webp"].includes(extension)) {
      return extension === "jpeg" ? "jpg" : extension;
    }
  } catch {
    // URL 已在 fetch 阶段校验；这里仅兜底文件后缀。
  }

  return "png";
}

async function fetchRemoteImage(rawUrl: string) {
  const response = await fetch(rawUrl, {
    signal: AbortSignal.timeout(REMOTE_IMAGE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`远程图片下载失败：HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > REMOTE_IMAGE_MAX_BYTES) {
    throw new Error("远程图片过大，无法保存");
  }

  if (!response.body) throw new Error("远程图片为空，无法保存");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > REMOTE_IMAGE_MAX_BYTES) throw new Error("远程图片过大，无法保存");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const buffer = Buffer.concat(chunks, length);

  const mimeType = normalizeImageMimeType(response.headers.get("content-type"));
  return {
    buffer,
    fileExtension: extensionFromRemoteUrl(rawUrl, mimeType),
    mimeType,
  };
}

function createS3Client() {
  const env = getEnv();

  if (
    !env.S3_BUCKET ||
    !env.S3_ENDPOINT ||
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY
  ) {
    return null;
  }

  return new S3Client({
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    region: env.S3_REGION,
  });
}

export async function persistGeneratedImage(input: PersistImageInput) {
  const env = getEnv();
  if ("url" in input) {
    const { readManagedImage, resolveManagedImageUrl } = await import("./managed-image-storage");
    const managed = await resolveManagedImageUrl(input.url);
    if (managed) {
      const bytes = await readManagedImage(managed);
      return persistGeneratedImage({ buffer: bytes, mimeType: managed.asset.mimeType, userId: input.userId });
    }
    const remoteImage = await fetchRemoteImage(input.url);
    return persistGeneratedImage({
      buffer: remoteImage.buffer,
      fileExtension: remoteImage.fileExtension,
      mimeType: remoteImage.mimeType,
      userId: input.userId,
    });
  }

  if (env.IMAGE_STORAGE_MANAGED_ENABLED) {
    const { MAX_IMAGE_BYTES, ImageStorageError } = await import("./image-contract");
    if ("b64Json" in input && input.b64Json.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new ImageStorageError("IMAGE_INVALID_INPUT");
    const body = "buffer" in input ? input.buffer : Buffer.from(input.b64Json, "base64");
    const { persistManagedImageBytes } = await import("./managed-image-storage");
    return persistManagedImageBytes(body, input.userId);
  }
  const client = createS3Client();
  const extension = "fileExtension" in input ? input.fileExtension || "png" : "png";
  const fileName = `${input.userId}/${randomUUID()}.${extension}`;
  const body =
    "buffer" in input ? input.buffer : Buffer.from(input.b64Json, "base64");

  if (client && env.S3_BUCKET) {
    await client.send(
      new PutObjectCommand({
        Body: body,
        Bucket: env.S3_BUCKET,
        ContentType: input.mimeType ?? "image/png",
        Key: fileName,
      }),
    );

    if (env.S3_PUBLIC_BASE_URL) {
      return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${fileName}`;
    }

    return `${(env.S3_ENDPOINT || "").replace(/\/$/, "")}/${env.S3_BUCKET}/${fileName}`;
  }

  if (env.ENABLE_LOCAL_IMAGE_FALLBACK) {
    const base64 = "buffer" in input ? input.buffer.toString("base64") : input.b64Json;
    return `data:${input.mimeType ?? "image/png"};base64,${base64}`;
  }

  throw new Error("当前没有可用的图片存储配置");
}
