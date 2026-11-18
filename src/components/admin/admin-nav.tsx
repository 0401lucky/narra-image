"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import {
  ADMIN_NAV_GROUPS,
  isAdminNavItemActive,
  type AdminBadgeKey,
} from "./constants";

type AdminNavProps = {
  badges?: Partial<Record<AdminBadgeKey, number>>;
  className?: string;
  collapsed?: boolean;
  currentPath?: string;
  layoutNamespace?: string;
  onItemClick?: () => void;
};

const badgeToneStyles = {
  accent: "bg-[#d87b37] text-white",
  danger: "bg-rose-500 text-white",
  warning: "bg-amber-500 text-[#1c130c]",
} as const;

export function AdminNav({
  badges,
  className,
  collapsed = false,
  currentPath,
  layoutNamespace = "desktop",
  onItemClick,
}: AdminNavProps) {
  const pathname = usePathname();
  const activePath = currentPath ?? pathname;

  return (
    <nav
      aria-label="后台主导航"
      className={cn("admin-nav flex flex-col gap-4", className)}
    >
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          {!collapsed ? (
            <div className="px-2.5 pb-1 text-[10px] font-semibold tracking-[0.14em] text-white/38 uppercase">
              {group.label}
            </div>
          ) : (
            <div className="mx-auto my-1 h-px w-6 bg-white/10" aria-hidden />
          )}

          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive = isAdminNavItemActive(item, activePath);
            const rawBadge = item.badgeKey ? (badges?.[item.badgeKey] ?? 0) : 0;
            const tone = item.badgeTone ?? "accent";

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onItemClick}
                title={collapsed ? `${item.label}${rawBadge > 0 ? ` (${rawBadge})` : ""}` : undefined}
                aria-label={collapsed ? item.label : undefined}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "admin-nav-link w-full",
                  collapsed ? "justify-center px-0 py-2.5" : "justify-between",
                  isActive && "admin-nav-link-active",
                )}
              >
                {isActive ? (
                  <motion.div
                    layoutId={`admin-nav-pill-${layoutNamespace}`}
                    transition={{ damping: 32, stiffness: 380, type: "spring" }}
                    className="absolute inset-0 rounded-xl border border-[#d87b37]/35 bg-gradient-to-r from-[#d87b37]/24 to-[#d87b37]/8 shadow-[inset_3px_0_0_#d87b37]"
                  />
                ) : null}

                <span
                  className={cn(
                    "relative z-10 flex min-w-0 items-center gap-2.5",
                    collapsed && "justify-center",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      isActive ? "text-[#f09a59]" : "text-white/65",
                    )}
                    aria-hidden
                  />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </span>

                {rawBadge > 0 ? (
                  collapsed ? (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-1.5 right-2 z-10 size-2 rounded-full",
                        badgeToneStyles[tone],
                      )}
                    />
                  ) : (
                    <span
                      className={cn(
                        "relative z-10 rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums",
                        badgeToneStyles[tone],
                      )}
                    >
                      {rawBadge > 99 ? "99+" : rawBadge}
                    </span>
                  )
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
