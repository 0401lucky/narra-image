"use client";

/* eslint-disable @next/next/no-img-element */

// 工作台内嵌提示词库弹窗：调用 GET /api/prompts 搜索、按来源筛选、翻页并一键填入提示词。
import { BookOpen, Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type PromptCategory = {
  id: string;
  itemCount: number;
  name: string;
  slug: string;
};

type PromptItem = {
  id: string;
  title: string;
  prompt: string;
  coverUrl: string | null;
  preview: string | null;
  tags: string[];
  source: {
    id: string;
    name: string;
    slug: string;
  };
};

type PromptPickerModalProps = {
  open: boolean;
  onClose: () => void;
  onPickPrompt: (promptText: string) => void;
};

export function PromptPickerModal({ open, onClose, onPickPrompt }: PromptPickerModalProps) {
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [selectedSource, setSelectedSource] = useState("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<PromptItem[]>([]);
  const [categories, setCategories] = useState<PromptCategory[]>([]);
  const [total, setTotal] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const queryKey = `${debouncedKeyword}|${selectedSource}|${page}`;
  const loading = open && settledKey !== queryKey;
  const error = errorState?.key === queryKey ? errorState.message : null;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    const params = new URLSearchParams({
      page: String(page),
      pageSize: "18",
    });
    if (debouncedKeyword) params.set("keyword", debouncedKeyword);
    if (selectedSource !== "all") params.set("source", selectedSource);

    void fetch(`/api/prompts?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json().catch(() => null)) as {
          data?: {
            categories?: PromptCategory[];
            items?: PromptItem[];
            total?: number;
          };
          error?: string;
        } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !result?.data) {
          setErrorState({ key: queryKey, message: result?.error || "提示词库加载失败，请稍后重试" });
          setSettledKey(queryKey);
          return;
        }
        setErrorState(null);
        setItems(result.data.items ?? []);
        setCategories(result.data.categories ?? []);
        setTotal(result.data.total ?? 0);
        setSettledKey(queryKey);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setErrorState({ key: queryKey, message: err instanceof Error ? err.message : "提示词库加载失败" });
        setSettledKey(queryKey);
      });

    return () => controller.abort();
  }, [open, debouncedKeyword, selectedSource, page, queryKey]);

  if (!open) return null;

  const totalPages = Math.max(1, Math.ceil(total / 18));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="选择提示词"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#21170f]/45 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-[var(--line)] bg-[#fffcf7] shadow-[0_28px_72px_rgba(33,23,15,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)]/70 bg-[#faf4ea]/85 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <BookOpen aria-hidden className="size-4 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--ink)]">提示词库</h2>
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-[var(--ink-soft)] border border-[var(--line)]">
              共 {total} 条
            </span>
          </div>
          <button
            type="button"
            aria-label="关闭提示词库"
            onClick={onClose}
            className="cursor-pointer rounded-xl p-1.5 text-[var(--ink-soft)] transition hover:bg-white hover:text-[var(--ink)]"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="space-y-2.5 border-b border-[var(--line)]/60 bg-[#fffaf2] px-5 py-3">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)]/60" />
            <input
              ref={inputRef}
              type="search"
              aria-label="搜索提示词"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索标题或提示词关键词…"
              className="w-full rounded-xl border border-[var(--line)] bg-white py-2 pl-9 pr-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedSource("all");
                  setPage(1);
                }}
                className={cn(
                  "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition",
                  selectedSource === "all"
                    ? "border-[var(--accent)] bg-[#fff2e6] text-[var(--accent)]"
                    : "border-[var(--line)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink)]",
                )}
              >
                全部来源
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => {
                    setSelectedSource(category.slug);
                    setPage(1);
                  }}
                  className={cn(
                    "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition",
                    selectedSource === category.slug
                      ? "border-[var(--accent)] bg-[#fff2e6] text-[var(--accent)]"
                      : "border-[var(--line)] bg-white text-[var(--ink-soft)] hover:text-[var(--ink)]",
                  )}
                >
                  {category.name}
                </button>
              ))}
            </div>
          )}
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
              正在加载提示词…
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-xs text-[var(--ink-soft)]">
              没有找到匹配的提示词
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[#fffaf2] shadow-2xs transition hover:border-[#cfa27a]"
                >
                  {item.coverUrl && (
                    <div className="aspect-[16/10] w-full overflow-hidden bg-[#efe6d8]">
                      <img
                        src={item.coverUrl}
                        alt={item.title}
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-3">
                    <h3 className="line-clamp-1 text-xs font-semibold text-[var(--ink)]">
                      {item.title}
                    </h3>
                    <p className="mt-1 line-clamp-3 flex-1 text-[11px] leading-relaxed text-[var(--ink-soft)]">
                      {item.prompt}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] text-[var(--ink-soft)]/80">
                        {item.source.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onPickPrompt(item.prompt);
                          onClose();
                        }}
                        className="shrink-0 cursor-pointer rounded-xl bg-[#24170f] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-[var(--accent)]"
                      >
                        填入提示词
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--line)]/70 bg-[#faf4ea]/75 px-5 py-2.5 text-xs text-[var(--ink-soft)]">
            <span>第 {page} / {totalPages} 页</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="cursor-pointer rounded-xl border border-[var(--line)] bg-white px-3 py-1 font-medium text-[var(--ink)] disabled:opacity-45"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                className="cursor-pointer rounded-xl border border-[var(--line)] bg-white px-3 py-1 font-medium text-[var(--ink)] disabled:opacity-45"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
