"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";

export function UserSearchBar({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      router.push(`/admin/users?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push("/admin/users");
    }
  }

  function handleClear() {
    setValue("");
    router.push("/admin/users");
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)]" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="搜索用户邮箱或昵称…"
          className="w-full rounded-2xl border border-[var(--line)] bg-white/70 py-3 pl-11 pr-10 outline-none transition-all focus:border-[var(--accent)]"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <button
        type="submit"
        className="shrink-0 rounded-2xl bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent)]"
      >
        搜索
      </button>
    </form>
  );
}
