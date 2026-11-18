import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type AdminPaginationProps = {
  basePath: string;
  currentPage: number;
  extraParams?: Record<string, string>;
  totalPages: number;
};

function buildUrl(basePath: string, page: number, extra?: Record<string, string>) {
  const params = new URLSearchParams({ page: String(page), ...extra });
  return `${basePath}?${params.toString()}`;
}

export function AdminPagination({
  basePath,
  currentPage,
  extraParams,
  totalPages,
}: AdminPaginationProps) {
  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - 2 && i <= currentPage + 2)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  return (
    <nav
      aria-label="列表分页"
      className="-mx-2 flex max-w-full items-center justify-start gap-1.5 overflow-x-auto px-2 pt-2 [scrollbar-width:none] sm:mx-0 sm:justify-center sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {currentPage > 1 ? (
        <Link
          href={buildUrl(basePath, currentPage - 1, extraParams)}
          aria-label="上一页"
          className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--admin-line)] bg-white text-[var(--ink-soft)] transition-colors hover:border-[#c85a32]/40 hover:text-[#c85a32]"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--admin-line)]/50 bg-white/40 text-[var(--ink-soft)]/35"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </span>
      )}

      {pages.map((p, i) =>
        p === "..." ? (
          <span
            key={`dots-${i}`}
            className="inline-flex size-9 items-center justify-center text-xs font-medium text-[var(--ink-soft)]"
          >
            …
          </span>
        ) : (
          <Link
            key={p}
            href={buildUrl(basePath, p, extraParams)}
            aria-current={p === currentPage ? "page" : undefined}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-xl text-xs font-medium tabular-nums transition-colors sm:text-sm",
              p === currentPage
                ? "border border-[#231810] bg-[#231810] text-[#fcf9f4] shadow-xs"
                : "border border-[var(--admin-line)] bg-white text-[var(--ink-soft)] hover:border-[#c85a32]/40 hover:text-[#c85a32]",
            )}
          >
            {p}
          </Link>
        ),
      )}

      {currentPage < totalPages ? (
        <Link
          href={buildUrl(basePath, currentPage + 1, extraParams)}
          aria-label="下一页"
          className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--admin-line)] bg-white text-[var(--ink-soft)] transition-colors hover:border-[#c85a32]/40 hover:text-[#c85a32]"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--admin-line)]/50 bg-white/40 text-[var(--ink-soft)]/35"
        >
          <ChevronRight className="size-4" aria-hidden />
        </span>
      )}
    </nav>
  );
}
