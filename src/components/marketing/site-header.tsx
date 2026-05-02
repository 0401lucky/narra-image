/* eslint-disable @next/next/no-img-element */
import Link from "next/link";

import { getCheckInSummary } from "@/lib/benefits/config";
import { cn } from "@/lib/utils";
import { LogoutButton } from "@/components/auth/logout-button";
import { CheckInButton } from "@/components/benefits/check-in-button";
import { HeaderShell } from "@/components/marketing/header-shell";
import { PetToggle } from "@/components/pet/pet-toggle";
import { getThumbUrl } from "@/lib/image-url";

type SiteHeaderProps = {
  currentUser: {
    id: string;
    credits: number;
    role: "user" | "admin";
    nickname?: string | null;
    avatarUrl?: string | null;
  } | null;
  className?: string;
  showCheckIn?: boolean;
};

export async function SiteHeader({
  currentUser,
  className,
  showCheckIn = true,
}: SiteHeaderProps) {
  const links = [
    { href: "/", label: "首页" },
    { href: "/create", label: "创作台" },
    { href: "/works", label: "作品" },
    ...(currentUser?.role === "admin"
      ? [{ href: "/admin", label: "管理后台" }]
      : []),
  ];
  const checkInSummary = currentUser && showCheckIn
    ? await getCheckInSummary(currentUser.id)
    : null;

  const displayName = currentUser?.nickname || undefined;

  return (
    <HeaderShell>
      <header
        className={cn(
          "mx-auto w-full max-w-7xl px-5 py-5 md:px-8",
          className,
        )}
      >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" prefetch={false} className="flex items-center gap-3">
            <span className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-1 text-xs uppercase tracking-[0.35em] text-[var(--ink-soft)]">
              Narra
            </span>
            <span className="editorial-title text-3xl font-semibold text-[var(--ink)]">
              Image
            </span>
          </Link>
          <a
            href="https://github.com/0401lucky/narra-image"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub 仓库"
            title="GitHub 仓库"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
          >
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
              className="size-4"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>

        <nav className="hidden items-center gap-2 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              prefetch={false}
              className="ring-link rounded-full px-4 py-2 text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {currentUser ? (
            <div className="flex items-center gap-2">
              <div className="studio-card flex items-center gap-2 rounded-full px-3 py-2 text-sm sm:px-4">
                <span className="text-[var(--ink-soft)]">剩余积分</span>
                <span className="font-semibold text-[var(--accent)]">
                  {currentUser.credits}
                </span>
                {checkInSummary ? (
                  <CheckInButton
                    checkedInToday={checkInSummary.checkedInToday}
                    rewardCredits={checkInSummary.checkInReward}
                    variant="compact"
                  />
                ) : null}
                {/* 桌面宠物开关：紧邻签到按钮，登录用户可控 */}
                <PetToggle />
              </div>

              {/* 用户头像 — 点击跳转设置页 */}
              <Link
                href="/settings"
                prefetch={false}
                className="group relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--line)] bg-[var(--surface-strong)] transition hover:border-[var(--accent)]"
                title={displayName ?? "个人设置"}
              >
                {currentUser.avatarUrl ? (
                  <img
                    src={getThumbUrl(currentUser.avatarUrl, 64)}
                    alt="头像"
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-semibold text-[var(--ink-soft)] transition group-hover:text-[var(--accent)]">
                    {(displayName ?? currentUser.id)[0]?.toUpperCase()}
                  </span>
                )}
              </Link>

              <LogoutButton />
            </div>
          ) : null}
          <Link
            href={currentUser ? "/create" : "/login"}
            prefetch={false}
            className="rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[var(--accent)]"
          >
            {currentUser ? "继续创作" : "登录开启"}
          </Link>
        </div>
      </div>

      <nav className="mt-4 flex flex-wrap gap-2 md:hidden">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            prefetch={false}
            className="ring-link rounded-full px-4 py-2 text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      </header>
    </HeaderShell>
  );
}
