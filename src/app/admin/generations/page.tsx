import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { SiteHeader } from "@/components/marketing/site-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { serializeUser } from "@/lib/prisma-mappers";
import { GenerationAdminCard } from "@/components/admin/admin-actions";

export const dynamic = "force-dynamic";

export default async function AdminGenerationsPage() {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const jobs = await db.generationJob.findMany({
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
    take: 36,
  });

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-6 md:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              生成记录
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              查看并管理所有用户生成的图片记录。
            </p>
          </div>
          <AdminNav currentPath="/admin/generations" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
          {jobs.map((job) => (
            <GenerationAdminCard key={job.id} job={job} />
          ))}
        </div>
      </section>
    </main>
  );
}
