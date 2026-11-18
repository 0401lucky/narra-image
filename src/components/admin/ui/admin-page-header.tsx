import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AdminPageHeaderProps = {
  actions?: ReactNode;
  badges?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow: string;
  icon?: LucideIcon;
  title: string;
};

export function AdminPageHeader({
  actions,
  badges,
  className,
  description,
  eyebrow,
  icon: Icon,
  title,
}: AdminPageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b border-[var(--admin-line)] pb-5 xl:flex-row xl:items-end xl:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="admin-eyebrow">{eyebrow}</span>
          {badges}
        </div>
        <h1 className="mt-2.5 flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-[var(--ink)] md:text-3xl">
          {Icon ? <Icon className="size-6 shrink-0 text-[#b54722]" aria-hidden /> : null}
          <span>{title}</span>
        </h1>
        {description ? (
          <div className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[var(--ink-soft)]">
            {description}
          </div>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
