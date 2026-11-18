import type { Prisma } from "@prisma/client";
import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";

import { AdminPagination } from "@/components/admin/admin-pagination";
import { ApiAdminPanel } from "@/components/admin/api-admin-panel";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { getApiConfig, serializeApiConfig } from "@/lib/api-config";
import { serializeApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export const metadata = {
  description: "管理全站 API Key 和统一速率限制。",
  title: "API 管理 — Narra Image",
};

export default async function AdminApiPage(props?: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const params = props?.searchParams ? await props.searchParams : {};
  const page = Math.max(1, Number(params.page) || 1);
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const status =
    params.status === "active" || params.status === "revoked"
      ? params.status
      : "";

  const clauses: Prisma.ApiKeyWhereInput[] = [];
  if (q) {
    clauses.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { keyPrefix: { contains: q, mode: "insensitive" } },
        { user: { is: { email: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  if (status === "active") {
    clauses.push({ revokedAt: null });
  } else if (status === "revoked") {
    clauses.push({ revokedAt: { not: null } });
  }

  const keyWhere: Prisma.ApiKeyWhereInput =
    clauses.length === 0
      ? {}
      : clauses.length === 1
        ? clauses[0]!
        : { AND: clauses };

  const [apiConfig, apiKeys, filteredCount, totalKeys, activeKeys] =
    await Promise.all([
      getApiConfig(),
      db.apiKey.findMany({
        include: {
          _count: {
            select: { generations: true },
          },
          user: {
            select: {
              email: true,
              id: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        where: keyWhere,
      }),
      db.apiKey.count({ where: keyWhere }),
      db.apiKey.count(),
      db.apiKey.count({ where: { revokedAt: null } }),
    ]);

  const totalPages = Math.ceil(filteredCount / PAGE_SIZE);
  const extraParams: Record<string, string> = {};
  if (q) extraParams.q = q;
  if (status) extraParams.status = status;

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Open API & Rate Limits"
          icon={KeyRound}
          title="开放 API 与密钥治理"
          description={`配置全站外部 /v1/* 接口统一速率上限，检索并治理用户 API 密钥（共 ${totalKeys} 个密钥，${activeKeys} 个启用中）。`}
        />

        <ApiAdminPanel
          apiConfig={serializeApiConfig(apiConfig)}
          apiKeys={apiKeys.map((apiKey) => ({
            ...serializeApiKey(apiKey),
            generationCount: apiKey._count.generations,
            user: apiKey.user,
          }))}
          q={q}
          statusFilter={status}
          totalCount={filteredCount}
        />

        <AdminPagination
          basePath="/admin/api"
          currentPage={page}
          totalPages={totalPages}
          extraParams={extraParams}
        />
      </section>
    </main>
  );
}
