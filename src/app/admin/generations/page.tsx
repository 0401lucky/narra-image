import Link from "next/link";
import { redirect } from "next/navigation";

import { GenerationStatus } from "@prisma/client";
import { Grid2X2, List } from "lucide-react";

import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { SiteHeader } from "@/components/marketing/site-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { serializeUser } from "@/lib/prisma-mappers";
import {
  GenerationAdminCard,
  GenerationAdminList,
} from "@/components/admin/admin-actions";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { CleanupFailedButton } from "@/components/admin/cleanup-failed-button";
import { failStalePendingGenerationJobs } from "@/lib/generation/job-refund";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
type GenerationViewMode = "card" | "list";

function getParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function ViewModeSwitch({
  currentPage,
  view,
}: {
  currentPage: number;
  view: GenerationViewMode;
}) {
  const modes: Array<{
    href: string;
    icon: typeof Grid2X2;
    label: string;
    value: GenerationViewMode;
  }> = [
    {
      href: `/admin/generations?page=${currentPage}&view=card`,
      icon: Grid2X2,
      label: "卡片",
      value: "card",
    },
    {
      href: `/admin/generations?page=${currentPage}&view=list`,
      icon: List,
      label: "列表",
      value: "list",
    },
  ];

  return (
    <div className="inline-flex rounded-2xl border border-[var(--line)] bg-white/65 p-1 shadow-sm">
      {modes.map((mode) => {
        const Icon = mode.icon;
        const active = mode.value === view;
        return (
          <Link
            key={mode.value}
            href={mode.href}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-[var(--ink)] text-white shadow-sm"
                : "text-[var(--ink-soft)] hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-4" />
            {mode.label}
          </Link>
        );
      })}
    </div>
  );
}

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
  const viewParam = getParamValue(params.view);
  const view: GenerationViewMode = viewParam === "list" ? "list" : "card";

  await failStalePendingGenerationJobs();

  const visibleWhere = {
    status: { in: [GenerationStatus.SUCCEEDED, GenerationStatus.PENDING] },
  };

  const [jobs, totalCount, failedCount, pendingCount] = await Promise.all([
    db.generationJob.findMany({
      where: visibleWhere,
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
    db.generationJob.count({ where: visibleWhere }),
    db.generationJob.count({ where: { status: GenerationStatus.FAILED } }),
    db.generationJob.count({ where: { status: GenerationStatus.PENDING } }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className={`mx-auto grid gap-6 px-5 pt-8 md:px-8 ${view === "list" ? "max-w-[92rem]" : "max-w-7xl"}`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              生成记录
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              查看并管理所有用户生成的图片记录。当前显示 {totalCount} 条记录，其中 {pendingCount} 条生成中；失败任务已隐藏。
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
            <ViewModeSwitch currentPage={page} view={view} />
            <AdminNav currentPath="/admin/generations" />
          </div>
        </div>

        <CleanupFailedButton failedCount={failedCount} />

        {jobs.length > 0 ? (
          view === "list" ? (
            <GenerationAdminList jobs={jobs} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
              {jobs.map((job) => (
                <GenerationAdminCard key={job.id} job={job} />
              ))}
            </div>
          )
        ) : null}

        {jobs.length === 0 && (
          <div className="studio-card rounded-[1.8rem] border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-soft)]">
            暂无生成记录。
          </div>
        )}

        <AdminPagination
          currentPage={page}
          totalPages={totalPages}
          basePath="/admin/generations"
          extraParams={{ view }}
        />
      </section>
    </main>
  );
}
