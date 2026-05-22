"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  Menu,
  X,
  Home,
  Wand2,
  Image as ImageIcon,
  Key,
  Settings,
  Coins,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoutButton } from "@/components/auth/logout-button";
import { CheckInButton } from "@/components/benefits/check-in-button";
import { PetToggle } from "@/components/pet/pet-toggle";
import { getThumbUrl } from "@/lib/image-url";

type MobileNavProps = {
  currentUser: {
    id: string;
    credits: number;
    role: "user" | "admin";
    nickname?: string | null;
    avatarUrl?: string | null;
  } | null;
  links: { href: string; label: string }[];
  activeHref?: string;
  checkInSummary: {
    checkedInToday: boolean;
    checkInReward: number;
  } | null;
};

// 图标映射
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  "首页": Home,
  "创作台": Wand2,
  "作品": ImageIcon,
  "API": Key,
  "管理后台": Settings,
};

export function MobileNav({
  currentUser,
  links,
  activeHref,
  checkInSummary,
}: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // 当前激活的 href 以传入的 activeHref 优先，其次匹配当前路径名
  const currentActive = activeHref || pathname;

  const displayName = currentUser?.nickname || (currentUser ? currentUser.id.slice(0, 8) : "");

  return (
    <div className="lg:hidden flex items-center shrink-0">
      {/* Hamburger Trigger Button */}
      <button
        onClick={() => setOpen(true)}
        className="flex size-10 items-center justify-center rounded-full border border-[var(--line)] bg-[#fffaf2]/70 text-[var(--ink-soft)] shadow-sm transition hover:bg-white hover:text-[var(--ink)] focus:outline-none"
        aria-label="打开导航菜单"
        aria-expanded={open}
      >
        <Menu className="size-5" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[4px]"
            />

            {/* Slide-out Drawer Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="fixed right-0 top-0 bottom-0 z-50 flex h-[100dvh] w-76 max-w-sm flex-col border-l border-[var(--line)] bg-[#f5efe6]/96 p-6 shadow-2xl backdrop-blur-2xl outline-none"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-5 border-b border-[var(--line)]/60">
                <div className="flex items-center gap-2">
                  <span className="editorial-title text-lg font-semibold uppercase tracking-[0.2em] text-[#9b5a20]">
                    Narra
                  </span>
                  <span className="editorial-title text-xl font-semibold text-[#21170f]">
                    Image
                  </span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1.5 text-[var(--ink-soft)] hover:bg-[#fffaf2]/80 hover:text-[var(--ink)] transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  aria-label="关闭导航菜单"
                >
                  <X className="size-5" />
                </button>
              </div>

              {/* Drawer Links Body */}
              <nav className="flex-1 space-y-2.5 pt-6 overflow-y-auto">
                {links.map((link) => {
                  const Icon = iconMap[link.label] || Sparkles;
                  const isActive = currentActive === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center justify-between rounded-2xl px-4 py-3.5 text-base font-medium transition duration-200 outline-none border border-transparent",
                        isActive
                          ? "bg-[#fffaf2]/80 text-[#21170f] font-semibold shadow-sm border-[var(--line)]/50 ring-1 ring-[var(--line)]/30"
                          : "text-[var(--ink-soft)] hover:bg-[#fffaf2]/40 hover:text-[#21170f]"
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className={cn("size-5", isActive ? "text-[var(--accent)]" : "text-[var(--ink-soft)]")} />
                        {link.label}
                      </span>
                      {isActive && <span className="text-xs text-[var(--accent)]">✦</span>}
                    </Link>
                  );
                })}
              </nav>

              {/* Drawer User Card Footer */}
              {currentUser ? (
                <div className="mt-auto border-t border-[var(--line)]/60 pt-5 space-y-4">
                  {/* User Profile Card */}
                  <div className="rounded-2xl border border-[var(--line)]/80 bg-[#fffaf2]/70 p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <Link
                        href="/settings"
                        onClick={() => setOpen(false)}
                        className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[var(--surface-strong)] shadow-sm hover:border-[var(--accent)] transition-colors"
                      >
                        {currentUser.avatarUrl ? (
                          <img
                            src={getThumbUrl(currentUser.avatarUrl, 64)}
                            alt="头像"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="text-sm font-semibold text-[var(--ink-soft)]">
                            {displayName[0]?.toUpperCase()}
                          </span>
                        )}
                      </Link>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--ink)] truncate leading-tight">
                          {displayName}
                        </p>
                        <p className="text-xs text-[var(--ink-soft)] truncate mt-0.5">
                          {currentUser.role === "admin" ? "管理员" : "创作者"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3.5 flex items-center justify-between border-t border-[var(--line)]/40 pt-3">
                      <div className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)] font-medium">
                        <Coins className="size-4 text-[var(--accent)]" />
                        <span>剩余积分</span>
                        <span className="font-bold text-[var(--ink)] text-sm tabular-nums ml-0.5">
                          {currentUser.credits}
                        </span>
                      </div>
                      <PetToggle />
                    </div>

                    {checkInSummary && (
                      <div className="mt-3 border-t border-[var(--line)]/40 pt-3 flex justify-center">
                        <CheckInButton
                          checkedInToday={checkInSummary.checkedInToday}
                          rewardCredits={checkInSummary.checkInReward}
                          variant="compact"
                        />
                      </div>
                    )}
                  </div>

                  {/* Actions Row */}
                  <div className="flex items-center justify-between px-2">
                    <Link
                      href="/settings"
                      onClick={() => setOpen(false)}
                      className="text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--ink)] hover:underline"
                    >
                      个人设置
                    </Link>
                    <LogoutButton />
                  </div>
                </div>
              ) : (
                <div className="mt-auto border-t border-[var(--line)]/60 pt-5 space-y-3">
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="flex w-full items-center justify-center rounded-2xl bg-[#21170f] py-3.5 text-sm font-semibold text-white shadow-md hover:bg-[var(--accent)] transition-all duration-200"
                  >
                    登录账号
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setOpen(false)}
                    className="flex w-full items-center justify-center rounded-2xl border border-[var(--line)] bg-[#fffaf2]/50 py-3.5 text-sm font-semibold text-[var(--ink)] hover:bg-[#fffaf2]/90 transition-all duration-200"
                  >
                    注册新账号
                  </Link>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
