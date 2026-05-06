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
      className="flex flex-col gap-2 rounded-[1.4rem] border border-[var(--line)] bg-white/60 p-2 shadow-sm sm:flex-row"
    >
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)]" />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="搜索用户昵称、邮箱、任务 ID、提示词或模型…"
          className="min-h-12 w-full rounded-2xl border border-transparent bg-white/75 py-3 pl-11 pr-10 text-sm outline-none transition-all placeholder:text-[var(--ink-soft)]/65 focus:border-[var(--accent)] focus:bg-white"
        />
        {value ? (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
            title="清空搜索"
            aria-label="清空搜索"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <button
        type="submit"
        className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[var(--ink)] px-5 text-sm font-medium text-white transition hover:bg-[var(--accent)]"
      >
        <Search className="size-4" />
        搜索
      </button>
    </form>
  );
}
