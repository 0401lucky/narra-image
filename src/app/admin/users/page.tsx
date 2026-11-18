import { Role, type Prisma } from "@prisma/client";
import { Users } from "lucide-react";
import { redirect } from "next/navigation";

import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import {
  UsersManagementBoard,
  type UsersFilterState,
} from "@/components/admin/users/users-management-board";
import { db } from "@/lib/db";
import { fromPrismaRole } from "@/lib/prisma-mappers";
import { requireAdminRecord } from "@/lib/server/current-user";

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
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const role: UsersFilterState["role"] =
    params.role === "ADMIN" || params.role === "USER" ? params.role : "";
  const status: UsersFilterState["status"] =
    params.status === "active" || params.status === "banned" ? params.status : "";
  const auth: UsersFilterState["auth"] =
    params.auth === "oauth" || params.auth === "password" ? params.auth : "";
  const sort: UsersFilterState["sort"] =
    params.sort === "credits" || params.sort === "generations"
      ? params.sort
      : "newest";
  const view: UsersFilterState["view"] =
    params.view === "card" ? "card" : "table";

  const where: Prisma.UserWhereInput = {
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { nickname: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(role ? { role: role === "ADMIN" ? Role.ADMIN : Role.USER } : {}),
    ...(status === "banned"
      ? { bannedAt: { not: null } }
      : status === "active"
        ? { bannedAt: null }
        : {}),
    ...(auth === "oauth"
      ? { oauthProvider: { not: null } }
      : auth === "password"
        ? { oauthProvider: null }
        : {}),
  };

  const orderBy: Prisma.UserOrderByWithRelationInput =
    sort === "credits"
      ? { credits: "desc" }
      : sort === "generations"
        ? { generations: { _count: "desc" } }
        : { createdAt: "desc" };

  const [users, filteredCount, totalUsers, bannedCount, adminCount] =
    await Promise.all([
      db.user.findMany({
        orderBy,
        select: {
          _count: { select: { generations: true } },
          bannedAt: true,
          createdAt: true,
          credits: true,
          email: true,
          id: true,
          nickname: true,
          oauthProvider: true,
          role: true,
        },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        where,
      }),
      db.user.count({ where }),
      db.user.count(),
      db.user.count({ where: { bannedAt: { not: null } } }),
      db.user.count({ where: { role: Role.ADMIN } }),
    ]);

  const totalPages = Math.ceil(filteredCount / PAGE_SIZE);

  const serializedUsers = users.map((user) => ({
    banned: user.bannedAt !== null,
    bannedAt: user.bannedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    credits: user.credits,
    email: user.email,
    generationCount: user._count.generations,
    id: user.id,
    nickname: user.nickname,
    oauthProvider: user.oauthProvider,
    role: fromPrismaRole(user.role),
  }));

  const extraParams: Record<string, string> = {};
  if (q) extraParams.q = q;
  if (role) extraParams.role = role;
  if (status) extraParams.status = status;
  if (auth) extraParams.auth = auth;
  if (sort !== "newest") extraParams.sort = sort;
  if (view !== "table") extraParams.view = view;

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Users"
          icon={Users}
          title="用户池与资产管理"
          description="检索与管理全站用户权限、积分余额及账号状态，点击任意用户可打开 360° 全景档案抽屉。"
          badges={
            <>
              <span className="rounded-full border border-[var(--line)] bg-white px-2.5 py-0.5 font-mono text-xs text-[var(--ink-soft)]">
                总计 {totalUsers.toLocaleString("zh-CN")} 人
              </span>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-amber-800">
                管理员 {adminCount}
              </span>
              {bannedCount > 0 ? (
                <span className="rounded-full bg-rose-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-rose-700">
                  封禁 {bannedCount}
                </span>
              ) : null}
            </>
          }
        />

        <UsersManagementBoard
          currentAdminId={admin.id}
          filters={{ auth, q, role, sort, status, view }}
          totalCount={filteredCount}
          users={serializedUsers}
        />

        <AdminPagination
          currentPage={page}
          totalPages={totalPages}
          basePath="/admin/users"
          extraParams={Object.keys(extraParams).length ? extraParams : undefined}
        />
      </section>
    </main>
  );
}
