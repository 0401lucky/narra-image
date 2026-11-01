"use client";

// 每张作品独立串行点赞，服务端 ACK 后才更新；换 viewer 由画廊的 key 隔离。
// PUT 是切换而非幂等设置，超时/响应损坏不假定成功，也不自动重试。
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { SerializedFeaturedWork } from "@/lib/prisma-mappers";
import { workLikeResponseSchema } from "@/lib/validators";

import { GALLERY_MESSAGES } from "../gallery-constants";
import { GalleryRequestError, requestGalleryJson } from "../gallery-request";

type UseWorkLikeOptions = Pick<SerializedFeaturedWork, "id" | "likeCount" | "likedByMe">;
type LikeView = {
  likeCount: number;
  likedByMe: boolean;
  pending: boolean;
  error: string | null;
};
type UseWorkLikeResult = LikeView & { toggleLike: () => Promise<void> };

export function useWorkLike({ id, likeCount, likedByMe }: UseWorkLikeOptions): UseWorkLikeResult {
  const router = useRouter();
  const [view, setView] = useState<LikeView>(() => ({ likeCount, likedByMe, pending: false, error: null }));
  const activeRef = useRef(false);
  const epochRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);

  const toggleLike = useCallback(async () => {
    if (!activeRef.current || requestRef.current) return;
    const controller = new AbortController();
    const epoch = ++epochRef.current;
    requestRef.current = controller;
    setView((current) => ({ ...current, pending: true, error: null }));
    const isCurrent = () => activeRef.current && requestRef.current === controller && epochRef.current === epoch;
    try {
      const payload = await requestGalleryJson(`/api/works/${encodeURIComponent(id)}/like`, { controller, method: "PUT" });
      if (!isCurrent() || controller.signal.aborted) return;
      const parsed = workLikeResponseSchema.safeParse(payload);
      if (!parsed.success) throw new Error(GALLERY_MESSAGES.likeUnconfirmed);
      setView({ likeCount: parsed.data.data.likeCount, likedByMe: parsed.data.data.liked, pending: false, error: null });
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof GalleryRequestError && error.status === 401) {
        router.push("/login");
        return;
      }
      const message = error instanceof GalleryRequestError
        ? error.reason === "timeout" ? GALLERY_MESSAGES.likeTimeout : GALLERY_MESSAGES.likeError
        : GALLERY_MESSAGES.likeUnconfirmed;
      setView((current) => ({ ...current, error: message }));
    } finally {
      if (isCurrent()) {
        requestRef.current = null;
        setView((current) => ({ ...current, pending: false }));
      }
    }
  }, [id, router]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      epochRef.current += 1;
      const request = requestRef.current;
      requestRef.current = null;
      request?.abort(new GalleryRequestError("aborted"));
    };
  }, []);

  return { ...view, toggleLike };
}
