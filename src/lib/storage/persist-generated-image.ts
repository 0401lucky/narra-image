import "server-only";

import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { getEnv } from "@/lib/env";

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
  if ("url" in input) {
    return input.url;
  }

  const env = getEnv();
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
