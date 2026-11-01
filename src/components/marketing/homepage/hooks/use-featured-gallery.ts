"use client";

// 初始 props 只引导一次；同账户刷新不丢分页和交互，换账户由 Home 的 key 重挂载。
// 请求锁与游标快照同步更新，不依赖 React 提交时机；重复页/失败不自动循环重试。
import { useCallback, useEffect, useRef, useState } from "react";

import type { SerializedFeaturedWork } from "@/lib/prisma-mappers";
import { featuredCursorResponseSchema, featuredPageResponseSchema } from "@/lib/validators";

import { GALLERY_ITEM_LIMIT, GALLERY_MESSAGES, GALLERY_PAGE_SIZE } from "../gallery-constants";
import { GalleryRequestError, requestGalleryJson } from "../gallery-request";

type UseFeaturedGalleryOptions = {
  works: SerializedFeaturedWork[];
  initialHasMore?: boolean;
  initialNextCursor?: string | null;
  initialError?: boolean;
};

type GallerySnapshot = {
  items: SerializedFeaturedWork[];
  hasMore: boolean;
  nextCursor: string | null;
  needsBootstrap: boolean;
  isLoading: boolean;
  error: string | null;
  autoPaused: boolean;
};

type PageRequest = {
  controller: AbortController;
  epoch: number;
};

type UseFeaturedGalleryResult = GallerySnapshot & {
  atLimit: boolean;
  canLoadMore: boolean;
  loadMore: (source?: "manual" | "auto") => Promise<void>;
};

function mergeUniqueWorks(current: SerializedFeaturedWork[], incoming: SerializedFeaturedWork[]) {
  const seen = new Set(current.map((work) => work.id));
  const next = [...current];
  for (const work of incoming) {
    if (next.length >= GALLERY_ITEM_LIMIT) break;
    if (seen.has(work.id)) continue;
    seen.add(work.id);
    next.push(work);
  }
  return next;
}

function bootstrapGallery({
  works,
  initialHasMore = false,
  initialNextCursor = null,
  initialError = false,
}: UseFeaturedGalleryOptions): GallerySnapshot {
  const invalidCursor = initialHasMore && !featuredCursorResponseSchema.safeParse(initialNextCursor).success;
  return {
    items: mergeUniqueWorks([], works),
    hasMore: initialHasMore,
    nextCursor: initialNextCursor,
    needsBootstrap: initialError || invalidCursor,
    isLoading: false,
    error: initialError ? GALLERY_MESSAGES.bootstrapError : invalidCursor ? GALLERY_MESSAGES.cursorError : null,
    autoPaused: initialError || invalidCursor,
  };
}

export function useFeaturedGallery(options: UseFeaturedGalleryOptions): UseFeaturedGalleryResult {
  const [view, setView] = useState(() => bootstrapGallery(options));
  const snapshotRef = useRef(view);
  const activeRef = useRef(false);
  const epochRef = useRef(0);
  const requestRef = useRef<PageRequest | null>(null);
  const consumedCursorsRef = useRef(new Set<string>());

  const publish = useCallback((next: GallerySnapshot) => {
    snapshotRef.current = next;
    setView(next);
  }, []);

  const loadMore = useCallback(async (source: "manual" | "auto" = "manual") => {
    const snapshot = snapshotRef.current;
    if (!activeRef.current || requestRef.current || snapshot.items.length >= GALLERY_ITEM_LIMIT) return;
    if (source === "auto" && (snapshot.autoPaused || snapshot.error)) return;
    if (!snapshot.needsBootstrap && (!snapshot.hasMore || !snapshot.nextCursor)) return;

    const cursor = snapshot.needsBootstrap ? null : snapshot.nextCursor;
    const request = { controller: new AbortController(), epoch: ++epochRef.current };
    requestRef.current = request;
    publish({ ...snapshot, isLoading: true, error: null, autoPaused: false });
    const isCurrent = () => activeRef.current && requestRef.current === request && epochRef.current === request.epoch;

    try {
      const query = cursor ? `cursor=${encodeURIComponent(cursor)}&limit=${GALLERY_PAGE_SIZE}` : `limit=${GALLERY_PAGE_SIZE}`;
      const payload = await requestGalleryJson(`/api/works/featured?${query}`, { controller: request.controller });
      if (!isCurrent() || request.controller.signal.aborted) return;
      const parsed = featuredPageResponseSchema.safeParse(payload);
      if (!parsed.success || parsed.data.items.length > GALLERY_PAGE_SIZE) {
        throw new Error(GALLERY_MESSAGES.pageFormatError);
      }
      const page = parsed.data;
      if (page.nextCursor !== null && (page.nextCursor === cursor || consumedCursorsRef.current.has(page.nextCursor))) {
        throw new Error(GALLERY_MESSAGES.cursorError);
      }

      const current = snapshotRef.current;
      const items = mergeUniqueWorks(current.items, page.items);
      if (cursor) consumedCursorsRef.current.add(cursor);
      // Commit the command snapshot BEFORE finally releases the request lock.
      publish({
        items,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        needsBootstrap: false,
        isLoading: true,
        error: null,
        autoPaused: page.hasMore && items.length === current.items.length,
      });
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof GalleryRequestError && error.reason === "timeout"
        ? GALLERY_MESSAGES.pageTimeout
        : error instanceof Error && (error.message === GALLERY_MESSAGES.pageFormatError || error.message === GALLERY_MESSAGES.cursorError)
          ? error.message
          : GALLERY_MESSAGES.pageError;
      publish({ ...snapshotRef.current, error: message, autoPaused: true });
    } finally {
      if (isCurrent()) {
        const next = { ...snapshotRef.current, isLoading: false };
        snapshotRef.current = next;
        requestRef.current = null;
        setView(next);
      }
    }
  }, [publish]);

  useEffect(() => {
    activeRef.current = true;
    // Strict Mode can restart effects after aborting an observer-triggered read.
    setView(snapshotRef.current);
    return () => {
      activeRef.current = false;
      epochRef.current += 1;
      const request = requestRef.current;
      requestRef.current = null;
      request?.controller.abort(new GalleryRequestError("aborted"));
      snapshotRef.current = { ...snapshotRef.current, isLoading: false };
    };
  }, []);

  return {
    ...view,
    atLimit: view.items.length >= GALLERY_ITEM_LIMIT,
    canLoadMore: view.items.length < GALLERY_ITEM_LIMIT && (view.needsBootstrap || (view.hasMore && Boolean(view.nextCursor))),
    loadMore,
  };
}
