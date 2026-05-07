import { redirect } from "next/navigation";

import { ApiAdminPanel } from "@/components/admin/api-admin-panel";
import { getApiConfig, serializeApiConfig } from "@/lib/api-config";
import { serializeApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "API 管理 — Narra Image",
  description: "管理全站 API Key 和统一速率限制。",
};

export default async function AdminApiPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const [apiConfig, apiKeys] = await Promise.all([
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
      take: 200,
    }),
  ]);

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="admin-eyebrow">API</p>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              API 管理
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--ink-soft)]">
              设置外部 API 的统一速率限制，查看全站 API Key 使用情况，并停用异常调用来源。
            </p>
          </div>
        </div>

        <ApiAdminPanel
          apiConfig={serializeApiConfig(apiConfig)}
          apiKeys={apiKeys.map((apiKey) => ({
            ...serializeApiKey(apiKey),
            generationCount: apiKey._count.generations,
            user: apiKey.user,
          }))}
        />
      </section>
    </main>
  );
}
