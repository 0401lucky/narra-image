import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { SiteHeader } from "@/components/marketing/site-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { serializeUser, fromPrismaRole } from "@/lib/prisma-mappers";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { UserAdminCard } from "@/components/admin/user-admin-card";
import { UserSearchBar } from "@/components/admin/user-search-bar";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const search = typeof params.q === "string" ? params.q.trim() : "";

  const where = search
    ? {
        OR: [
          { email: { contains: search, mode: "insensitive" as const } },
          { nickname: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [users, totalCount] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        _count: { select: { generations: true } },
        createdAt: true,
        credits: true,
        email: true,
        id: true,
        nickname: true,
        role: true,
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.user.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const serializedUsers = users.map((user) => ({
    createdAt: user.createdAt.toISOString(),
    credits: user.credits,
    email: user.email,
    generationCount: user._count.generations,
    id: user.id,
    nickname: user.nickname,
    role: fromPrismaRole(user.role),
  }));

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              用户管理
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              管理所有用户的积分、角色与产出数据。共 {totalCount} 名用户。
            </p>
          </div>
          <AdminNav currentPath="/admin/users" />
        </div>

        <UserSearchBar initialValue={search} />

        {serializedUsers.length === 0 ? (
          <div className="studio-card rounded-[1.8rem] border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-soft)]">
            {search ? `没有找到包含 "${search}" 的用户。` : "暂无注册用户。"}
          </div>
        ) : (
          <div className="grid gap-4">
            {serializedUsers.map((user) => (
              <UserAdminCard
                key={user.id}
                user={user}
                isCurrentAdmin={user.id === admin.id}
              />
            ))}
          </div>
        )}

        <AdminPagination
          currentPage={page}
          totalPages={totalPages}
          basePath="/admin/users"
          extraParams={search ? { q: search } : undefined}
        />
      </section>
    </main>
  );
}
