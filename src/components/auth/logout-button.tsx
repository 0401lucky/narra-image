"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm text-[var(--ink-soft)] transition hover:text-[var(--accent)]"
      title="退出登录"
    >
      <LogOut className="size-4" />
      <span className="hidden xl:inline">退出</span>
    </button>
  );
}
