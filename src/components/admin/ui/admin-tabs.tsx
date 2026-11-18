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
  tone?: "dark" | "accent" | "surface";
  value: T;
};

export function AdminTabs<T extends string = string>({
  ariaLabel,
  className,
  disabled = false,
  layoutId,
  onChange,
  options,
  tone = "surface",
  value,
}: AdminTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#e5dec9] bg-[#efeae2]/85 p-1",
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
                ? tone === "accent"
                  ? "font-semibold text-[#c25934]"
                  : "font-semibold text-[#292524]"
                : "text-[#787068] hover:text-[#292524]",
            )}
          >
            {active ? (
              <motion.div
                layoutId={layoutId}
                transition={{ damping: 32, stiffness: 380, type: "spring" }}
                className={cn(
                  "absolute inset-0 rounded-lg bg-white shadow-[0_1px_3px_rgba(41,37,36,0.08),0_1px_1px_rgba(41,37,36,0.04)]",
                  tone === "accent"
                    ? "border border-[#c25934]/25"
                    : "border border-[#e5dec9]/90",
                )}
              />
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon ? (
                <Icon
                  className={cn(
                    "size-3.5 transition-colors",
                    active ? "text-[#c25934]" : "text-[#8c827a]",
                  )}
                  aria-hidden
                />
              ) : null}
              <span>{option.label}</span>
              {option.badge !== undefined ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[11px] font-semibold tabular-nums",
                    active
                      ? "bg-[#f9e6df] text-[#c25934]"
                      : "bg-black/6 text-[#787068]",
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
        "flex flex-wrap items-center gap-1 rounded-xl border border-[#e5dec9] bg-[#efeae2]/85 p-1",
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
                ? "font-semibold text-[#292524]"
                : "text-[#787068] hover:text-[#292524]",
            )}
          >
            {active ? (
              <motion.div
                layoutId={layoutId}
                transition={{ damping: 32, stiffness: 380, type: "spring" }}
                className="absolute inset-0 rounded-lg border border-[#e5dec9]/90 bg-white shadow-[0_1px_3px_rgba(41,37,36,0.08),0_1px_1px_rgba(41,37,36,0.04)]"
              />
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon ? (
                <Icon
                  className={cn(
                    "size-3.5 transition-colors",
                    active ? "text-[#c25934]" : "text-[#8c827a]",
                  )}
                  aria-hidden
                />
              ) : null}
              <span>{item.label}</span>
              {item.badge !== undefined ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[11px] font-semibold tabular-nums",
                    active
                      ? "bg-[#f9e6df] text-[#c25934]"
                      : "bg-black/6 text-[#787068]",
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
