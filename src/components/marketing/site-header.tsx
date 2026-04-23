import Link from "next/link";

import { cn } from "@/lib/utils";
import { LogoutButton } from "@/components/auth/logout-button";

type SiteHeaderProps = {
  currentUser: {
    credits: number;
    role: "user" | "admin";
  } | null;
  className?: string;
};

export function SiteHeader({ currentUser, className }: SiteHeaderProps) {
  return (
    <header
      className={cn(
        "mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 md:px-8",
        className,
      )}
    >
      <Link href="/" className="flex items-center gap-3">
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-1 text-xs uppercase tracking-[0.35em] text-[var(--ink-soft)]">
          Narra
        </span>
        <span className="editorial-title text-3xl font-semibold text-[var(--ink)]">
          Image
        </span>
      </Link>

      <nav className="hidden items-center gap-2 md:flex">
        <Link href="/" className="ring-link rounded-full px-4 py-2 text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]">
          首页
        </Link>
        <Link
          href="/create"
          className="ring-link rounded-full px-4 py-2 text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]"
        >
          创作台
        </Link>
        {currentUser?.role === "admin" ? (
          <Link
            href="/admin"
            className="ring-link rounded-full px-4 py-2 text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]"
          >
            管理后台
          </Link>
        ) : null}
      </nav>

      <div className="flex items-center gap-3">
        {currentUser ? (
          <div className="flex items-center gap-2">
            <div className="studio-card rounded-full px-4 py-2 text-sm hidden sm:block">
              <span className="mr-2 text-[var(--ink-soft)]">剩余积分</span>
              <span className="font-semibold text-[var(--accent)]">
                {currentUser.credits}
              </span>
            </div>
            <LogoutButton />
          </div>
        ) : null}
        <Link
          href={currentUser ? "/create" : "/login"}
          className="rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[var(--accent)]"
        >
          {currentUser ? "继续创作" : "登录开启"}
        </Link>
      </div>
    </header>
  );
}
