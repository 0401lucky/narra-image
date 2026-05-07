/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { Bell, Home, WandSparkles } from "lucide-react";

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
  const displayName = currentUser.nickname?.trim() || "管理员";
  const shortId = currentUser.id.slice(0, 8);

  return (
    <div className="admin-console min-h-screen">
      <aside className="admin-sidebar-panel border-b border-white/10 px-4 py-4 lg:fixed lg:inset-y-4 lg:left-4 lg:z-40 lg:flex lg:w-64 lg:flex-col lg:rounded-2xl lg:border">
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
            <span className="mt-1 block text-[11px] uppercase text-white/42">
              admin console
            </span>
          </Link>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-sm text-[#d87b37]">
            +
          </span>
        </div>

        <div className="mt-4 lg:min-h-0 lg:flex-1">
          <AdminNav />
        </div>

        <div className="mt-4 hidden rounded-xl border border-white/10 bg-white/[0.04] p-3 lg:block">
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
              <div className="truncate text-xs text-white/46">ID {shortId}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 lg:pl-[18rem]">
        <header className="admin-topbar mx-auto flex max-w-[96rem] flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase text-[var(--ink-soft)]">
              Narra Image 管理中枢
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              审核、积分、渠道和系统配置都在这里处理。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link href="/" prefetch={false} className="admin-topbar-link">
              <Home className="size-4" />
              返回主页
            </Link>
            <Link href="/create" prefetch={false} className="admin-topbar-link">
              <WandSparkles className="size-4" />
              创作台
            </Link>
            <span className="admin-topbar-status">
              <Bell className="size-4" />
              系统正常
            </span>
            <div className="admin-topbar-user">
              <span className="grid size-8 place-items-center overflow-hidden rounded-full bg-[#f5eadb] text-xs font-semibold text-[var(--ink)]">
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
              <span className="max-w-28 truncate text-sm font-semibold">
                {displayName}
              </span>
            </div>
            <LogoutButton />
          </div>
        </header>

        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}
