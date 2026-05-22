"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Download,
  Expand,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  Search,
  Share2,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import type { SerializedWork } from "@/lib/prisma-mappers";
import { downloadImage } from "@/components/works/download-image";
import { Alert } from "@/components/ui/alert";
import { getThumbUrl } from "@/lib/image-url";
import {
  WorkShowcaseControls,
  WorkStatusBadge,
} from "@/components/works/work-showcase-controls";

const ImageLightbox = dynamic(
  () => import("@/components/works/image-lightbox").then((mod) => mod.ImageLightbox),
  { ssr: false },
);
const PromptModal = dynamic(
  () => import("@/components/works/prompt-modal").then((mod) => mod.PromptModal),
  { ssr: false },
);

type MyWorksBoardProps = {
  counts: {
    featured: number;
    pending: number;
    total: number;
  };
  initialItems: SerializedWork[];
  initialHasMore: boolean;
  initialCursor: string | null;
};

type LoadMoreResponse = {
  data?: {
    hasMore: boolean;
    items: SerializedWork[];
    nextCursor: string | null;
  };
  error?: string;
};

type WorkFilter = "all" | "private" | "pending" | "featured";

const filterLabels: Record<WorkFilter, string> = {
  all: "全部",
  featured: "已精选",
  pending: "待审核",
  private: "私有",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
  }).format(new Date(value));
}

function getRatioLabel(size: string) {
  const match = size.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return size;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return size;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function getAspectRatio(size: string) {
  const match = size.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return "3 / 4";
  return `${Number(match[1])} / ${Number(match[2])}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function matchesFilter(work: SerializedWork, filter: WorkFilter) {
  if (filter === "private") return work.showcaseStatus === "PRIVATE";
  if (filter === "pending") return work.showcaseStatus === "PENDING";
  if (filter === "featured") return work.showcaseStatus === "FEATURED";
  return true;
}

function matchesSearch(work: SerializedWork, search: string) {
  if (!search.trim()) return true;
  const keyword = search.trim().toLowerCase();
  return [
    work.prompt,
    work.negativePrompt ?? "",
    work.model,
    work.size,
    work.id,
  ].some((value) => value.toLowerCase().includes(keyword));
}

export function MyWorksBoard({
  counts,
  initialItems,
  initialHasMore,
  initialCursor,
}: MyWorksBoardProps) {
  const router = useRouter();
  const [items, setItems] = useState<SerializedWork[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const [activeFilter, setActiveFilter] = useState<WorkFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(
    initialItems[0]?.id ?? null,
  );
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);

  const [zoomedWork, setZoomedWork] = useState<SerializedWork | null>(null);
  const [promptWork, setPromptWork] = useState<SerializedWork | null>(null);
  const [deletingWork, setDeletingWork] = useState<SerializedWork | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filterCounts: Record<WorkFilter, number> = {
    all: counts.total,
    featured: counts.featured,
    pending: counts.pending,
    private: Math.max(counts.total - counts.pending - counts.featured, 0),
  };

  const filteredItems = useMemo(
    () =>
      items.filter(
        (work) =>
          matchesFilter(work, activeFilter) && matchesSearch(work, search),
      ),
    [activeFilter, items, search],
  );

  const selectedWork =
    filteredItems.find((work) => work.id === selectedWorkId) ??
    filteredItems[0] ??
    items.find((work) => work.id === selectedWorkId) ??
    null;

  async function handleLoadMore() {
    if (!hasMore || !cursor || isLoadingMore) return;
    setLoadMoreError(null);
    setIsLoadingMore(true);
    try {
      const response = await fetch(
        `/api/me/works?cursor=${encodeURIComponent(cursor)}&limit=24`,
      );
      const result = (await response.json().catch(() => ({}))) as LoadMoreResponse;
      if (!response.ok || !result.data) {
        setLoadMoreError(result.error || "加载更多失败，请稍后再试");
        return;
      }
      setItems((prev) => [...prev, ...result.data!.items]);
      setHasMore(result.data.hasMore);
      setCursor(result.data.nextCursor);
    } catch (err) {
      setLoadMoreError(
        err instanceof Error ? err.message : "加载更多失败，请稍后再试",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function handleShare(work: SerializedWork) {
    const url = new URL(`/works/${work.id}`, window.location.origin).toString();
    setShareMessage(null);

    if (navigator.share) {
      try {
        await navigator.share({
          text: "来看看这张作品",
          title: "Narra Image 作品",
          url,
        });
        return;
      } catch {
        // 取消系统分享时回落到复制链接，避免用户没有任何反馈。
      }
    }

    if (!navigator.clipboard?.writeText) {
      setShareMessage("当前浏览器不支持自动复制，请手动复制详情页地址");
      return;
    }
    await navigator.clipboard.writeText(url);
    setShareMessage("链接已复制");
  }

  async function handleConfirmDelete() {
    if (!deletingWork) return;
    const deletedId = deletingWork.id;
    const nextSelected = items.find((item) => item.id !== deletedId) ?? null;
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/me/works/${deletedId}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setDeleteError(result.error || "删除失败，请稍后再试");
        return;
      }
      setItems((prev) => prev.filter((item) => item.id !== deletedId));
      setSelectedWorkId((current) =>
        current === deletedId ? nextSelected?.id ?? null : current,
      );
      setDeletingWork(null);
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="studio-card grid gap-6 p-8 text-center md:p-10">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ink)]">还没有作品</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[var(--ink-soft)]">
            先去创作台生成图片。生成成功后，每一张图都会自动进入这里，默认仅自己可见。
          </p>
        </div>
        <div>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)]"
          >
            去创作台
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[15rem_minmax(0,1fr)_22rem]">
        <aside className="studio-card h-fit p-4 xl:sticky xl:top-24 hidden xl:block">
          <h2 className="text-sm font-semibold text-[var(--ink)]">我的作品</h2>
          <div className="mt-4 grid gap-1.5">
            {(["all", "private", "pending", "featured"] as WorkFilter[]).map(
              (filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                    activeFilter === filter
                      ? "bg-[#eadfce] text-[var(--ink)] shadow-sm"
                      : "text-[var(--ink-soft)] hover:bg-white/60 hover:text-[var(--ink)]"
                  }`}
                >
                  <span>{filterLabels[filter]}</span>
                  <span className="text-xs tabular-nums">
                    {filterCounts[filter]}
                  </span>
                </button>
              ),
            )}
          </div>

          <div className="mt-5 border-t border-[var(--line)] pt-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
              <Filter className="size-4 text-[var(--accent)]" />
              筛选
            </div>
            <div className="mt-4 grid gap-3 text-sm">
              <label className="grid gap-1.5">
                <span className="text-xs text-[var(--ink-soft)]">状态</span>
                <select
                  value={activeFilter}
                  onChange={(event) =>
                    setActiveFilter(event.target.value as WorkFilter)
                  }
                  className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-[var(--ink)] outline-none"
                >
                  <option value="all">全部</option>
                  <option value="private">私有</option>
                  <option value="pending">待审核</option>
                  <option value="featured">已精选</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs text-[var(--ink-soft)]">
                <span className="rounded-lg border border-[var(--line)] bg-white/55 px-3 py-2">
                  已加载 {items.length}
                </span>
                <span className="rounded-lg border border-[var(--line)] bg-white/55 px-3 py-2">
                  命中 {filteredItems.length}
                </span>
              </div>
            </div>
          </div>
        </aside>

        <section className="studio-card min-w-0 overflow-hidden p-3 md:p-4">
          <div className="flex flex-col gap-3 border-b border-[var(--line)] pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex xl:hidden overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-lg border border-[var(--line)] bg-[#f4eadc] p-1 gap-1">
              {(["all", "private", "pending", "featured"] as WorkFilter[]).map(
                (filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setActiveFilter(filter)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      activeFilter === filter
                        ? "bg-[#fffaf2] text-[var(--ink)] shadow-sm"
                        : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {filterLabels[filter]}
                  </button>
                ),
              )}
            </div>

            <div className="flex items-center gap-2 w-full lg:max-w-md">
              <label className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索作品或提示词"
                  className="h-11 w-full rounded-lg border border-[var(--line)] bg-[#fffaf2]/76 pl-10 pr-4 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus:bg-white"
                />
              </label>
              <button
                type="button"
                onClick={() => setIsMobileFilterOpen(true)}
                className="xl:hidden flex items-center justify-center size-11 shrink-0 rounded-lg border border-[var(--line)] bg-[#fffaf2]/76 text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--accent)] transition"
                aria-label="高级筛选"
              >
                <Filter className="size-5" />
              </button>
            </div>
          </div>

          {filteredItems.length > 0 ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {filteredItems.map((work, index) => (
                <motion.article
                  key={work.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: Math.min((index % 18) * 0.018, 0.22),
                    duration: 0.22,
                    ease: "easeOut",
                  }}
                  onClick={() => {
                    setSelectedWorkId(work.id);
                    setIsMobileDetailOpen(true);
                  }}
                  className={`group cursor-pointer overflow-hidden rounded-xl border bg-[#fffaf2]/80 p-2 shadow-[0_12px_30px_rgba(94,58,33,0.08)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(94,58,33,0.12)] ${
                    selectedWork?.id === work.id
                      ? "border-[var(--accent)]"
                      : "border-[var(--line)]"
                  }`}
                >
                  <div
                    className="relative overflow-hidden rounded-lg bg-[var(--surface-strong)]"
                    style={{ aspectRatio: getAspectRatio(work.size) }}
                  >
                    <img
                      src={getThumbUrl(work.url, 640)}
                      alt="作品预览"
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/72 via-black/22 to-transparent p-3 text-white">
                      <p className="line-clamp-1 text-sm font-semibold">
                        {work.prompt}
                      </p>
                      <p className="mt-1 text-xs text-white/72">
                        {work.model} · {getRatioLabel(work.size)}
                      </p>
                    </div>
                    <div className="absolute left-3 top-3">
                      <WorkStatusBadge status={work.showcaseStatus} />
                    </div>
                    <div className="absolute right-3 top-3 flex gap-1.5">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setZoomedWork(work);
                        }}
                        className="grid size-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"
                        aria-label="放大预览"
                      >
                        <Expand className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void downloadImage(work.url);
                        }}
                        className="grid size-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md transition hover:bg-black/65"
                        aria-label="下载作品"
                      >
                        <Download className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 px-1 pb-1 pt-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-[var(--ink-soft)]">
                          创建于 {formatTime(work.createdAt)}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--ink)]">
                          {work.prompt}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.article>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--line)] bg-white/45 px-5 py-12 text-center text-sm text-[var(--ink-soft)]">
              没有匹配的作品。
            </div>
          )}

          {isLoadingMore &&
            Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`skeleton_${index}`}
                className="mt-4 h-72 animate-pulse rounded-xl bg-[var(--surface-strong)]/60"
                aria-hidden
              />
            ))}

          {hasMore ? (
            <div className="mt-6 flex flex-col items-center gap-3">
              {loadMoreError ? (
                <Alert variant="error" className="rounded-full px-4 py-2 text-xs">
                  {loadMoreError}
                </Alert>
              ) : null}
              <button
                type="button"
                onClick={() => void handleLoadMore()}
                disabled={isLoadingMore}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    加载中
                  </>
                ) : loadMoreError ? (
                  "重试"
                ) : (
                  "加载更多"
                )}
              </button>
            </div>
          ) : items.length >= 24 ? (
            <div className="mt-6 text-center text-xs text-[var(--ink-soft)]/70">
              没有更多作品了
            </div>
          ) : null}
        </section>

        <aside className="studio-card h-fit p-4 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto hidden xl:block">
          {selectedWork ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-[var(--ink)]">
                  作品详情
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setZoomedWork(selectedWork)}
                className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]"
              >
                <img
                  src={getThumbUrl(selectedWork.url, 1080)}
                  alt="选中作品预览"
                  className="max-h-[28rem] w-full object-cover"
                />
              </button>

              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="line-clamp-2 text-lg font-semibold text-[var(--ink)]">
                      {selectedWork.prompt}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      创建于 {formatTime(selectedWork.createdAt)}
                    </p>
                  </div>
                  <WorkStatusBadge status={selectedWork.showcaseStatus} />
                </div>

                <dl className="mt-4 grid gap-3 text-sm">
                  <div className="flex justify-between gap-3 border-b border-[var(--line)] pb-2">
                    <dt className="text-[var(--ink-soft)]">模型</dt>
                    <dd className="font-medium text-[var(--ink)]">
                      {selectedWork.model}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-[var(--line)] pb-2">
                    <dt className="text-[var(--ink-soft)]">尺寸</dt>
                    <dd className="font-medium text-[var(--ink)]">
                      {selectedWork.size} ({getRatioLabel(selectedWork.size)})
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-[var(--line)] pb-2">
                    <dt className="text-[var(--ink-soft)]">公开范围</dt>
                    <dd className="font-medium text-[var(--ink)]">
                      {selectedWork.showcaseStatus === "FEATURED"
                        ? "首页精选"
                        : "仅自己可见"}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg border border-[var(--line)] bg-white/58 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--ink)]">
                    提示词
                  </span>
                  <button
                    type="button"
                    onClick={() => setPromptWork(selectedWork)}
                    className="text-xs font-medium text-[var(--accent)]"
                  >
                    查看完整
                  </button>
                </div>
                <p className="line-clamp-4 text-sm leading-relaxed text-[var(--ink-soft)]">
                  {selectedWork.prompt}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void downloadImage(selectedWork.url)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
                >
                  <Download className="size-4" />
                  下载
                </button>
                <button
                  type="button"
                  onClick={() => void handleShare(selectedWork)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
                >
                  <Share2 className="size-4" />
                  分享
                </button>
                <button
                  type="button"
                  onClick={() => setPromptWork(selectedWork)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
                >
                  <FileText className="size-4" />
                  提示词
                </button>
                <Link
                  href={`/works/${selectedWork.id}`}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
                >
                  <ExternalLink className="size-4" />
                  详情
                </Link>
              </div>

              {shareMessage ? (
                <p className="text-xs text-[var(--ink-soft)]">{shareMessage}</p>
              ) : null}

              <WorkShowcaseControls work={selectedWork} />

              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeletingWork(selectedWork);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:border-rose-400"
              >
                <Trash2 className="size-4" />
                删除
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-soft)]">
              选择一张作品查看详情。
            </div>
          )}
        </aside>
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

      {deletingWork ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!isDeleting) setDeletingWork(null);
          }}
        >
          <div
            className="studio-card w-full max-w-md p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--ink)]">删除作品</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              删除后这张图片将不再出现在你的作品列表中，且无法恢复。是否继续？
            </p>
            {deleteError ? (
              <div className="mt-3">
                <Alert variant="error">{deleteError}</Alert>
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingWork(null)}
                className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {isDeleting ? <Loader2 className="size-4 animate-spin" /> : null}
                {isDeleting ? "删除中" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Mobile Detail Bottom Sheet */}
      <AnimatePresence>
        {isMobileDetailOpen && selectedWork && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileDetailOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs xl:hidden"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 250 }}
              className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-[2rem] bg-[#fffaf2]/96 border-t border-[var(--line)] shadow-[0_-10px_35px_rgba(94,58,33,0.15)] overflow-y-auto pb-8 backdrop-blur-md xl:hidden"
            >
              <div className="sticky top-0 bg-[#fffaf2]/96 backdrop-blur-md pt-3 pb-1 px-6 border-b border-[var(--line)]/50 z-10">
                <div className="flex justify-center mb-2">
                  <div className="w-12 h-1.5 rounded-full bg-[var(--line)]" />
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-[var(--ink)]">作品详情</h3>
                  <button
                    type="button"
                    onClick={() => setIsMobileDetailOpen(false)}
                    className="rounded-full bg-white/60 p-1 px-3 text-xs font-semibold text-[var(--ink-soft)] hover:bg-white border border-[var(--line)] transition"
                  >
                    关闭
                  </button>
                </div>
              </div>

              <div className="p-6 grid gap-5">
                <button
                  type="button"
                  onClick={() => setZoomedWork(selectedWork)}
                  className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-sm"
                >
                  <img
                    src={getThumbUrl(selectedWork.url, 1080)}
                    alt="选中作品预览"
                    className="max-h-[50vh] w-full object-contain mx-auto"
                  />
                </button>

                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="line-clamp-2 text-lg font-semibold text-[var(--ink)]">
                        {selectedWork.prompt}
                      </h4>
                      <p className="mt-1 text-xs text-[var(--ink-soft)]">
                        创建于 {formatTime(selectedWork.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <WorkStatusBadge status={selectedWork.showcaseStatus} />
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 text-sm">
                    <div className="flex justify-between gap-3 border-b border-[var(--line)] pb-2">
                      <dt className="text-[var(--ink-soft)]">模型</dt>
                      <dd className="font-medium text-[var(--ink)]">
                        {selectedWork.model}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-[var(--line)] pb-2">
                      <dt className="text-[var(--ink-soft)]">尺寸</dt>
                      <dd className="font-medium text-[var(--ink)]">
                        {selectedWork.size} ({getRatioLabel(selectedWork.size)})
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-[var(--line)] pb-2">
                      <dt className="text-[var(--ink-soft)]">公开范围</dt>
                      <dd className="font-medium text-[var(--ink)]">
                        {selectedWork.showcaseStatus === "FEATURED"
                          ? "首页精选"
                          : "仅自己可见"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-lg border border-[var(--line)] bg-white/58 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--ink)]">
                      提示词
                    </span>
                    <button
                      type="button"
                      onClick={() => setPromptWork(selectedWork)}
                      className="text-xs font-medium text-[var(--accent)]"
                    >
                      查看完整
                    </button>
                  </div>
                  <p className="line-clamp-4 text-sm leading-relaxed text-[var(--ink-soft)]">
                    {selectedWork.prompt}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void downloadImage(selectedWork.url)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
                  >
                    <Download className="size-4" />
                    下载
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleShare(selectedWork)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
                  >
                    <Share2 className="size-4" />
                    分享
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromptWork(selectedWork)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
                  >
                    <FileText className="size-4" />
                    提示词
                  </button>
                  <Link
                    href={`/works/${selectedWork.id}`}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-white/60 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
                  >
                    <ExternalLink className="size-4" />
                    详情
                  </Link>
                </div>

                {shareMessage ? (
                  <p className="text-xs text-[var(--ink-soft)] text-center">{shareMessage}</p>
                ) : null}

                <WorkShowcaseControls work={selectedWork} />

                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeletingWork(selectedWork);
                    setIsMobileDetailOpen(false);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:border-rose-400 font-medium"
                >
                  <Trash2 className="size-4" />
                  删除作品
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Mobile Filter Bottom Sheet */}
      <AnimatePresence>
        {isMobileFilterOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileFilterOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs xl:hidden"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 250 }}
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-[2rem] bg-[#fffaf2]/96 border-t border-[var(--line)] shadow-[0_-10px_35px_rgba(94,58,33,0.15)] overflow-y-auto pb-8 backdrop-blur-md xl:hidden"
            >
              <div className="sticky top-0 bg-[#fffaf2]/96 backdrop-blur-md pt-3 pb-1 px-6 border-b border-[var(--line)]/50 z-10">
                <div className="flex justify-center mb-2">
                  <div className="w-12 h-1.5 rounded-full bg-[var(--line)]" />
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-[var(--ink)] flex items-center gap-2">
                    <Filter className="size-4 text-[var(--accent)]" />
                    作品筛选
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsMobileFilterOpen(false)}
                    className="rounded-full bg-white/60 p-1 px-3 text-xs font-semibold text-[var(--ink-soft)] hover:bg-white border border-[var(--line)] transition"
                  >
                    完成
                  </button>
                </div>
              </div>

              <div className="p-6 grid gap-6">
                <div>
                  <span className="text-xs text-[var(--ink-soft)] block mb-3 font-medium">按作品类型过滤</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(["all", "private", "pending", "featured"] as WorkFilter[]).map(
                      (filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setActiveFilter(filter)}
                          className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm transition border ${
                            activeFilter === filter
                              ? "bg-[#eadfce] text-[var(--ink)] border-[var(--accent)] shadow-sm"
                              : "bg-white/60 text-[var(--ink-soft)] border-[var(--line)] hover:bg-white hover:text-[var(--ink)]"
                          }`}
                        >
                          <span className="font-medium">{filterLabels[filter]}</span>
                          <span className="text-xs tabular-nums rounded-full bg-white/70 px-2 py-0.5 border border-[var(--line)]/50">
                            {filterCounts[filter]}
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <div className="border-t border-[var(--line)]/50 pt-5">
                  <span className="text-xs text-[var(--ink-soft)] block mb-3 font-medium">数据统计</span>
                  <div className="grid grid-cols-2 gap-2 text-xs text-[var(--ink-soft)]">
                    <div className="rounded-lg border border-[var(--line)] bg-white/55 px-3 py-2 flex justify-between">
                      <span>已加载</span>
                      <span className="font-semibold text-[var(--ink)]">{items.length} 张</span>
                    </div>
                    <div className="rounded-lg border border-[var(--line)] bg-white/55 px-3 py-2 flex justify-between">
                      <span>筛选命中</span>
                      <span className="font-semibold text-[var(--ink)]">{filteredItems.length} 张</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsMobileFilterOpen(false)}
                  className="w-full mt-4 rounded-xl bg-[var(--ink)] py-3.5 text-sm font-semibold text-white shadow-md transition hover:bg-[var(--accent)]"
                >
                  确定
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
