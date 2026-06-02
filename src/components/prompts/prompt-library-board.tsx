"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Library,
  Loader2,
  Search,
  SlidersHorizontal,
  Sparkles,
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
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
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
      <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        
        {/* Modern Search Hero Section */}
        <div className="relative mb-8 overflow-hidden rounded-3xl border border-[var(--line)] bg-[#fffaf2]/74 p-8 shadow-[0_20px_50px_rgba(84,52,29,0.03)] backdrop-blur-xl md:p-12">
          {/* Decorative ambient blurred lights */}
          <div className="absolute -right-24 -top-24 size-72 rounded-full bg-[var(--accent)]/10 blur-[120px]" />
          <div className="absolute -left-24 -bottom-24 size-72 rounded-full bg-[#eadcca]/30 blur-[120px]" />

          <div className="relative flex flex-col items-center text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-semibold tracking-wider text-[var(--accent)]">
              <Sparkles className="size-3.5" />
              PROMPT LIBRARY
            </span>
            <h1 className="mt-4 font-serif text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl md:text-5xl">
              灵感画廊
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--ink-soft)] md:text-base">
              探索、学习并一键应用精心挑选的叙事性艺术生成提示词，开启下一代视觉创作之旅。
            </p>

            {/* Central Search Bar */}
            <div className="mt-8 w-full max-w-2xl">
              <div className="group relative flex items-center rounded-2xl border border-[var(--line)] bg-white px-4 py-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.02)] transition-all duration-300 hover:border-[var(--accent)]/60 hover:shadow-md focus-within:!border-[var(--accent)] focus-within:ring-4 focus-within:ring-[var(--accent)]/15">
                <Search className="size-5 shrink-0 text-[var(--ink-soft)]/70 transition-colors group-focus-within:text-[var(--accent)]" />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索标题、标签或提示词内容..."
                  className="ml-3 min-w-0 flex-1 bg-transparent text-base text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]/45"
                />
                {keyword && (
                  <button
                    type="button"
                    onClick={() => setKeyword("")}
                    className="rounded-full p-1 text-[var(--ink-soft)] transition hover:bg-[#fffaf2] hover:text-[var(--ink)]"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Category horizontal bar + Filters trigger */}
        <div className="mb-6 flex flex-col gap-4 border-b border-[var(--line)]/50 pb-5 md:flex-row md:items-center md:justify-between">
          
          {/* Horizontal scrollable Source Tabs (Elegant Custom Scrollbar) */}
          <div className="flex flex-1 min-w-0 items-center gap-2 overflow-x-auto pb-2 pr-4 [scrollbar-width:thin] [scrollbar-color:rgba(84,52,29,0.18)_transparent] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--line)] hover:[&::-webkit-scrollbar-thumb]:bg-[var(--accent)]/50">
            <button
              type="button"
              onClick={() => setSource(ALL_SOURCE)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-300",
                source === ALL_SOURCE
                  ? "bg-[#21170f] text-white shadow-sm"
                  : "border border-[var(--line)] bg-[#fffaf2]/58 text-[var(--ink-soft)] hover:border-[var(--accent)]/40 hover:bg-[#fffaf2] hover:text-[var(--ink)]"
              )}
            >
              <span>全部来源</span>
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                source === ALL_SOURCE
                  ? "bg-white/20 text-white"
                  : "bg-[var(--line)] text-[var(--ink-soft)]"
              )}>
                {totalSourceCount}
              </span>
            </button>

            {data.categories.map((item) => {
              const active = source === item.slug;
              return (
                <button
                  key={item.slug}
                  type="button"
                  onClick={() => setSource(item.slug)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-300",
                    active
                      ? "bg-[#21170f] text-white shadow-sm"
                      : "border border-[var(--line)] bg-[#fffaf2]/58 text-[var(--ink-soft)] hover:border-[var(--accent)]/40 hover:bg-[#fffaf2] hover:text-[var(--ink)]"
                  )}
                >
                  <span className="max-w-[140px] truncate">{item.name}</span>
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                    active
                      ? "bg-white/20 text-white"
                      : "bg-[var(--line)] text-[var(--ink-soft)]"
                  )}>
                    {item.itemCount}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action Tools */}
          <div className="flex shrink-0 items-center gap-2 self-end md:self-auto">
            <button
              type="button"
              onClick={() => setIsFilterExpanded(!isFilterExpanded)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-300 cursor-pointer",
                selectedTags.length > 0 || isFilterExpanded
                  ? "border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]"
                  : "border border-[var(--line)] bg-[#fffaf2]/58 text-[var(--ink-soft)] hover:border-[var(--accent)]/40 hover:bg-[#fffaf2] hover:text-[var(--ink)]"
              )}
            >
              <SlidersHorizontal className="size-4" />
              <span>筛选标签</span>
              {selectedTags.length > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
                  {selectedTags.length}
                </span>
              )}
              {isFilterExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>

            {isAdmin && (
              <Link
                href="/admin/prompts"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[#21170f] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-300 hover:bg-[var(--accent)]"
              >
                <span>同步管理</span>
                <ExternalLink className="size-3.5" />
              </Link>
            )}
          </div>
        </div>

        {/* Collapsible tag filtering section */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-300 ease-in-out",
            isFilterExpanded ? "mb-6 max-h-[30rem] opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className="rounded-2xl border border-[var(--line)] bg-[#fffaf2]/74 p-5 shadow-[0_12px_36px_rgba(84,52,29,0.03)] backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-[var(--line)]/50 pb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                <Tags className="size-4 text-[var(--accent)]" />
                <span>按标签筛选提示词</span>
              </div>
              {selectedTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTags([])}
                  className="text-xs text-[var(--accent)] hover:underline cursor-pointer"
                >
                  清空已选标签
                </button>
              )}
            </div>
            
            <div className="mt-4 flex flex-wrap gap-2 overflow-y-auto max-h-56 pr-2 py-1">
              {data.tags.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      "rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 cursor-pointer",
                      active
                        ? "bg-[var(--accent)] text-white shadow-sm"
                        : "border border-[var(--line)] bg-white/60 text-[var(--ink-soft)] hover:border-[var(--accent)]/40 hover:bg-white hover:text-[var(--ink)]"
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Active Filter Chips indicator */}
        {(keyword || source !== ALL_SOURCE || selectedTags.length > 0) && (
          <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--accent)]/5 px-4 py-2.5 text-xs text-[var(--ink-soft)] border border-[var(--accent)]/10">
            <span className="font-semibold text-[var(--accent)]">当前筛选条件：</span>
            {keyword && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-0.5 border border-[var(--line)] shadow-sm">
                搜索: &quot;{keyword}&quot;
                <button type="button" onClick={() => setKeyword("")} className="hover:text-red-500 ml-1 cursor-pointer"><X className="size-3" /></button>
              </span>
            )}
            {source !== ALL_SOURCE && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-0.5 border border-[var(--line)] shadow-sm">
                分类: {data.categories.find(c => c.slug === source)?.name || source}
                <button type="button" onClick={() => setSource(ALL_SOURCE)} className="hover:text-red-500 ml-1 cursor-pointer"><X className="size-3" /></button>
              </span>
            )}
            {selectedTags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-0.5 border border-[var(--line)] shadow-sm">
                标签: #{tag}
                <button type="button" onClick={() => toggleTag(tag)} className="hover:text-red-500 ml-1 cursor-pointer"><X className="size-3" /></button>
              </span>
            ))}
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-xs font-semibold text-[var(--accent)] hover:underline cursor-pointer"
            >
              重置所有筛选
            </button>
          </div>
        )}

        {/* Gallery Content Section */}
        <div className="min-w-0">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <h2 className="font-serif text-2xl font-bold tracking-tight text-[var(--ink)]">
                灵感作品库
              </h2>
              <span className="text-xs text-[var(--ink-soft)]">
                (共 <span className="font-semibold text-[var(--accent)]">{data.total}</span> 条匹配提示词)
              </span>
            </div>
            {isPending && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white/70 px-2.5 py-1 text-xs font-semibold text-[var(--ink-soft)] shadow-sm animate-pulse">
                <Loader2 className="size-3.5 animate-spin" />
                正在加载数据...
              </span>
            )}
          </div>

          {error && (
            <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-700 shadow-sm">
              {error}
            </div>
          )}

          {data.items.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
            <div className="grid min-h-80 place-items-center rounded-3xl border border-dashed border-[var(--line)] bg-[#fffaf2]/58 px-6 py-12 text-center shadow-inner">
              <div className="max-w-md">
                <Library className="mx-auto size-12 text-[var(--ink-soft)]/30" />
                <p className="mt-4 text-base font-bold text-[var(--ink)]">暂无匹配提示词结果</p>
                <p className="mt-2 text-sm text-[var(--ink-soft)]">
                  {totalSourceCount === 0 ? "管理员同步 GitHub 来源后会显示丰富内容。" : "尝试更改关键词、选择不同的来源或精简筛选标签。"}
                </p>
                {(keyword || source !== ALL_SOURCE || selectedTags.length > 0) && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#21170f] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--accent)] cursor-pointer"
                  >
                    重置筛选条件
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Load More Trigger */}
          {hasMore && (
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                onClick={() => startTransition(() => void fetchPromptPage({ nextPage: data.page + 1, replace: false }))}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[#fffaf2]/80 px-6 py-3 text-sm font-semibold text-[var(--ink)] shadow-[0_4px_14px_rgba(84,52,29,0.04)] transition hover:border-[var(--accent)] hover:bg-white hover:text-[var(--accent)] disabled:opacity-50 cursor-pointer"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                <span>加载更多提示词</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Prompts Detail Drawer / Dialog */}
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
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[#fffaf2]/78 shadow-[0_12px_30px_rgba(84,52,29,0.03)] transition-all duration-500 hover:-translate-y-1 hover:border-[var(--accent)]/30 hover:bg-white hover:shadow-[0_20px_40px_rgba(84,52,29,0.08)]">
      
      {/* Cover Image Wrapper with hover overlay */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#eadcca]">
        {item.coverUrl ? (
          <img
            src={item.coverUrl}
            alt={item.title}
            loading="lazy"
            className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-[linear-gradient(135deg,#f7efe4,#e8d5bf)] px-5 text-center text-sm font-semibold text-[var(--ink-soft)]">
            {item.title}
          </div>
        )}

        {/* Hover translucent mask */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {/* Category Label badge */}
        <span className="absolute left-3 top-3 rounded-full bg-[#21170f]/80 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md border border-white/10 shadow-sm">
          {item.source.name}
        </span>

        {/* Hover quick action panel */}
        <div className="absolute inset-0 flex items-center justify-center gap-3 opacity-0 transition-all duration-300 translate-y-3 group-hover:opacity-100 group-hover:translate-y-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            className="flex size-11 items-center justify-center rounded-full bg-white/95 text-[var(--ink)] shadow-md backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-white hover:text-[var(--accent)] cursor-pointer"
            title="复制提示词"
          >
            {copied ? <Check className="size-5 text-[var(--accent)]" /> : <Copy className="size-5" />}
          </button>
          <Link
            href={canCreate ? `/create?prompt=${encodeURIComponent(item.prompt)}` : "/login"}
            onClick={(e) => e.stopPropagation()}
            className="flex size-11 items-center justify-center rounded-full bg-[#21170f]/90 text-white shadow-md backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-[var(--accent)]"
            title="去创作"
          >
            <WandSparkles className="size-5" />
          </Link>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="flex size-11 items-center justify-center rounded-full bg-white/95 text-[var(--ink)] shadow-md backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-white hover:text-[var(--accent)] cursor-pointer"
            title="查看详情"
          >
            <Search className="size-5" />
          </button>
        </div>
      </div>

      {/* Main card description */}
      <button type="button" onClick={onOpen} className="block w-full flex-1 text-left cursor-pointer">
        <div className="flex flex-col h-full p-5">
          <h3 className="line-clamp-1 font-serif text-lg font-bold leading-snug text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">
            {item.title}
          </h3>
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--ink-soft)]/90 flex-1">
            {item.prompt}
          </p>
          <div className="mt-4 flex min-h-7 flex-wrap gap-1.5">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-[var(--line)] bg-white/50 px-2.5 py-0.5 text-[10px] font-medium text-[var(--ink-soft)]"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </button>

      {/* Grid Card action buttons footer */}
      <div className="flex items-center gap-2 border-t border-[var(--line)]/50 px-4 py-3.5 bg-[#fffaf2]/35">
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--line)] bg-white/70 py-2.5 text-xs font-semibold text-[var(--ink)] transition-all duration-200 cursor-pointer",
            copied ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/5" : "hover:border-[var(--accent)]/60 hover:bg-white hover:text-[var(--ink)]"
          )}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "已复制" : "复制提示词"}
        </button>
        <Link
          href={canCreate ? `/create?prompt=${encodeURIComponent(item.prompt)}` : "/login"}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#21170f] to-[#3a291b] py-2.5 text-xs font-semibold text-white transition-all duration-300 hover:from-[var(--accent)] hover:to-[var(--accent)] hover:shadow-sm hover:shadow-[var(--accent)]/20"
        >
          <WandSparkles className="size-3.5" />
          去创作
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-[var(--line)] bg-[#fffaf2] shadow-[0_25px_60px_rgba(20,12,7,0.25)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[var(--line)]/60 px-6 py-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2.5 py-0.5 text-xs font-semibold text-[var(--accent)]">
              {item.source.name}
            </span>
            <h2 className="mt-1.5 truncate font-serif text-xl font-bold text-[var(--ink)] sm:text-2xl">
              {item.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] transition-all duration-200 hover:bg-[#21170f]/5 hover:text-[var(--ink)] cursor-pointer"
            aria-label="关闭"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Modal Layout Grid */}
        <div className="grid flex-1 overflow-y-auto md:grid-cols-[1fr_1.3fr]">
          
          {/* Left panel cover image */}
          <div className="relative flex min-h-64 items-center justify-center bg-[#eadcca]/60 p-6 md:h-full md:min-h-0 md:p-8">
            {item.coverUrl ? (
              <img
                src={item.coverUrl}
                alt={item.title}
                className="max-h-[35dvh] w-full rounded-2xl object-contain shadow-md md:max-h-[52dvh]"
              />
            ) : (
              <div className="grid size-full place-items-center text-center text-lg font-semibold text-[var(--ink-soft)]">
                {item.title}
              </div>
            )}
          </div>

          {/* Right panel meta descriptions & tools */}
          <div className="flex flex-col p-6 sm:p-8">
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[var(--line)] bg-white/60 px-3 py-1 text-xs font-medium text-[var(--ink-soft)]"
                >
                  #{tag}
                </span>
              ))}
            </div>

            {/* Code syntax prompt input area */}
            <div className="relative mt-5 flex-1 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-inner">
              <div className="absolute right-3 top-3">
                <button
                  type="button"
                  onClick={onCopy}
                  className="flex size-8 items-center justify-center rounded-lg border border-[var(--line)] bg-[#fffaf2]/80 text-[var(--ink-soft)] transition-colors hover:border-[var(--accent)] hover:bg-white hover:text-[var(--accent)] cursor-pointer"
                  title="复制提示词"
                >
                  {copied ? <Check className="size-4 text-[var(--accent)]" /> : <Copy className="size-4" />}
                </button>
              </div>
              <div className="overflow-y-auto max-h-64 pr-2">
                <p className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--ink)] select-all pr-6">
                  {item.prompt}
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="mt-6 flex flex-col gap-2.5">
              <Link
                href={canCreate ? `/create?prompt=${encodeURIComponent(item.prompt)}` : "/login"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#21170f] to-[#3a291b] px-5 py-3.5 text-sm font-semibold text-white shadow-md transition-all duration-300 hover:from-[var(--accent)] hover:to-[var(--accent)] hover:shadow-lg"
              >
                <WandSparkles className="size-4" />
                <span>立即使用此提示词去创作</span>
              </Link>

              <button
                type="button"
                onClick={onCopy}
                className={cn(
                  "inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-5 py-3.5 text-sm font-semibold transition-all duration-200 cursor-pointer",
                  copied
                    ? "border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]"
                    : "border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--accent)] hover:bg-[#fffaf2]/40"
                )}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                <span>{copied ? "已复制到剪切板" : "复制提示词文本"}</span>
              </button>
            </div>

            {/* Github source reference */}
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex items-center justify-center gap-1 text-xs font-semibold text-[var(--ink-soft)] transition-colors hover:text-[var(--accent)]"
            >
              <span>在 GitHub 上查看此提示词来源</span>
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
