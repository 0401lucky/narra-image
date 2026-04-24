import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import { fromPrismaRole } from "@/lib/prisma-mappers";

export async function GET(request: Request) {
  try {
    await requireAdminRecord();

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const search = url.searchParams.get("q")?.trim() || "";
    const pageSize = 20;

    const where = search
      ? { email: { contains: search, mode: "insensitive" as const } }
      : {};

    const [users, totalCount] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          _count: {
            select: {
              generations: true,
            },
          },
          createdAt: true,
          credits: true,
          email: true,
          id: true,
          role: true,
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.user.count({ where }),
    ]);

    return jsonOk({
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      users: users.map((user) => ({
        createdAt: user.createdAt.toISOString(),
        credits: user.credits,
        email: user.email,
        generationCount: user._count.generations,
        id: user.id,
        role: fromPrismaRole(user.role),
      })),
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}
