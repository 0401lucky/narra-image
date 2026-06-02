import { db } from "@/lib/db";
import { serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { jsonError, jsonOk } from "@/lib/server/http";

export async function GET() {
  const user = await getCurrentUserRecord();
  if (!user) {
    return jsonError("未登录", 401);
  }

  const savedProvider = await db.savedProviderConfig.findUnique({
    where: { userId: user.id },
    select: {
      baseUrl: true,
      id: true,
      label: true,
      model: true,
      models: true,
      updatedAt: true,
    },
  });

  return jsonOk({
    savedProvider: savedProvider
      ? {
          ...savedProvider,
          updatedAt: savedProvider.updatedAt.toISOString(),
        }
      : null,
    user: serializeUser(user),
  });
}
