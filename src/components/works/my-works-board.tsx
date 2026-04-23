"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useState } from "react";
import { Download, Expand, FileText } from "lucide-react";

import type { SerializedWork } from "@/lib/prisma-mappers";
import { downloadImage } from "@/components/works/download-image";
import { ImageLightbox } from "@/components/works/image-lightbox";
import { PromptModal } from "@/components/works/prompt-modal";
import {
  WorkShowcaseControls,
  WorkStatusBadge,
} from "@/components/works/work-showcase-controls";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
  }).format(new Date(value));
}

export function MyWorksBoard({ works }: { works: SerializedWork[] }) {
  const [zoomedWork, setZoomedWork] = useState<SerializedWork | null>(null);
  const [promptWork, setPromptWork] = useState<SerializedWork | null>(null);

  if (works.length === 0) {
    return (
      <div className="studio-card rounded-[2rem] border border-dashed border-[var(--line)] p-10 text-center">
        <h2 className="text-xl font-semibold text-[var(--ink)]">还没有作品</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
          先去创作台生成图片。生成成功后，每一张图都会自动进入这里，默认仅自己可见。
        </p>
        <div className="mt-6">
          <Link
            href="/create"
            className="rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent)]"
          >
            去生成作品
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {works.map((work) => (
          <article key={work.id} className="studio-card flex flex-col rounded-[2rem] p-5">
            <button
              type="button"
              onClick={() => setZoomedWork(work)}
              className="group relative overflow-hidden rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface-strong)]/40"
            >
              <img
                src={work.url}
                alt="作品预览"
                className="aspect-[4/5] w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-black/0 transition group-hover:bg-black/20" />
              <span className="absolute right-3 top-3 rounded-full bg-black/55 p-2 text-white opacity-0 transition group-hover:opacity-100">
                <Expand className="size-4" />
              </span>
            </button>

            <div className="mt-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-[var(--ink-soft)]">创建于 {formatTime(work.createdAt)}</p>
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--ink)]">
                  {work.prompt}
                </p>
              </div>
              <WorkStatusBadge status={work.showcaseStatus} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ink-soft)]">
              <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1">{work.model}</span>
              <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1">{work.size}</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/works/${work.id}`}
                className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent)]"
              >
                查看详情
              </Link>
              <button
                type="button"
                onClick={() => setPromptWork(work)}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <FileText className="size-4" />
                完整提示词
              </button>
              <button
                type="button"
                onClick={() => void downloadImage(work.url)}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Download className="size-4" />
                下载
              </button>
            </div>

            <div className="mt-4">
              <WorkShowcaseControls work={work} compact />
            </div>
          </article>
        ))}
      </div>

      {zoomedWork ? (
        <ImageLightbox src={zoomedWork.url} onClose={() => setZoomedWork(null)}>
          <button
            type="button"
            onClick={() => void downloadImage(zoomedWork.url)}
            className="rounded-full bg-white/20 px-5 py-3 text-sm font-medium text-white backdrop-blur-md transition hover:bg-[var(--accent)]"
          >
            下载这张图
          </button>
        </ImageLightbox>
      ) : null}

      {promptWork ? (
        <PromptModal
          prompt={promptWork.prompt}
          negativePrompt={promptWork.negativePrompt}
          onClose={() => setPromptWork(null)}
        />
      ) : null}
    </>
  );
}
