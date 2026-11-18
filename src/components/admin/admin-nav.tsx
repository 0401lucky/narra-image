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
  accent: "bg-[#c25934]/14 text-[#b54722] ring-1 ring-[#c25934]/20",
  danger: "bg-rose-500/14 text-rose-700 ring-1 ring-rose-500/20",
  warning: "bg-amber-500/16 text-amber-800 ring-1 ring-amber-600/20",
} as const;

const badgeDotStyles = {
  accent: "bg-[#c25934]",
  danger: "bg-rose-500",
  warning: "bg-amber-500",
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
            <div className="px-2.5 pb-1 text-[10px] font-semibold tracking-[0.14em] text-[#8c827a] uppercase">
              {group.label}
            </div>
          ) : (
            <div className="mx-auto my-1 h-px w-6 bg-[#dfd7c8]" aria-hidden />
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
                  "group admin-nav-link w-full",
                  collapsed ? "justify-center px-0 py-2.5" : "justify-between",
                  isActive && "admin-nav-link-active",
                )}
              >
                {isActive ? (
                  <motion.div
                    layoutId={`admin-nav-pill-${layoutNamespace}`}
                    transition={{ damping: 32, stiffness: 380, type: "spring" }}
                    className="absolute inset-0 rounded-xl border border-[#c25934]/20 bg-[#f9e6df] shadow-[0_1px_2px_rgba(194,89,52,0.06),inset_0_1px_0_rgba(255,255,255,0.75)]"
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
                      isActive
                        ? "text-[#c25934]"
                        : "text-[#787068] group-hover:text-[#292524]",
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
                        badgeDotStyles[tone],
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
