import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { jsonError, jsonOk, getErrorMessage } from "@/lib/server/http";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

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

export async function POST(request: Request) {
  try {
    const user = await getCurrentUserRecord();
    if (!user) {
      return jsonError("未登录", 401);
    }

    const formData = await request.formData();
    const file = formData.get("avatar") as File | null;
    if (!file) {
      return jsonError("请上传头像文件");
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return jsonError("头像仅支持 JPG、PNG、WebP 格式");
    }

    if (file.size > MAX_SIZE) {
      return jsonError("头像文件大小不能超过 2MB");
    }

    const env = getEnv();
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const fileName = `avatars/${user.id}/${randomUUID()}.${ext}`;

    const client = createS3Client();
    let avatarUrl: string;

    if (client && env.S3_BUCKET) {
      await client.send(
        new PutObjectCommand({
          Body: buffer,
          Bucket: env.S3_BUCKET,
          ContentType: file.type,
          Key: fileName,
        }),
      );

      if (env.S3_PUBLIC_BASE_URL) {
        avatarUrl = `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${fileName}`;
      } else {
        avatarUrl = `${(env.S3_ENDPOINT || "").replace(/\/$/, "")}/${env.S3_BUCKET}/${fileName}`;
      }
    } else if (env.ENABLE_LOCAL_IMAGE_FALLBACK) {
      const base64 = buffer.toString("base64");
      avatarUrl = `data:${file.type};base64,${base64}`;
    } else {
      return jsonError("当前没有可用的图片存储配置");
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: { avatarUrl },
      select: {
        avatarUrl: true,
        credits: true,
        email: true,
        id: true,
        nickname: true,
        role: true,
      },
    });

    return jsonOk({ user: serializeUser(updated) });
  } catch (error) {
    return jsonError(getErrorMessage(error));
  }
}
