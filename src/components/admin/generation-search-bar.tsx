"use client";

import { RotateCcw, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  buildGenerationsFilterUrl,
  type GenerationModeFilter,
  type GenerationSourceFilter,
  type GenerationStatusFilter,
  type GenerationTypeFilter,
} from "./generations/filter-url";

export type {
  GenerationModeFilter,
  GenerationSourceFilter,
  GenerationStatusFilter,
  GenerationTypeFilter,
};

type GenerationSearchBarProps = {
  initialValue: string;
  mode?: GenerationModeFilter;
  source?: GenerationSourceFilter;
  status?: GenerationStatusFilter;
  type?: GenerationTypeFilter;
  view: "card" | "list";
};

export function GenerationSearchBar({
  initialValue,
  mode = "",
  source = "",
  status = "",
  type = "",
  view,
}: GenerationSearchBarProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);

  const hasAnyFilter = Boolean(value || status || type || source || mode);

  function pushNext(overrides: {
    mode?: string;
    q?: string;
    source?: string;
    status?: string;
    type?: string;
  }) {
    router.push(
      buildGenerationsFilterUrl({
        mode: overrides.mode ?? mode,
        q: overrides.q ?? value,
        source: overrides.source ?? source,
        status: overrides.status ?? status,
        type: overrides.type ?? type,
        view,
      }),
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    pushNext({ q: value.trim() });
  }

  function handleClear() {
    setValue("");
    pushNext({ q: "" });
  }

  return (
    <form onSubmit={handleSubmit} className="studio-card grid gap-3 p-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--ink-soft)]"
            aria-hidden
          />
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="搜索用户昵称、邮箱、任务 ID、提示词或模型…"
            className="w-full rounded-xl border border-[var(--admin-line)] bg-white py-2.5 pr-9 pl-10 text-sm outline-none"
          />
          {value ? (
            <button
              type="button"
              onClick={handleClear}
              className="absolute top-1/2 right-3 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-black/5 hover:text-[var(--ink)]"
              title="清空搜索"
              aria-label="清空搜索"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <button
          type="submit"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#c25934] px-5 py-2.5 text-sm font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a]"
        >
          <Search className="size-4" aria-hidden />
          搜索
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)]/60 pt-3 text-xs">
        <label className="inline-flex items-center gap-1.5">
          <span className="text-[var(--ink-soft)]">状态</span>
          <select
            value={status}
            aria-label="按任务状态筛选"
            onChange={(e) => pushNext({ status: e.target.value })}
            className="rounded-lg border border-[var(--admin-line)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--ink)] outline-none"
          >
            <option value="">默认视图（隐藏普通失败）</option>
            <option value="ALL">全部状态（含失败）</option>
            <option value="SUCCEEDED">仅已完成</option>
            <option value="ACTIVE">生成中 / 排队中</option>
            <option value="FAILED">已失败（排障模式）</option>
            <option value="COORDINATION">需人工协调（HANDOFF_UNKNOWN）</option>
          </select>
        </label>

        <label className="inline-flex items-center gap-1.5">
          <span className="text-[var(--ink-soft)]">任务类型</span>
          <select
            value={type}
            aria-label="按生成类型筛选"
            onChange={(e) => pushNext({ type: e.target.value })}
            className="rounded-lg border border-[var(--admin-line)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--ink)] outline-none"
          >
            <option value="">全部类型</option>
            <option value="TEXT_TO_IMAGE">文生图</option>
            <option value="IMAGE_TO_IMAGE">图生图</option>
            <option value="TEXT_TO_VIDEO">文生视频</option>
            <option value="IMAGE_TO_VIDEO">图生视频</option>
          </select>
        </label>

        <label className="inline-flex items-center gap-1.5">
          <span className="text-[var(--ink-soft)]">调用入口</span>
          <select
            value={source}
            aria-label="按调用来源筛选"
            onChange={(e) => pushNext({ source: e.target.value })}
            className="rounded-lg border border-[var(--admin-line)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--ink)] outline-none"
          >
            <option value="">全部入口</option>
            <option value="WEB">网页端</option>
            <option value="API">API 密钥调用</option>
          </select>
        </label>

        <label className="inline-flex items-center gap-1.5">
          <span className="text-[var(--ink-soft)]">渠道模式</span>
          <select
            value={mode}
            aria-label="按渠道模式筛选"
            onChange={(e) => pushNext({ mode: e.target.value })}
            className="rounded-lg border border-[var(--admin-line)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--ink)] outline-none"
          >
            <option value="">全部渠道</option>
            <option value="BUILT_IN">系统内置渠道</option>
            <option value="CUSTOM">用户自填渠道</option>
          </select>
        </label>

        {hasAnyFilter ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              router.push(buildGenerationsFilterUrl({ view }));
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[#faf7f1] px-2.5 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition hover:text-[#c85a32]"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            重置筛选
          </button>
        ) : null}
      </div>
    </form>
  );
}
