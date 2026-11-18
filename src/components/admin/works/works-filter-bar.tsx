"use client";

import { Film, ImageIcon, Layers, Search, X } from "lucide-react";
import Link from "next/link";

import type { AdminReviewCounts, AdminReviewMediaFilter } from "@/lib/server/works";
import type { WorkShowcaseStatus } from "@/lib/work-showcase";
import { AdminLinkTabs } from "../ui/admin-tabs";

type WorksFilterBarProps = {
  counts: AdminReviewCounts;
  mediaType: AdminReviewMediaFilter;
  q: string;
  status: WorkShowcaseStatus;
};

function buildWorksHref(params: {
  mediaType: AdminReviewMediaFilter;
  q: string;
  status: WorkShowcaseStatus;
}) {
  const sp = new URLSearchParams();
  sp.set("status", params.status);
  if (params.mediaType !== "all") sp.set("media", params.mediaType);
  if (params.q.trim()) sp.set("q", params.q.trim());
  return `/admin/works?${sp.toString()}`;
}

export function WorksFilterBar({
  counts,
  mediaType,
  q,
  status,
}: WorksFilterBarProps) {
  const currentHref = buildWorksHref({ mediaType, q, status });

  return (
    <div className="studio-card grid gap-3.5 p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <AdminLinkTabs
          activeHref={currentHref}
          ariaLabel="作品审核状态切换"
          layoutId="works-status-tabs"
          items={[
            {
              badge: counts.pending,
              href: buildWorksHref({ mediaType, q, status: "PENDING" }),
              label: "待审核投稿",
            },
            {
              badge: counts.takedownPending,
              href: buildWorksHref({ mediaType, q, status: "TAKEDOWN_PENDING" }),
              label: "待处理下架",
            },
            {
              badge: counts.featured,
              href: buildWorksHref({ mediaType, q, status: "FEATURED" }),
              label: "公开中作品",
            },
          ]}
        />

        <AdminLinkTabs
          activeHref={currentHref}
          ariaLabel="作品媒体类型切换"
          layoutId="works-media-tabs"
          items={[
            {
              href: buildWorksHref({ mediaType: "all", q, status }),
              icon: Layers,
              label: "全部类型",
            },
            {
              href: buildWorksHref({ mediaType: "image", q, status }),
              icon: ImageIcon,
              label: "图片作品",
            },
            {
              href: buildWorksHref({ mediaType: "video", q, status }),
              icon: Film,
              label: "视频作品",
            },
          ]}
        />
      </div>

      <form
        action="/admin/works"
        method="get"
        className="flex gap-2 border-t border-[var(--line)]/60 pt-3"
      >
        <input type="hidden" name="status" value={status} />
        {mediaType !== "all" ? (
          <input type="hidden" name="media" value={mediaType} />
        ) : null}
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--ink-soft)]"
            aria-hidden
          />
          <input
            key={q}
            name="q"
            defaultValue={q}
            placeholder="搜索提示词、作者邮箱、作者昵称或模型名称…"
            className="w-full rounded-xl border border-[var(--admin-line)] bg-white py-2 pr-9 pl-10 text-xs outline-none sm:text-sm"
          />
          {q ? (
            <Link
              href={buildWorksHref({ mediaType, q: "", status })}
              aria-label="清空作品搜索"
              className="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)]"
            >
              <X className="size-4" aria-hidden />
            </Link>
          ) : null}
        </div>
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-[#231810] px-5 py-2 text-xs font-semibold text-white transition hover:bg-[#c85a32] sm:text-sm"
        >
          筛选
        </button>
      </form>
    </div>
  );
}
