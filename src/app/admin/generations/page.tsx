import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { SiteHeader } from "@/components/marketing/site-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { serializeUser } from "@/lib/prisma-mappers";
import { GenerationAdminCard } from "@/components/admin/admin-actions";
import { AdminPagination } from "@/components/admin/admin-pagination";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function AdminGenerationsPage({
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

  const [jobs, totalCount] = await Promise.all([
    db.generationJob.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
        },
        user: {
          select: {
            email: true,
          },
        },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.generationJob.count(),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              生成记录
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              查看并管理所有用户生成的图片记录。共 {totalCount} 条记录。
            </p>
          </div>
          <AdminNav currentPath="/admin/generations" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
          {jobs.map((job) => (
            <GenerationAdminCard key={job.id} job={job} />
          ))}
        </div>

        {jobs.length === 0 && (
          <div className="studio-card rounded-[1.8rem] border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-soft)]">
            暂无生成记录。
          </div>
        )}

        <AdminPagination
          currentPage={page}
          totalPages={totalPages}
          basePath="/admin/generations"
        />
      </section>
    </main>
  );
}
