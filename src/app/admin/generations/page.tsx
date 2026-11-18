import {
  GenerationClientSource,
  GenerationStatus,
  GenerationType,
  ProviderMode,
  type Prisma,
} from "@prisma/client";
import { Activity, Grid2X2, List } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminPagination } from "@/components/admin/admin-pagination";
import { CleanupFailedButton } from "@/components/admin/cleanup-failed-button";
import { GenerationSearchBar } from "@/components/admin/generation-search-bar";
import {
  buildGenerationsFilterUrl,
  type GenerationModeFilter,
  type GenerationSourceFilter,
  type GenerationStatusFilter,
  type GenerationTypeFilter,
} from "@/components/admin/generations/filter-url";
import { GenerationsBoard } from "@/components/admin/generations/generations-board";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { db } from "@/lib/db";
import { failStalePendingGenerationJobs } from "@/lib/generation/job-refund";
import { requireAdminRecord } from "@/lib/server/current-user";
import { imageAvailabilityInclude } from "@/lib/storage/image-availability";
import { presentGenerationImage } from "@/lib/storage/image-presentation";
import { projectGenerationSourceUrls } from "@/lib/storage/image-source-presentation";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
type GenerationViewMode = "card" | "list";

function getParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatusFilter(raw: string | undefined): GenerationStatusFilter {
  if (
    raw === "ALL" ||
    raw === "SUCCEEDED" ||
    raw === "ACTIVE" ||
    raw === "FAILED" ||
    raw === "COORDINATION"
  ) {
    return raw;
  }
  return "";
}

function parseTypeFilter(raw: string | undefined): GenerationTypeFilter {
  if (
    raw === "TEXT_TO_IMAGE" ||
    raw === "IMAGE_TO_IMAGE" ||
    raw === "TEXT_TO_VIDEO" ||
    raw === "IMAGE_TO_VIDEO"
  ) {
    return raw;
  }
  return "";
}

function parseSourceFilter(raw: string | undefined): GenerationSourceFilter {
  if (raw === "WEB" || raw === "API") return raw;
  return "";
}

function parseModeFilter(raw: string | undefined): GenerationModeFilter {
  if (raw === "BUILT_IN" || raw === "CUSTOM") return raw;
  return "";
}

function ViewModeSwitch({
  currentPage,
  mode,
  search,
  source,
  status,
  type,
  view,
}: {
  currentPage: number;
  mode: GenerationModeFilter;
  search: string;
  source: GenerationSourceFilter;
  status: GenerationStatusFilter;
  type: GenerationTypeFilter;
  view: GenerationViewMode;
}) {
  const modes: Array<{
    href: string;
    icon: typeof Grid2X2;
    label: string;
    value: GenerationViewMode;
  }> = [
    {
      href: buildGenerationsFilterUrl({
        mode,
        page: currentPage,
        q: search,
        source,
        status,
        type,
        view: "card",
      }),
      icon: Grid2X2,
      label: "卡片",
      value: "card",
    },
    {
      href: buildGenerationsFilterUrl({
        mode,
        page: currentPage,
        q: search,
        source,
        status,
        type,
        view: "list",
      }),
      icon: List,
      label: "列表",
      value: "list",
    },
  ];

  return (
    <div className="inline-flex rounded-xl border border-[var(--line)] bg-white p-1">
      {modes.map((item) => {
        const Icon = item.icon;
        const active = item.value === view;
        return (
          <Link
            key={item.value}
            href={item.href}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
              active
                ? "bg-[#231810] text-white"
                : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-3.5" aria-hidden />
            {item.label}
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
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const params = await searchParams;
  const page = Math.max(1, Number(getParamValue(params.page)) || 1);
  const viewParam = getParamValue(params.view);
  const view: GenerationViewMode = viewParam === "list" ? "list" : "card";
  const search = (getParamValue(params.q) ?? "").trim();
  const statusFilter = parseStatusFilter(getParamValue(params.status));
  const typeFilter = parseTypeFilter(getParamValue(params.type));
  const sourceFilter = parseSourceFilter(getParamValue(params.source));
  const modeFilter = parseModeFilter(getParamValue(params.mode));

  await failStalePendingGenerationJobs();

  const searchWhere: Prisma.GenerationJobWhereInput = search
    ? {
        OR: [
          { id: { contains: search, mode: "insensitive" } },
          { model: { contains: search, mode: "insensitive" } },
          { prompt: { contains: search, mode: "insensitive" } },
          { userId: { contains: search, mode: "insensitive" } },
          {
            user: {
              is: {
                OR: [
                  { email: { contains: search, mode: "insensitive" } },
                  { nickname: { contains: search, mode: "insensitive" } },
                ],
              },
            },
          },
        ],
      }
    : {};

  const withSearch = (
    where: Prisma.GenerationJobWhereInput,
  ): Prisma.GenerationJobWhereInput =>
    search ? { AND: [searchWhere, where] } : where;

  const defaultStatusClause: Prisma.GenerationJobWhereInput = {
    OR: [
      {
        status: {
          in: [
            GenerationStatus.SUCCEEDED,
            GenerationStatus.PENDING,
            GenerationStatus.PROCESSING,
          ],
        },
      },
      {
        contractVersion: { gte: 1 },
        handoffState: "UNKNOWN",
        status: GenerationStatus.FAILED,
      },
    ],
  };

  const hasExtraFilters = Boolean(
    statusFilter || typeFilter || sourceFilter || modeFilter,
  );

  let visibleWhere: Prisma.GenerationJobWhereInput;
  if (!hasExtraFilters) {
    // Preserve exact query shape when no extra filter parameters are active
    visibleWhere = withSearch(defaultStatusClause);
  } else {
    const andClauses: Prisma.GenerationJobWhereInput[] = [];
    if (search) andClauses.push(searchWhere);

    if (statusFilter === "") {
      andClauses.push(defaultStatusClause);
    } else if (statusFilter === "SUCCEEDED") {
      andClauses.push({ status: GenerationStatus.SUCCEEDED });
    } else if (statusFilter === "ACTIVE") {
      andClauses.push({
        status: { in: [GenerationStatus.PENDING, GenerationStatus.PROCESSING] },
      });
    } else if (statusFilter === "FAILED") {
      andClauses.push({ status: GenerationStatus.FAILED });
    } else if (statusFilter === "COORDINATION") {
      andClauses.push({
        contractVersion: { gte: 1 },
        handoffState: "UNKNOWN",
        status: GenerationStatus.FAILED,
      });
    }

    if (typeFilter) {
      andClauses.push({ generationType: typeFilter as GenerationType });
    }
    if (sourceFilter) {
      andClauses.push({ clientSource: sourceFilter as GenerationClientSource });
    }
    if (modeFilter) {
      andClauses.push({ providerMode: modeFilter as ProviderMode });
    }

    visibleWhere =
      andClauses.length === 0
        ? {}
        : andClauses.length === 1
          ? andClauses[0]!
          : { AND: andClauses };
  }

  const coordinationWhere = withSearch({
    contractVersion: { gte: 1 },
    handoffState: "UNKNOWN",
    status: GenerationStatus.FAILED,
  });
  const pendingWhere = withSearch({
    status: { in: [GenerationStatus.PENDING, GenerationStatus.PROCESSING] },
  });

  const [storedJobs, totalCount, failedCount, pendingCount, coordinationCount] =
    await Promise.all([
      db.generationJob.findMany({
        include: {
          images: {
            include: imageAvailabilityInclude,
            orderBy: { createdAt: "asc" },
          },
          user: {
            select: {
              email: true,
              nickname: true,
            },
          },
          videos: {
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        where: visibleWhere,
      }),
      db.generationJob.count({ where: visibleWhere }),
      db.generationJob.count({
        where: {
          attempts: { none: {} },
          contractVersion: { lt: 1 },
          status: GenerationStatus.FAILED,
        },
      }),
      db.generationJob.count({ where: pendingWhere }),
      db.generationJob.count({ where: coordinationWhere }),
    ]);

  const jobs = await projectGenerationSourceUrls(
    storedJobs.map((job) => ({
      ...job,
      images: job.images.map(({ mediaAsset, ...image }) => ({
        ...image,
        ...presentGenerationImage({ ...image, mediaAsset }),
      })),
    })),
  );
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const extraParams: Record<string, string> = { view };
  if (search) extraParams.q = search;
  if (statusFilter) extraParams.status = statusFilter;
  if (typeFilter) extraParams.type = typeFilter;
  if (sourceFilter) extraParams.source = sourceFilter;
  if (modeFilter) extraParams.mode = modeFilter;

  return (
    <main className="pb-16">
      <section
        className={`mx-auto grid gap-6 px-5 pt-7 md:px-8 ${
          view === "list" ? "max-w-[92rem]" : "max-w-7xl"
        }`}
      >
        <AdminPageHeader
          eyebrow="Generations & Diagnostics"
          icon={Activity}
          title="生成流水与排障"
          description={`全量监测图文与视频生成记录，点击「排障」可查看只读重试轨迹与上游请求 ID。当前筛选命中 ${totalCount} 条（生成中 ${pendingCount} 条 · 需人工协调 ${coordinationCount} 条）。`}
          actions={
            <ViewModeSwitch
              currentPage={page}
              mode={modeFilter}
              search={search}
              source={sourceFilter}
              status={statusFilter}
              type={typeFilter}
              view={view}
            />
          }
        />

        <GenerationSearchBar
          initialValue={search}
          mode={modeFilter}
          source={sourceFilter}
          status={statusFilter}
          type={typeFilter}
          view={view}
        />

        <CleanupFailedButton failedCount={failedCount} />

        {jobs.length > 0 ? (
          <GenerationsBoard jobs={jobs} view={view} />
        ) : (
          <div className="studio-card rounded-2xl border border-dashed border-[var(--line)] p-10 text-center text-sm text-[var(--ink-soft)]">
            {search || hasExtraFilters
              ? "没有符合当前检索与筛选条件的生成记录。"
              : "暂无生成记录。"}
          </div>
        )}

        <AdminPagination
          currentPage={page}
          totalPages={totalPages}
          basePath="/admin/generations"
          extraParams={extraParams}
        />
      </section>
    </main>
  );
}
