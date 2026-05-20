"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";

type GenerationSearchBarProps = {
  initialValue: string;
  view: "card" | "list";
};

function buildGenerationsUrl(view: GenerationSearchBarProps["view"], query?: string) {
  const params = new URLSearchParams({ view });
  if (query) {
    params.set("q", query);
  }
  return `/admin/generations?${params.toString()}`;
}

export function GenerationSearchBar({
  initialValue,
  view,
}: GenerationSearchBarProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    router.push(buildGenerationsUrl(view, trimmed || undefined));
  }

  function handleClear() {
    setValue("");
    router.push(buildGenerationsUrl(view));
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-[1.4rem] border border-[var(--admin-line)] bg-white/60 p-2 shadow-sm shadow-[#2c1d11]/3 sm:flex-row"
    >
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)] pointer-events-none" />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="搜索用户昵称、邮箱、任务 ID、提示词或模型…"
          className="min-h-12 w-full rounded-2xl border border-transparent bg-white/75 py-3 pl-11 pr-10 text-sm outline-none transition-all duration-200 placeholder:text-[var(--ink-soft)]/65 focus:border-[#d87b37] focus:bg-white focus:shadow-[0_0_0_4px_rgba(217,100,58,0.12)]"
        />
        {value ? (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[var(--ink-soft)] transition-all duration-200 hover:bg-[#2c1d11]/5 hover:text-[var(--ink)]"
            title="清空搜索"
            aria-label="清空搜索"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <button
        type="submit"
        className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#2a1b12] px-6 text-sm font-medium text-white transition-all duration-200 hover:bg-[#d87b37] hover:shadow-md hover:shadow-[#d87b37]/10 active:scale-95"
      >
        <Search className="size-4" />
        搜索
      </button>
    </form>
  );
}
