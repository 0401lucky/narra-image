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
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)] pointer-events-none" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="搜索用户邮箱或昵称…"
          className="w-full rounded-2xl border border-[var(--admin-line)] bg-white/70 py-3 pl-11 pr-10 outline-none transition-all duration-200 focus:border-[#d87b37] focus:bg-white focus:shadow-[0_0_0_4px_rgba(217,100,58,0.12)]"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[var(--ink-soft)] transition hover:bg-[#2c1d11]/5 hover:text-[var(--ink)]"
            title="清空"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <button
        type="submit"
        className="shrink-0 rounded-2xl bg-[#2a1b12] px-6 py-3 text-sm font-medium text-white transition-all duration-200 hover:bg-[#d87b37] hover:shadow-md hover:shadow-[#d87b37]/10 active:scale-95"
      >
        搜索
      </button>
    </form>
  );
}
