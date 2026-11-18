"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type AdminTabOption<T extends string = string> = {
  badge?: number | string;
  icon?: LucideIcon;
  label: string;
  value: T;
};

type AdminTabsProps<T extends string = string> = {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  layoutId: string;
  onChange: (value: T) => void;
  options: AdminTabOption<T>[];
  tone?: "dark" | "accent";
  value: T;
};

export function AdminTabs<T extends string = string>({
  ariaLabel,
  className,
  disabled = false,
  layoutId,
  onChange,
  options,
  tone = "dark",
  value,
}: AdminTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-xl border border-[var(--admin-line)] bg-[#efe8dc]/70 p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm disabled:cursor-not-allowed disabled:opacity-55",
              active
                ? tone === "dark"
                  ? "text-white"
                  : "text-[#9e5322]"
                : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
            )}
          >
            {active ? (
              <motion.div
                layoutId={layoutId}
                transition={{ damping: 32, stiffness: 380, type: "spring" }}
                className={cn(
                  "absolute inset-0 rounded-lg shadow-xs",
                  tone === "dark"
                    ? "bg-[#231810]"
                    : "border border-[#c85a32]/25 bg-white",
                )}
              />
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
              <span>{option.label}</span>
              {option.badge !== undefined ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[11px] font-semibold tabular-nums",
                    active
                      ? tone === "dark"
                        ? "bg-white/18 text-white"
                        : "bg-[#c85a32]/12 text-[#9e5322]"
                      : "bg-black/6 text-[var(--ink-soft)]",
                  )}
                >
                  {option.badge}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export type AdminLinkTabItem = {
  badge?: number | string;
  href: string;
  icon?: LucideIcon;
  label: string;
};

type AdminLinkTabsProps = {
  activeHref: string;
  ariaLabel?: string;
  className?: string;
  items: AdminLinkTabItem[];
  layoutId: string;
};

export function AdminLinkTabs({
  activeHref,
  ariaLabel,
  className,
  items,
  layoutId,
}: AdminLinkTabsProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-xl border border-[var(--admin-line)] bg-[#efe8dc]/65 p-1",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.href === activeHref;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors sm:text-sm",
              active
                ? "text-white"
                : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
            )}
          >
            {active ? (
              <motion.div
                layoutId={layoutId}
                transition={{ damping: 32, stiffness: 380, type: "spring" }}
                className="absolute inset-0 rounded-lg bg-[#231810] shadow-xs"
              />
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
              <span>{item.label}</span>
              {item.badge !== undefined ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[11px] font-semibold tabular-nums",
                    active
                      ? "bg-white/20 text-white"
                      : "bg-black/6 text-[var(--ink-soft)]",
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
