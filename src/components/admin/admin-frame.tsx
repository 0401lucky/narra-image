"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Home, Menu, WandSparkles, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { LogoutButton } from "@/components/auth/logout-button";
import { AdminNav } from "@/components/admin/admin-nav";
import { getThumbUrl } from "@/lib/image-url";

type AdminFrameProps = {
  children: React.ReactNode;
  currentUser: {
    avatarUrl?: string | null;
    id: string;
    nickname?: string | null;
  };
};

export function AdminFrame({ children, currentUser }: AdminFrameProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const displayName = currentUser.nickname?.trim() || "管理员";
  const shortId = currentUser.id.slice(0, 8);

  // Resolve breadcrumbs dynamically
  let currentBreadcrumb = "Overview";
  let currentPageTitle = "管理中枢概览";

  if (pathname.startsWith("/admin/users")) {
    currentBreadcrumb = "Users";
    currentPageTitle = "用户池运营管理";
  } else if (pathname.startsWith("/admin/invites")) {
    currentBreadcrumb = "Invites";
    currentPageTitle = "注册准入邀请码";
  } else if (pathname.startsWith("/admin/redeem-codes")) {
    currentBreadcrumb = "Redeem Codes";
    currentPageTitle = "积分兑换码发行";
  } else if (pathname.startsWith("/admin/generations")) {
    currentBreadcrumb = "Generations";
    currentPageTitle = "任务生成记录流水";
  } else if (pathname.startsWith("/admin/works")) {
    currentBreadcrumb = "Works";
    currentPageTitle = "作品广场投稿审核";
  } else if (pathname.startsWith("/admin/benefits")) {
    currentBreadcrumb = "Benefits";
    currentPageTitle = "每日签到福利配置";
  } else if (pathname.startsWith("/admin/settings")) {
    currentBreadcrumb = "Settings";
    currentPageTitle = "底层运行参数配置";
  } else if (pathname.startsWith("/admin/api")) {
    currentBreadcrumb = "API";
    currentPageTitle = "自填渠道与密钥";
  }

  const handleCloseMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="admin-console min-h-screen text-[var(--ink)] flex">
      {/* 1. Desktop Sidebar (Permanent) */}
      <aside className="admin-sidebar-panel hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-4 lg:left-4 lg:z-40 lg:rounded-2xl lg:border lg:border-white/10 px-4 py-4">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
          <Link
            href="/admin"
            prefetch={false}
            className="min-w-0 text-white"
            aria-label="Narra Image 管理后台"
          >
            <span className="editorial-title block text-2xl font-semibold">
              <span className="text-[#d87b37]">NARRA</span>{" "}
              <span>Image</span>
            </span>
            <span className="mt-1 block text-[11px] uppercase text-white/40">
              admin console
            </span>
          </Link>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-sm text-[#d87b37] font-semibold">
            +
          </span>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto pr-1">
          <AdminNav />
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border border-white/15 bg-[#3a271a] text-sm font-semibold text-white">
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
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">
                {displayName}
              </div>
              <div className="truncate text-xs text-white/40">ID {shortId}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. Mobile Sidebar Slide-out Drawer */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            {/* Backdrop blur overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs"
              onClick={handleCloseMobileMenu}
            />
            {/* Slider Drawer Panel */}
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="admin-sidebar-panel fixed inset-y-4 left-4 z-50 flex w-72 flex-col rounded-2xl border border-white/10 p-4 shadow-2xl outline-none"
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <Link
                  href="/admin"
                  prefetch={false}
                  onClick={handleCloseMobileMenu}
                  className="min-w-0 text-white"
                  aria-label="Narra Image 管理后台"
                >
                  <span className="editorial-title block text-2xl font-semibold">
                    <span className="text-[#d87b37]">NARRA</span>{" "}
                    <span>Image</span>
                  </span>
                  <span className="mt-1 block text-[11px] uppercase text-white/40">
                    admin console
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={handleCloseMobileMenu}
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-sm text-white/70 hover:text-white transition-colors"
                  aria-label="关闭菜单"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-4 flex-1 overflow-y-auto premium-scrollbar">
                <AdminNav onItemClick={handleCloseMobileMenu} />
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-3">
                    <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border border-white/15 bg-[#3a271a] text-sm font-semibold text-white">
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
                      <div className="truncate text-sm font-semibold text-white">
                        {displayName}
                      </div>
                      <div className="truncate text-xs text-white/40 mt-0.5">ID {shortId}</div>
                    </div>
                  </div>

                  {/* Operational indicators in mobile card */}
                  <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-white/50">
                    <span className="flex items-center gap-1.5 font-medium text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      系统正常
                    </span>
                    <Link
                      href="/"
                      onClick={handleCloseMobileMenu}
                      className="hover:text-white transition hover:underline"
                    >
                      返回主页
                    </Link>
                  </div>
                </div>

                <div className="flex justify-center border-t border-white/5 pt-3">
                  <LogoutButton />
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* 3. Main Workspace Area */}
      <div className="flex-1 min-w-0 lg:pl-72 flex flex-col min-h-screen">
        {/* Sticky page header bar */}
        <header className="admin-topbar sticky top-0 z-30 flex items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8 border-b border-[var(--admin-line)]">
          <div className="flex items-center gap-3 min-w-0">
            {/* Hamburger menu for small devices */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--admin-line)] bg-white/70 text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent)] lg:hidden transition"
              aria-label="打开导航菜单"
            >
              <Menu className="size-5" />
            </button>

            {/* Editorial Breadcrumbs */}
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-[10px] sm:text-xs text-[var(--ink-soft)] uppercase tracking-wider">
                <span className="hidden sm:inline">ADMIN</span>
                <span className="opacity-40 hidden sm:inline">/</span>
                <span className="font-semibold text-[#a65f2c]">{currentBreadcrumb}</span>
              </div>
              <h1 className="mt-0.5 text-sm sm:text-base font-semibold truncate text-[var(--ink)]">
                {currentPageTitle}
              </h1>
            </div>
          </div>

          {/* Quick Actions Panel */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Link
              href="/"
              prefetch={false}
              className="admin-topbar-link hidden md:inline-flex text-xs font-semibold"
            >
              <Home className="size-3.5" />
              <span className="hidden lg:inline">返回主页</span>
            </Link>
            <Link
              href="/create"
              prefetch={false}
              className="admin-topbar-link text-xs font-semibold"
            >
              <WandSparkles className="size-3.5" />
              <span className="hidden md:inline">创作台</span>
            </Link>
            <span className="admin-topbar-status text-xs hidden lg:inline-flex font-medium">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              系统正常
            </span>
            <div className="admin-topbar-user hidden lg:inline-flex text-xs font-semibold">
              <span className="grid size-6 place-items-center overflow-hidden rounded-full bg-[#f5eadb]">
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
              <span className="max-w-24 truncate">
                {displayName}
              </span>
            </div>
            <div className="hidden md:inline-flex">
              <LogoutButton />
            </div>
          </div>
        </header>

        {/* Content body wrapper with subtle fade-in effect */}
        <div className="admin-content flex-1 w-full transition-all duration-200">
          {children}
        </div>
      </div>
    </div>
  );
}
