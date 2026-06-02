"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Library,
  Loader2,
  Search,
  Tags,
  WandSparkles,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { PromptLibraryPrompt, PromptLibraryResponse } from "@/lib/prompts/types";

type PromptLibraryBoardProps = {
  canCreate: boolean;
  initialData: PromptLibraryResponse;
  isAdmin: boolean;
};

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

const ALL_SOURCE = "all";

export function PromptLibraryBoard({ canCreate, initialData, isAdmin }: PromptLibraryBoardProps) {
  const [data, setData] = useState(initialData);
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState(ALL_SOURCE);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptLibraryPrompt | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const firstFetchSkippedRef = useRef(false);

  const totalSourceCount = useMemo(
    () => data.categories.reduce((sum, item) => sum + item.itemCount, 0),
    [data.categories],
  );
  const hasMore = data.items.length < data.total;

  useEffect(() => {
    if (!firstFetchSkippedRef.current) {
      firstFetchSkippedRef.current = true;
      return;
    }

    const timer = window.setTimeout(() => {
      startTransition(() => {
        void fetchPromptPage({ nextPage: 1, replace: true });
      });
    }, 220);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, source, selectedTags.join("|")]);

  async function fetchPromptPage({ nextPage, replace }: { nextPage: number; replace: boolean }) {
    setError(null);
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(data.pageSize),
    });
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (source !== ALL_SOURCE) params.set("source", source);
    for (const tag of selectedTags) {
      params.append("tag", tag);
    }

    const response = await fetch(`/api/prompts?${params.toString()}`);
    const result = (await response.json()) as ApiResponse<PromptLibraryResponse>;
    if (!response.ok || !result.data) {
      setError(result.error || "提示词加载失败");
      return;
    }

    const nextData = result.data;
    setData((current) => ({
      ...nextData,
      items: replace ? nextData.items : [...current.items, ...nextData.items],
    }));
  }

  async function copyPrompt(item: PromptLibraryPrompt) {
    await navigator.clipboard.writeText(item.prompt);
    setCopiedId(item.id);
    window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1200);
  }

  function toggleTag(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  }

  function clearFilters() {
    setKeyword("");
    setSource(ALL_SOURCE);
    setSelectedTags([]);
  }

  return (
    <>
      <section className="mx-auto grid w-full max-w-[96rem] gap-6 px-4 pb-12 pt-7 sm:px-6 md:px-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:pt-9">
        <aside className="lg:sticky lg:top-24 lg:h-[calc(100dvh-7rem)]">
          <div className="flex h-full flex-col rounded-[1.35rem] border border-[var(--line)] bg-[#fffaf2]/74 p-4 shadow-[0_20px_55px_rgba(84,52,29,0.08)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--line)]/70 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
                  Prompt Library
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ink)]">
                  提示词库
                </h1>
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--ink)] text-white">
                <Library className="size-5" />
              </span>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-semibold text-[var(--ink-soft)]">搜索</span>
              <span className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/76 px-3 py-2.5 shadow-sm">
                <Search className="size-4 shrink-0 text-[var(--ink-soft)]" />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="标题或提示词"
                  className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]/60"
                />
              </span>
            </label>

            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--ink-soft)]">
                <Library className="size-3.5" />
                来源
              </div>
              <div className="grid gap-1.5">
                <button
                  type="button"
                  onClick={() => setSource(ALL_SOURCE)}
                  className={cn(
                    "flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition",
                    source === ALL_SOURCE
                      ? "bg-[var(--ink)] text-white shadow-sm"
                      : "text-[var(--ink-soft)] hover:bg-white/76 hover:text-[var(--ink)]",
                  )}
                >
                  <span>全部来源</span>
                  <span className="text-xs opacity-75">{totalSourceCount}</span>
                </button>
                {data.categories.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => setSource(item.slug)}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition",
                      source === item.slug
                        ? "bg-[var(--ink)] text-white shadow-sm"
                        : "text-[var(--ink-soft)] hover:bg-white/76 hover:text-[var(--ink)]",
                    )}
                  >
                    <span className="min-w-0 truncate">{item.name}</span>
                    <span className="shrink-0 text-xs opacity-75">{item.itemCount}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 min-h-0 flex-1">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--ink-soft)]">
                <Tags className="size-3.5" />
                标签
              </div>
              <div className="premium-scrollbar flex max-h-56 flex-wrap gap-1.5 overflow-y-auto pr-1 lg:max-h-full">
                {data.tags.map((tag) => {
                  const active = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition",
                        active
                          ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                          : "border-[var(--line)] bg-white/58 text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--ink)]",
                      )}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {(keyword || source !== ALL_SOURCE || selectedTags.length > 0) && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 rounded-full border border-[var(--line)] bg-white/68 px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
              >
                清空筛选
              </button>
            )}

            {isAdmin && (
              <Link
                href="/admin/prompts"
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-[#21170f] px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(33,23,15,0.18)] transition hover:bg-[var(--accent)]"
              >
                同步管理
                <ExternalLink className="size-3.5" />
              </Link>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm text-[var(--ink-soft)]">
                共 <span className="font-semibold text-[var(--accent)]">{data.total}</span> 条结果
              </p>
              <h2 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
                灵感画廊
              </h2>
            </div>
            {isPending && (
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/70 px-3 py-2 text-xs font-semibold text-[var(--ink-soft)]">
                <Loader2 className="size-3.5 animate-spin" />
                加载中
              </span>
            )}
          </div>

          {error && (
            <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {data.items.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {data.items.map((item) => (
                <PromptCard
                  key={item.id}
                  canCreate={canCreate}
                  copied={copiedId === item.id}
                  item={item}
                  onCopy={() => void copyPrompt(item)}
                  onOpen={() => setSelectedPrompt(item)}
                />
              ))}
            </div>
          ) : (
            <div className="grid min-h-80 place-items-center rounded-[1.35rem] border border-dashed border-[var(--line)] bg-[#fffaf2]/58 px-6 text-center">
              <div>
                <Library className="mx-auto size-10 text-[var(--ink-soft)]/45" />
                <p className="mt-4 text-base font-semibold text-[var(--ink)]">暂无匹配提示词</p>
                <p className="mt-2 text-sm text-[var(--ink-soft)]">
                  {totalSourceCount === 0 ? "管理员同步 GitHub 来源后会显示内容。" : "换一个关键词或标签组合。"}
                </p>
              </div>
            </div>
          )}

          {hasMore && (
            <div className="mt-7 flex justify-center">
              <button
                type="button"
                onClick={() => startTransition(() => void fetchPromptPage({ nextPage: data.page + 1, replace: false }))}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[#fffaf2]/78 px-5 py-2.5 text-sm font-semibold text-[var(--ink)] shadow-sm transition hover:border-[var(--accent)] disabled:opacity-55"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                加载更多
              </button>
            </div>
          )}
        </div>
      </section>

      {selectedPrompt && (
        <PromptDetailDialog
          canCreate={canCreate}
          copied={copiedId === selectedPrompt.id}
          item={selectedPrompt}
          onClose={() => setSelectedPrompt(null)}
          onCopy={() => void copyPrompt(selectedPrompt)}
        />
      )}
    </>
  );
}

function PromptCard({
  canCreate,
  copied,
  item,
  onCopy,
  onOpen,
}: {
  canCreate: boolean;
  copied: boolean;
  item: PromptLibraryPrompt;
  onCopy: () => void;
  onOpen: () => void;
}) {
  return (
    <article className="group overflow-hidden rounded-[1.1rem] border border-[var(--line)] bg-[#fffaf2]/78 shadow-[0_14px_38px_rgba(84,52,29,0.08)] transition hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:bg-[#fffaf2]">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-[4/3] overflow-hidden bg-[#eadcca]">
          {item.coverUrl ? (
            <img
              src={item.coverUrl}
              alt={item.title}
              loading="lazy"
              className="size-full object-cover transition duration-500 group-hover:scale-[1.035]"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-[linear-gradient(135deg,#f7efe4,#e8d5bf)] px-5 text-center text-sm font-semibold text-[var(--ink-soft)]">
              {item.title}
            </div>
          )}
          <span className="absolute left-3 top-3 max-w-[80%] truncate rounded-full bg-[#21170f]/82 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
            {item.source.name}
          </span>
        </div>
        <div className="p-4">
          <h3 className="line-clamp-2 min-h-11 text-base font-semibold leading-snug text-[var(--ink)]">
            {item.title}
          </h3>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--ink-soft)]">
            {item.prompt}
          </p>
          <div className="mt-3 flex min-h-7 flex-wrap gap-1.5">
            {item.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="rounded-full border border-[var(--line)] bg-white/58 px-2 py-0.5 text-[11px] text-[var(--ink-soft)]">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </button>
      <div className="flex items-center gap-2 border-t border-[var(--line)]/65 px-3 py-3">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[var(--line)] bg-white/68 px-3 py-2 text-xs font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "已复制" : "复制"}
        </button>
        <Link
          href={canCreate ? `/create?prompt=${encodeURIComponent(item.prompt)}` : "/login"}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
        >
          <WandSparkles className="size-3.5" />
          创作
        </Link>
      </div>
    </article>
  );
}

function PromptDetailDialog({
  canCreate,
  copied,
  item,
  onClose,
  onCopy,
}: {
  canCreate: boolean;
  copied: boolean;
  item: PromptLibraryPrompt;
  onClose: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[88dvh] w-full max-w-5xl overflow-hidden rounded-[1.35rem] border border-[var(--line)] bg-[#fffaf2] shadow-[0_28px_80px_rgba(20,12,7,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
              {item.source.name}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-[var(--ink)]">{item.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full text-[var(--ink-soft)] transition hover:bg-[#f0e3d2] hover:text-[var(--ink)]"
            aria-label="关闭"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="grid max-h-[calc(88dvh-4rem)] overflow-y-auto lg:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="bg-[#eadcca]">
            {item.coverUrl ? (
              <img src={item.coverUrl} alt={item.title} className="max-h-[58dvh] w-full object-contain lg:h-full lg:max-h-none" />
            ) : (
              <div className="grid min-h-80 place-items-center px-8 text-center text-lg font-semibold text-[var(--ink-soft)]">
                {item.title}
              </div>
            )}
          </div>

          <aside className="flex min-h-0 flex-col p-5">
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-[var(--line)] bg-white/62 px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                  {tag}
                </span>
              ))}
            </div>

            <div className="premium-scrollbar mt-4 max-h-80 overflow-y-auto rounded-xl border border-[var(--line)] bg-white/62 p-4">
              <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">{item.prompt}</p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[var(--line)] bg-white/72 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "已复制" : "复制提示词"}
              </button>
              <Link
                href={canCreate ? `/create?prompt=${encodeURIComponent(item.prompt)}` : "/login"}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent)]"
              >
                <WandSparkles className="size-4" />
                去创作台
              </Link>
            </div>

            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:bg-white/68 hover:text-[var(--ink)]"
            >
              查看 GitHub 来源
              <ExternalLink className="size-4" />
            </a>
          </aside>
        </div>
      </div>
    </div>
  );
}
