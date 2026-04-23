"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useState } from "react";
import { Download, Expand } from "lucide-react";

import type { SerializedWork } from "@/lib/prisma-mappers";
import { canShowWorkPrompt, isFeaturedWork } from "@/lib/work-showcase";
import { downloadImage } from "@/components/works/download-image";
import { ImageLightbox } from "@/components/works/image-lightbox";
import { WorkShareButton } from "@/components/works/work-share-button";
import {
  WorkShowcaseControls,
  WorkStatusBadge,
} from "@/components/works/work-showcase-controls";

function formatTime(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

type WorkDetailPanelProps = {
  detailUrl: string;
  isOwner: boolean;
  work: SerializedWork;
};

export function WorkDetailPanel({
  detailUrl,
  isOwner,
  work,
}: WorkDetailPanelProps) {
  const [zoomed, setZoomed] = useState(false);

  const showPrompt = canShowWorkPrompt({
    isOwner,
    showcaseStatus: work.showcaseStatus,
    showPromptPublic: work.showPromptPublic,
  });

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="studio-card overflow-hidden rounded-[2rem] p-4 md:p-6">
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="group relative block w-full overflow-hidden rounded-[1.7rem] border border-[var(--line)] bg-[var(--surface-strong)]/40"
          >
            <img
              src={work.url}
              alt="作品图片"
              className="max-h-[78vh] w-full object-contain transition duration-500 group-hover:scale-[1.01]"
            />
            <span className="absolute right-4 top-4 rounded-full bg-black/55 p-2 text-white opacity-0 transition group-hover:opacity-100">
              <Expand className="size-4" />
            </span>
          </button>
        </div>

        <aside className="grid gap-5 self-start">
          <div className="studio-card rounded-[2rem] p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <WorkStatusBadge status={work.showcaseStatus} />
              {isFeaturedWork(work.showcaseStatus) ? (
                <span className="text-sm text-[var(--ink-soft)]">匿名创作者</span>
              ) : null}
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--ink)]">
              单图作品详情
            </h1>

            <div className="mt-4 grid gap-3 text-sm text-[var(--ink-soft)]">
              <p>模型：{work.model}</p>
              <p>尺寸：{work.size}</p>
              <p>作品创建时间：{formatTime(work.createdAt)}</p>
              {work.featuredAt ? <p>公开时间：{formatTime(work.featuredAt)}</p> : null}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void downloadImage(work.url)}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent)]"
              >
                <Download className="size-4" />
                下载图片
              </button>
              {isFeaturedWork(work.showcaseStatus) ? <WorkShareButton url={detailUrl} /> : null}
              {isOwner ? (
                <Link
                  href="/works"
                  className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  返回作品页
                </Link>
              ) : null}
            </div>
          </div>

          {isOwner ? <WorkShowcaseControls work={work} /> : null}

          <div className="studio-card rounded-[2rem] p-5 md:p-6">
            <h2 className="text-lg font-semibold text-[var(--ink)]">提示词</h2>
            {showPrompt ? (
              <div className="mt-4 grid gap-5">
                <div>
                  <p className="text-sm font-medium text-[var(--ink-soft)]">主提示词</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)] md:text-base">
                    {work.prompt}
                  </p>
                </div>
                {work.negativePrompt ? (
                  <div className="border-t border-[var(--line)] pt-4">
                    <p className="text-sm font-medium text-[var(--ink-soft)]">负向提示词</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)]/85 md:text-base">
                      {work.negativePrompt}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 rounded-[1.2rem] border border-dashed border-[var(--line)] bg-[var(--surface-strong)]/30 px-4 py-4 text-sm leading-relaxed text-[var(--ink-soft)]">
                作者未公开提示词。
              </p>
            )}
          </div>
        </aside>
      </div>

      {zoomed ? (
        <ImageLightbox src={work.url} onClose={() => setZoomed(false)}>
          <button
            type="button"
            onClick={() => void downloadImage(work.url)}
            className="rounded-full bg-white/20 px-5 py-3 text-sm font-medium text-white backdrop-blur-md transition hover:bg-[var(--accent)]"
          >
            下载这张图
          </button>
        </ImageLightbox>
      ) : null}
    </>
  );
}
