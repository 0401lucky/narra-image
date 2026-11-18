"use client";

/* eslint-disable @next/next/no-img-element */
import {
  ChevronRight,
  Home,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  WandSparkles,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { LogoutButton } from "@/components/auth/logout-button";
import { getThumbUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";
import { AdminNav } from "./admin-nav";
import {
  resolveAdminBreadcrumb,
  type AdminBadgeKey,
} from "./constants";
import { AdminCommandPalette } from "./ui/admin-command-palette";
import { AdminToastProvider } from "./ui/admin-toast-provider";

export type AdminShellSummary = {
  badges?: Partial<Record<AdminBadgeKey, number>>;
  statusHref?: string;
  statusLabel: string;
  statusTone: "healthy" | "attention" | "degraded";
};

type AdminFrameProps = {
  children: React.ReactNode;
  currentUser: {
    avatarUrl?: string | null;
    id: string;
    nickname?: string | null;
  };
  shellSummary?: AdminShellSummary;
};

const SIDEBAR_STORAGE_KEY = "narra_admin_sidebar_collapsed";

export function AdminFrame({
  children,
  currentUser,
  shellSummary,
}: AdminFrameProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved === "1") {
        setIsCollapsed(true);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileMenuOpen]);

  function toggleCollapsed() {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  const displayName = currentUser.nickname?.trim() || "管理员";
  const shortId = currentUser.id.slice(0, 8);
  const breadcrumb = resolveAdminBreadcrumb(pathname);
  const statusTone = shellSummary?.statusTone ?? "healthy";
  const statusLabel = shellSummary?.statusLabel ?? "系统就绪";
  const badges = shellSummary?.badges;

  const statusDotClass =
    statusTone === "degraded"
      ? "bg-rose-500"
      : statusTone === "attention"
        ? "bg-amber-500 animate-pulse"
        : "bg-emerald-500";

  return (
    <AdminToastProvider>
      <div className="admin-console flex min-h-screen text-[var(--ink)]">
        {/* 1. Desktop Collapsible Sidebar */}
        <aside
          className={cn(
            "admin-sidebar-panel hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:flex-col lg:border-r lg:border-[#e5dec9] lg:py-4 transition-[width,padding] duration-200 ease-out",
            isCollapsed ? "lg:w-[4.5rem] lg:px-2.5" : "lg:w-64 lg:px-3.5",
          )}
        >
          <div
            className={cn(
              "flex items-center border-b border-[#e5dec9]/90 pb-3.5",
              isCollapsed ? "justify-center" : "justify-between gap-2 px-1",
            )}
          >
            {!isCollapsed ? (
              <Link
                href="/admin"
                prefetch={false}
                className="min-w-0 text-[#292524]"
                aria-label="Narra Image 管理后台"
              >
                <span className="editorial-title block text-2xl leading-none font-semibold">
                  <span className="text-[#c25934]">NARRA</span>{" "}
                  <span>Studio</span>
                </span>
                <span className="mt-1 block text-[10px] tracking-[0.2em] text-[#8c827a] uppercase">
                  Operations Console
                </span>
              </Link>
            ) : null}

            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
              title={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#e5dec9] bg-white/65 text-[#6e655e] shadow-2xs transition hover:border-[#c25934]/35 hover:bg-white hover:text-[#292524]"
            >
              {isCollapsed ? (
                <PanelLeftOpen className="size-4" aria-hidden />
              ) : (
                <PanelLeftClose className="size-4" aria-hidden />
              )}
            </button>
          </div>

          {/* Command Palette Trigger */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setIsPaletteOpen(true)}
              aria-label="打开快捷跳转面板"
              title="快捷跳转 (Ctrl/⌘ + K)"
              className={cn(
                "flex w-full items-center rounded-xl border border-[#e5dec9] bg-white/75 text-xs text-[#6e655e] shadow-[0_1px_2px_rgba(41,37,36,0.03)] transition hover:border-[#c25934]/35 hover:bg-white hover:text-[#292524]",
                isCollapsed
                  ? "justify-center py-2.5"
                  : "justify-between px-3 py-2",
              )}
            >
              <span className="flex items-center gap-2">
                <Search className="size-3.5 text-[#c25934]" aria-hidden />
                {!isCollapsed ? <span>搜索功能模块…</span> : null}
              </span>
              {!isCollapsed ? (
                <kbd className="rounded border border-[#e5dec9] bg-[#f4efe7] px-1.5 py-0.5 font-mono text-[10px] text-[#8c827a]">
                  ⌘K
                </kbd>
              ) : null}
            </button>
          </div>

          <div className="premium-scrollbar mt-3.5 flex-1 overflow-y-auto pr-0.5">
            <AdminNav
              collapsed={isCollapsed}
              badges={badges}
              layoutNamespace="desktop"
            />
          </div>

          <div className="mt-3 border-t border-[#e5dec9]/90 pt-3">
            {isCollapsed ? (
              <div
                className="mx-auto grid size-9 place-items-center overflow-hidden rounded-full border border-[#e5dec9] bg-[#f9e6df] text-xs font-semibold text-[#c25934]"
                title={`${displayName} · ID ${shortId}`}
              >
                {currentUser.avatarUrl ? (
                  <img
                    src={getThumbUrl(currentUser.avatarUrl, 64)}
                    alt="管理员头像"
                    className="size-full object-cover"
                  />
                ) : (
                  displayName[0]
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-[#e5dec9] bg-white/65 p-2.5 shadow-[0_1px_2px_rgba(41,37,36,0.03)]">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-[#e5dec9] bg-[#f9e6df] text-xs font-semibold text-[#c25934]">
                    {currentUser.avatarUrl ? (
                      <img
                        src={getThumbUrl(currentUser.avatarUrl, 64)}
                        alt="管理员头像"
                        className="size-full object-cover"
                      />
                    ) : (
                      displayName[0]
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-[#292524]">
                      {displayName}
                    </div>
                    <div className="truncate font-mono text-[10px] text-[#8c827a]">
                      ID {shortId}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* 2. Mobile Slide-out Drawer (Portal to body) */}
        {mounted && isMobileMenuOpen
          ? createPortal(
              <div className="fixed inset-0 z-[95] lg:hidden">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.18 }}
                  className="fixed inset-0 bg-[#292524]/30 backdrop-blur-xs"
                  onClick={() => setIsMobileMenuOpen(false)}
                />
                <motion.div
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  transition={{ damping: 28, stiffness: 260, type: "spring" }}
                  role="dialog"
                  aria-modal="true"
                  aria-label="后台导航抽屉"
                  className="admin-sidebar-panel fixed inset-y-0 left-0 z-[96] flex w-72 flex-col rounded-r-2xl border-r border-[#e5dec9] p-4 shadow-[0_24px_64px_rgba(41,37,36,0.18)] outline-none"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-[#e5dec9]/90 pb-3.5">
                    <Link
                      href="/admin"
                      prefetch={false}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="min-w-0 text-[#292524]"
                      aria-label="Narra Image 管理后台"
                    >
                      <span className="editorial-title block text-2xl font-semibold">
                        <span className="text-[#c25934]">NARRA</span>{" "}
                        <span>Studio</span>
                      </span>
                      <span className="mt-0.5 block text-[10px] tracking-[0.18em] text-[#8c827a] uppercase">
                        Operations Console
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#e5dec9] bg-white/65 text-[#6e655e] transition hover:bg-white hover:text-[#292524]"
                      aria-label="关闭菜单"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>

                  <div className="premium-scrollbar mt-3.5 flex-1 overflow-y-auto">
                    <AdminNav
                      badges={badges}
                      layoutNamespace="mobile"
                      onItemClick={() => setIsMobileMenuOpen(false)}
                    />
                  </div>

                  <div className="mt-3 space-y-3 border-t border-[#e5dec9]/90 pt-3">
                    <div className="flex items-center justify-between text-xs text-[#8c827a]">
                      <span className="flex items-center gap-1.5 font-medium text-[#292524]">
                        <span className={cn("size-2 rounded-full", statusDotClass)} aria-hidden />
                        {statusLabel}
                      </span>
                      <Link
                        href="/"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="text-[#6e655e] transition hover:text-[#c25934] hover:underline"
                      >
                        返回主页
                      </Link>
                    </div>
                    <div className="flex justify-center">
                      <LogoutButton />
                    </div>
                  </div>
                </motion.div>
              </div>,
              document.body,
            )
          : null}

        {/* 3. Main Workspace Area */}
        <div
          className={cn(
            "flex min-h-screen min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-out",
            isCollapsed ? "lg:pl-[4.5rem]" : "lg:pl-64",
          )}
        >
          {/* Sticky Topbar (Breadcrumb + Global Quick Actions; NO duplicate h1) */}
          <header className="admin-topbar sticky top-0 z-30 flex items-center justify-between gap-4 px-4 py-2.5 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
                className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--admin-line)] bg-white/85 text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32] lg:hidden"
                aria-label="打开导航菜单"
              >
                <Menu className="size-4.5" aria-hidden />
              </button>

              <nav aria-label="面包屑导航" className="min-w-0">
                <ol className="flex flex-wrap items-center gap-1 text-xs text-[var(--ink-soft)]">
                  <li className="hidden font-mono text-[10px] tracking-wider text-[var(--ink-soft)]/70 uppercase sm:inline">
                    ADMIN
                  </li>
                  {breadcrumb.items.map((crumb, index) => {
                    const isLast = index === breadcrumb.items.length - 1;
                    return (
                      <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
                        <ChevronRight
                          className={cn(
                            "size-3.5 shrink-0 text-[var(--ink-soft)]/45",
                            index === 0 && "hidden sm:inline",
                          )}
                          aria-hidden
                        />
                        {crumb.href && !isLast ? (
                          <Link
                            href={crumb.href}
                            className="truncate transition hover:text-[#c85a32]"
                          >
                            {crumb.label}
                          </Link>
                        ) : (
                          <span
                            className={cn(
                              "truncate",
                              isLast && "font-semibold text-[var(--ink)]",
                            )}
                          >
                            {crumb.label}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => setIsPaletteOpen(true)}
                aria-label="快捷跳转搜索"
                className="admin-topbar-link text-xs font-medium lg:hidden"
              >
                <Search className="size-3.5 text-[#c85a32]" aria-hidden />
                <span className="hidden sm:inline">跳转</span>
              </button>

              <Link
                href="/"
                prefetch={false}
                className="admin-topbar-link hidden text-xs font-medium md:inline-flex"
              >
                <Home className="size-3.5" aria-hidden />
                <span className="hidden xl:inline">返回主页</span>
              </Link>

              <Link
                href="/create"
                prefetch={false}
                className="admin-topbar-link text-xs font-medium"
              >
                <WandSparkles className="size-3.5 text-[#c85a32]" aria-hidden />
                <span className="hidden sm:inline">创作台</span>
              </Link>

              {shellSummary?.statusHref ? (
                <Link
                  href={shellSummary.statusHref}
                  data-tone={statusTone}
                  className="admin-topbar-status hidden text-xs font-medium lg:inline-flex"
                >
                  <span className={cn("size-2 shrink-0 rounded-full", statusDotClass)} aria-hidden />
                  <span>{statusLabel}</span>
                </Link>
              ) : (
                <span
                  data-tone={statusTone}
                  className="admin-topbar-status hidden text-xs font-medium lg:inline-flex"
                >
                  <span className={cn("size-2 shrink-0 rounded-full", statusDotClass)} aria-hidden />
                  <span>{statusLabel}</span>
                </span>
              )}

              <div className="admin-topbar-user hidden text-xs font-medium xl:inline-flex">
                <span className="grid size-6 place-items-center overflow-hidden rounded-full bg-[#f3e7d6]">
                  {currentUser.avatarUrl ? (
                    <img
                      src={getThumbUrl(currentUser.avatarUrl, 64)}
                      alt="管理员头像"
                      className="size-full object-cover"
                    />
                  ) : (
                    displayName[0]
                  )}
                </span>
                <span className="max-w-24 truncate">{displayName}</span>
              </div>

              <div className="hidden md:inline-flex">
                <LogoutButton />
              </div>
            </div>
          </header>

          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="admin-content w-full flex-1"
          >
            {children}
          </motion.div>
        </div>

        <AdminCommandPalette
          open={isPaletteOpen}
          onOpenChange={setIsPaletteOpen}
        />
      </div>
    </AdminToastProvider>
  );
}
