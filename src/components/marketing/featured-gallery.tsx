"use client";

import { useEffect, useId, useRef } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";

import type { SerializedFeaturedWork } from "@/lib/prisma-mappers";
import { cn } from "@/lib/utils";

import { GalleryCard } from "./homepage/gallery-card";
import { GALLERY_ITEM_LIMIT, GALLERY_MESSAGES, GALLERY_OBSERVER_MARGIN } from "./homepage/gallery-constants";
import { useFeaturedGallery } from "./homepage/hooks/use-featured-gallery";
import styles from "./homepage/gallery.module.css";

type FeaturedGalleryProps = {
  works: SerializedFeaturedWork[];
  initialHasMore?: boolean;
  initialNextCursor?: string | null;
  initialError?: boolean;
  isAuthenticated?: boolean;
};

export function FeaturedGallery({ isAuthenticated = false, ...initialPage }: FeaturedGalleryProps) {
  const gallery = useFeaturedGallery(initialPage);
  const { autoPaused, canLoadMore, error, isLoading, loadMore, nextCursor } = gallery;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const remixHintId = useId();

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !canLoadMore || isLoading || error || autoPaused || typeof IntersectionObserver === "undefined") return;
    let disposed = false;
    let observer: IntersectionObserver | undefined;
    try {
      observer = new IntersectionObserver((entries) => {
        if (!disposed && entries.some((entry) => entry.isIntersecting)) void loadMore("auto");
      }, { rootMargin: GALLERY_OBSERVER_MARGIN });
      observer.observe(sentinel);
    } catch {
      observer?.disconnect();
    }
    return () => { disposed = true; observer?.disconnect(); };
  }, [autoPaused, canLoadMore, error, isLoading, loadMore, nextCursor]);

  return (
    <>
      <p id={remixHintId} className={styles.hint}>
        {!isAuthenticated ? <>{GALLERY_MESSAGES.guestRemix}<br /></> : null}
        {GALLERY_MESSAGES.remixHint}
      </p>

      {gallery.items.length > 0 ? (
        <div data-gallery-grid className={styles.grid}>
          {gallery.items.map((work, index) => (
            <GalleryCard key={work.id} work={work} index={index} isAuthenticated={isAuthenticated} remixHintId={remixHintId} />
          ))}
        </div>
      ) : !error && !isLoading ? (
        <div role="status" className={styles.empty}>
          {gallery.hasMore ? "本页暂未发现新作品，可以继续加载。" : "精选作品还在筹备中，期待下一个光影故事。"}
        </div>
      ) : null}

      {canLoadMore ? <div ref={sentinelRef} data-gallery-sentinel aria-hidden className={styles.sentinel} /> : null}

      <div data-gallery-status className={styles.statusArea}>
        {error ? <p role="alert" className={cn(styles.statusText, styles.pageError)}>{error}</p> : null}
        {isLoading ? <p role="status" className={styles.statusText}>正在加载精选作品...</p> : null}
        {!error && !isLoading && autoPaused ? <p role="status" className={styles.statusText}>{GALLERY_MESSAGES.duplicatePage}</p> : null}
        {canLoadMore ? (
          <button type="button" data-gallery-load-more className={styles.loadMore} disabled={isLoading} onClick={() => void loadMore("manual")}>
            {error ? <RefreshCw aria-hidden /> : null}
            {isLoading ? "加载中..." : error ? "重新加载" : "加载更多"}
            {!error ? <ArrowRight aria-hidden /> : null}
          </button>
        ) : gallery.atLimit ? (
          <p role="status" className={styles.statusText}>已展示 {GALLERY_ITEM_LIMIT} 件精选作品，已达首页展示上限。</p>
        ) : gallery.items.length > 0 ? (
          <p role="status" className={styles.statusText}>本次精选已浏览完，新的灵感正在路上。</p>
        ) : null}
      </div>
    </>
  );
}
