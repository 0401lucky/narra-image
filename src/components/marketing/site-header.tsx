import Link from "next/link";

import { getCheckInSummary } from "@/lib/benefits/config";
import { cn } from "@/lib/utils";
import { LogoutButton } from "@/components/auth/logout-button";
import { CheckInButton } from "@/components/benefits/check-in-button";

type SiteHeaderProps = {
  currentUser: {
    id: string;
    credits: number;
    role: "user" | "admin";
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

  return (
    <header
      className={cn(
        "mx-auto w-full max-w-7xl px-5 py-5 md:px-8",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-1 text-xs uppercase tracking-[0.35em] text-[var(--ink-soft)]">
            Narra
          </span>
          <span className="editorial-title text-3xl font-semibold text-[var(--ink)]">
            Image
          </span>
        </Link>

        <nav className="hidden items-center gap-2 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
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
      </div>

      <nav className="mt-4 flex flex-wrap gap-2 md:hidden">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="ring-link rounded-full px-4 py-2 text-sm text-[var(--ink-soft)] hover:text-[var(--ink)]"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
