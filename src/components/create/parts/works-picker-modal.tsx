"use client";

/* eslint-disable @next/next/no-img-element */

// 工作台内嵌「我的作品」选择器弹窗：调用 GET /api/me/works 浏览作品，支持一键加入参考图或填入提示词。
import { FileText, ImagePlus, Images, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { ImageUnavailable } from "@/components/ui/image-unavailable";
import { getThumbUrl } from "@/lib/image-url";
import { isImageAvailable } from "@/lib/storage/image-availability";
import type { ImageAvailability } from "@/lib/types";

type WorkPickerItem = {
  id: string;
  url: string;
  prompt: string;
  size: string;
  model: string;
  availability?: ImageAvailability;
  createdAt: string;
};

type WorksPickerModalProps = {
  open: boolean;
  onClose: () => void;
  onAddReference: (url: string) => void;
  onPickPrompt: (promptText: string) => void;
};

export function WorksPickerModal({
  open,
  onClose,
  onAddReference,
  onPickPrompt,
}: WorksPickerModalProps) {
  const [items, setItems] = useState<WorkPickerItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [openCycle, setOpenCycle] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  const [settledCycle, setSettledCycle] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setOpenCycle((current) => current + 1);
      setError(null);
    }
  }

  const loading = open && settledCycle !== openCycle;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    void fetch("/api/me/works?limit=24", { signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json().catch(() => null)) as {
          data?: { items?: WorkPickerItem[]; hasMore?: boolean; nextCursor?: string | null };
          error?: string;
        } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !result?.data) {
          setError(result?.error || "作品列表加载失败，请稍后重试");
          setSettledCycle(openCycle);
          return;
        }
        setItems(result.data.items ?? []);
        setHasMore(Boolean(result.data.hasMore));
        setNextCursor(result.data.nextCursor ?? null);
        setSettledCycle(openCycle);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "作品列表加载失败");
        setSettledCycle(openCycle);
      });

    return () => controller.abort();
  }, [open, openCycle]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(`/api/me/works?limit=24&cursor=${encodeURIComponent(nextCursor)}`);
      const result = (await response.json().catch(() => null)) as {
        data?: { items?: WorkPickerItem[]; hasMore?: boolean; nextCursor?: string | null };
        error?: string;
      } | null;
      if (!response.ok || !result?.data) {
        setError(result?.error || "加载更多作品失败");
        return;
      }
      const incoming = result.data.items ?? [];
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...incoming.filter((item) => !seen.has(item.id))];
      });
      setHasMore(Boolean(result.data.hasMore));
      setNextCursor(result.data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载更多作品失败");
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextCursor]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="选择我的作品"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#21170f]/45 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-[var(--line)] bg-[#fffcf7] shadow-[0_28px_72px_rgba(33,23,15,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)]/70 bg-[#faf4ea]/85 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Images aria-hidden className="size-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--ink)]">我的作品</h2>
            <span className="text-xs text-[var(--ink-soft)]">可直接加入参考图或复用提示词</span>
          </div>
          <button
            type="button"
            aria-label="关闭我的作品"
            onClick={onClose}
            className="cursor-pointer rounded-xl p-1.5 text-[var(--ink-soft)] transition hover:bg-white hover:text-[var(--ink)]"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="premium-scrollbar flex-1 overflow-y-auto p-5">
          {error && (
            <Alert variant="error" className="mb-4">
              {error}
            </Alert>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-[var(--ink-soft)]">
              <Loader2 aria-hidden className="size-4 animate-spin text-[var(--accent)]" />
              正在加载我的作品…
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-xs text-[var(--ink-soft)]">
              你还没有生成过图片作品
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((item) => {
                  const available = isImageAvailable(item.availability);
                  return (
                    <article
                      key={item.id}
                      className="flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[#fffaf2] shadow-2xs"
                    >
                      <div className="aspect-square w-full overflow-hidden bg-[#efe6d8]">
                        {available ? (
                          <img
                            src={getThumbUrl(item.url, 384)}
                            alt={item.prompt.slice(0, 40) || "作品"}
                            loading="lazy"
                            decoding="async"
                            className="size-full object-cover"
                          />
                        ) : (
                          <ImageUnavailable availability={item.availability} className="size-full" />
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-2 p-2.5">
                        <p className="line-clamp-2 flex-1 text-[11px] leading-snug text-[var(--ink-soft)]">
                          {item.prompt || "无提示词"}
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            disabled={!available}
                            onClick={() => {
                              onAddReference(item.url);
                              onClose();
                            }}
                            className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-xl bg-[#24170f] px-2 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <ImagePlus aria-hidden className="size-3" />
                            参考图
                          </button>
                          <button
                            type="button"
                            disabled={!item.prompt}
                            onClick={() => {
                              onPickPrompt(item.prompt);
                              onClose();
                            }}
                            className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-xl border border-[var(--line)] bg-white px-2 py-1.5 text-[11px] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <FileText aria-hidden className="size-3" />
                            提示词
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void handleLoadMore()}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                  >
                    {loadingMore && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
                    {loadingMore ? "加载中..." : "加载更多作品"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
