import "server-only";

import { ZodError } from "zod";

import { getEnv, isManagedImageStorageConfigured } from "@/lib/env";
import { requireAdminRecord } from "@/lib/server/current-user";
import { jsonError, jsonOk } from "@/lib/server/http";
import { ImageStorageError } from "@/lib/storage/image-contract";
import type { ImageManagementOverview } from "@/lib/storage/image-management-types";
import { ImageRepository } from "@/lib/storage/image-repository";

export async function getStorageManagementOverview(): Promise<ImageManagementOverview> {
  const overview = await new ImageRepository().getStorageOverview();
  return {
    ...overview,
    managedEnabled: isManagedImageStorageConfigured(),
    writeBackend: getEnv().IMAGE_STORAGE_BACKEND,
  };
}

export async function storageAdminResponse<T>(
  action: (admin: Awaited<ReturnType<typeof requireAdminRecord>>, repository: ImageRepository) => Promise<T>,
) {
  try {
    const admin = await requireAdminRecord();
    return jsonOk(await action(admin, new ImageRepository()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "请先登录") {
      return jsonError("请先登录", 401, "STORAGE_UNAUTHENTICATED");
    }
    if (error instanceof Error && error.message === "没有管理员权限") {
      return jsonError("没有管理员权限", 403, "STORAGE_FORBIDDEN");
    }
    if (error instanceof ImageStorageError) return jsonError(error.message, error.status, error.code);
    if (error instanceof ZodError) return jsonError(error.issues[0]?.message ?? "存储管理参数不正确", 400, "IMAGE_INVALID_INPUT");
    if (error instanceof SyntaxError) return jsonError("请求体不是合法 JSON", 400, "IMAGE_INVALID_INPUT");
    return jsonError("存储管理暂不可用，请稍后重试", 500, "IMAGE_STORAGE_UNAVAILABLE");
  }
}
