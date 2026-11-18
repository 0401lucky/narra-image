import { ShowcaseStatus } from "@prisma/client";
import { ImageIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminWorksBoard } from "@/components/admin/admin-works-board";
import { ShowcaseAutoApproveToggle } from "@/components/admin/showcase-auto-approve-toggle";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { WorksFilterBar } from "@/components/admin/works/works-filter-bar";
import { getBenefitConfig } from "@/lib/benefits/config";
import { requireAdminRecord } from "@/lib/server/current-user";
import {
  getAdminReviewCounts,
  listAdminReviewPage,
  type AdminReviewMediaFilter,
} from "@/lib/server/works";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function AdminWorksPage(props?: {
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
  const mediaType: AdminReviewMediaFilter =
    params.media === "image" || params.media === "video" ? params.media : "all";

  const counts = await getAdminReviewCounts();

  let status: ShowcaseStatus = ShowcaseStatus.PENDING;
  if (
    params.status === "PENDING" ||
    params.status === "TAKEDOWN_PENDING" ||
    params.status === "FEATURED"
  ) {
    status = params.status;
  } else if (counts.pending === 0 && counts.takedownPending > 0) {
    status = ShowcaseStatus.TAKEDOWN_PENDING;
  } else if (counts.pending === 0 && counts.takedownPending === 0) {
    status = ShowcaseStatus.FEATURED;
  }

  const [pageData, benefitConfig] = await Promise.all([
    listAdminReviewPage({
      mediaType,
      page,
      pageSize: PAGE_SIZE,
      q,
      status,
    }),
    getBenefitConfig(),
  ]);

  const totalPages = Math.ceil(pageData.totalCount / PAGE_SIZE);
  const extraParams: Record<string, string> = { status };
  if (mediaType !== "all") extraParams.media = mediaType;
  if (q) extraParams.q = q;

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Works Review"
          icon={ImageIcon}
          title="作品投稿与公开审核"
          description="分队列审核用户提交至精选画廊的图片与视频作品，支持关键词检索与多选批量处理。"
        />

        <ShowcaseAutoApproveToggle
          initialValue={benefitConfig.autoApproveShowcase}
        />

        <WorksFilterBar
          counts={counts}
          mediaType={mediaType}
          q={q}
          status={status}
        />

        <AdminWorksBoard
          activeStatus={status}
          enableBatch
          works={pageData.items}
        />

        <AdminPagination
          basePath="/admin/works"
          currentPage={page}
          totalPages={totalPages}
          extraParams={extraParams}
        />
      </section>
    </main>
  );
}
