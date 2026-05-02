"use client";

/* eslint-disable @next/next/no-img-element */

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Heart, User } from "lucide-react";
import { motion } from "motion/react";

import { getThumbSrcSet, getThumbUrl } from "@/lib/image-url";

type Work = {
  authorAvatar: string | null;
  authorName: string;
  featuredAt: string | null;
  id: string;
  image: string;
  likeCount: number;
  likedByMe: boolean;
  prompt: string;
  size: string;
  title: string;
};

const GALLERY_PAGE_SIZE = 16;
const GALLERY_ITEM_LIMIT = 72;
const INTRO_ANIMATION_COUNT = 8;
const PROMPT_PREVIEW_LENGTH = 140;

// 把生图任务记录里的 "1024x1536" 解析成 [宽, 高]。
// 解析失败一律按 1:1 兜底，宁可让首屏占位略矮，也不让浏览器没占位再重排。
function parseAspectSize(size: string): { width: number; height: number } {
  const normalizedSize = size.trim();
  const match = /^(\d+)x(\d+)$/i.exec(normalizedSize);
  const ratioMatch = /^(\d+):(\d+)$/i.exec(normalizedSize);
  const matchedSize = match ?? ratioMatch;

  if (!matchedSize) return { width: 1, height: 1 };
  const width = Number(matchedSize[1]);
  const height = Number(matchedSize[2]);
  if (!width || !height) return { width: 1, height: 1 };
  return { width, height };
}

function getPromptPreview(prompt: string): string {
  if (prompt.length <= PROMPT_PREVIEW_LENGTH) return prompt;
  return `${prompt.slice(0, PROMPT_PREVIEW_LENGTH)}...`;
}

function mergeUniqueWorks(current: Work[], incoming: Work[]) {
  const seen = new Set(current.map((work) => work.id));
  const next = [...current];

  for (const work of incoming) {
    if (seen.has(work.id)) {
      continue;
    }
    seen.add(work.id);
    next.push(work);
    if (next.length >= GALLERY_ITEM_LIMIT) {
      break;
    }
  }

  return next;
}

function canLoadMore({
  hasMore,
  isLoading,
  itemCount,
  nextCursor,
}: {
  hasMore: boolean;
  isLoading: boolean;
  itemCount: number;
  nextCursor: string | null;
}) {
  return Boolean(
    !isLoading &&
      hasMore &&
      nextCursor &&
      itemCount < GALLERY_ITEM_LIMIT,
  );
}

type FeaturedResponse = {
  hasMore: boolean;
  items: Work[];
  nextCursor: string | null;
};

type FeaturedGalleryProps = {
  initialHasMore?: boolean;
  initialNextCursor?: string | null;
  works: Work[];
};

export function FeaturedGallery({
  initialHasMore = false,
  initialNextCursor = null,
  works,
}: FeaturedGalleryProps) {
  const router = useRouter();
  const [items, setItems] = useState(() => works);
  const [hasMore, setHasMore] = useState(() => initialHasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState(() => initialNextCursor);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useEffectEvent(async () => {
    if (
      !canLoadMore({
        hasMore,
        isLoading,
        itemCount: items.length,
        nextCursor,
      })
    ) {
      return;
    }

    setIsLoading(true);

    try {
      const cursor = nextCursor;
      if (!cursor) return;
      const response = await fetch(
        `/api/works/featured?cursor=${encodeURIComponent(cursor)}&limit=${GALLERY_PAGE_SIZE}`,
      );
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as FeaturedResponse;
      startTransition(() => {
        setItems((current) => mergeUniqueWorks(current, data.items));
        setHasMore(data.hasMore);
        setNextCursor(data.nextCursor);
      });
    } finally {
      setIsLoading(false);
    }
  });

  async function handleLike(workId: string) {
    const response = await fetch(`/api/works/${workId}/like`, {
      method: "PUT",
    });

    if (response.status === 401) {
      router.push("/login");
      return;
    }

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      data?: {
        likeCount: number;
        liked: boolean;
      };
    };
    const data = payload.data;
    if (!data) {
      return;
    }

    setItems((current) =>
      current.map((work) =>
        work.id === workId
          ? {
              ...work,
              likeCount: data.likeCount,
              likedByMe: data.liked,
            }
          : work,
      ),
    );
  }

  useEffect(() => {
    if (
      !canLoadMore({
        hasMore,
        isLoading,
        itemCount: items.length,
        nextCursor,
      }) ||
      !sentinelRef.current
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      // 提前 400px 触发加载，移动端拇指快速滑动时不至于滚到底再卡顿等。
      { rootMargin: "400px" },
    );

    observer.observe(sentinelRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoading, items.length, nextCursor]);

  return (
    <>
      <div className="columns-1 space-y-5 gap-5 sm:columns-2 md:columns-3 xl:columns-4">
        {items.map((work, index) => {
          const { width, height } = parseAspectSize(work.size);
          const promptPreview = getPromptPreview(work.prompt);
          const shouldAnimate = index < INTRO_ANIMATION_COUNT;
          const cardContent = (
            <>
              <Link
                href={`/works/${work.id}`}
                prefetch={false}
                aria-label={`查看作品 ${work.title}`}
                className="block"
              >
                <img
                  src={getThumbUrl(work.image, 1080)}
                  srcSet={getThumbSrcSet(work.image, [640, 828, 1080, 1200, 1920])}
                  sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
                  alt={work.title}
                  width={width}
                  height={height}
                  loading={index < 4 ? "eager" : "lazy"}
                  decoding="async"
                  fetchPriority={index < 2 ? "high" : "auto"}
                  style={{ aspectRatio: `${width} / ${height}` }}
                  className="block h-auto w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--ink)]/85 via-[var(--ink)]/20 to-transparent opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <div className="size-6 shrink-0 overflow-hidden rounded-full border border-white/30 bg-white/15">
                        {work.authorAvatar ? (
                          <img
                            src={getThumbUrl(work.authorAvatar, 48)}
                            alt={work.authorName}
                            loading="lazy"
                            decoding="async"
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center">
                            <User className="size-3.5 text-white/80" />
                          </div>
                        )}
                      </div>
                      <span className="truncate text-xs font-medium text-white/90">
                        {work.authorName}
                      </span>
                    </div>
                    <h3 className="truncate font-semibold text-white">{work.title}</h3>
                    <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-white/80">
                      {promptPreview}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-white/15 bg-white/20 p-2.5 text-white transition group-hover:-translate-y-0.5 group-hover:bg-white/30">
                    <ArrowUpRight className="size-5" />
                  </span>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => void handleLike(work.id)}
                aria-label={`${work.likedByMe ? "取消点赞" : "点赞"} ${work.title}`}
                className={`absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 ${
                  work.likedByMe
                    ? "bg-rose-500/90"
                    : "bg-black/45 hover:bg-black/60"
                }`}
              >
                <Heart className={`size-4 ${work.likedByMe ? "fill-current" : ""}`} />
                {work.likeCount}
              </button>
            </>
          );

          if (!shouldAnimate) {
            return (
              <article
                key={work.id}
                className="gallery-card group relative block break-inside-avoid overflow-hidden rounded-[1.5rem]"
              >
                {cardContent}
              </article>
            );
          }

          return (
            <motion.article
              key={work.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.28,
                ease: "easeOut",
                delay: Math.min(index * 0.025, 0.18),
              }}
              className="gallery-card group relative block break-inside-avoid overflow-hidden rounded-[1.5rem]"
            >
              {cardContent}
            </motion.article>
          );
        })}
      </div>

      {hasMore && items.length < GALLERY_ITEM_LIMIT ? (
        <div ref={sentinelRef} aria-hidden="true" className="h-10 w-full" />
      ) : null}

      {isLoading ? (
        <p className="mt-6 text-center text-sm text-[var(--ink-soft)]">正在加载更多精选...</p>
      ) : null}
    </>
  );
}
