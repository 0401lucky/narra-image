import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
    <nav className="-mx-2 flex max-w-full items-center justify-start gap-1.5 overflow-x-auto px-2 pt-2 [scrollbar-width:none] sm:mx-0 sm:justify-center sm:px-0 [&::-webkit-scrollbar]:hidden">
      {currentPage > 1 ? (
        <Link
          href={buildUrl(basePath, currentPage - 1, extraParams)}
          className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--admin-line)] text-[var(--ink-soft)] transition-all duration-200 hover:border-[#d87b37]/30 hover:bg-white/50 hover:text-[#d87b37] backdrop-blur-xs"
        >
          <ChevronLeft className="size-4" />
        </Link>
      ) : (
        <span className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--admin-line)]/40 text-[var(--ink-soft)]/30 bg-white/10 backdrop-blur-xs">
          <ChevronLeft className="size-4" />
        </span>
      )}

      {pages.map((p, i) =>
        p === "..." ? (
          <span
            key={`dots-${i}`}
            className="inline-flex size-9 items-center justify-center text-xs text-[var(--ink-soft)] font-medium"
          >
            …
          </span>
        ) : (
          <Link
            key={p}
            href={buildUrl(basePath, p, extraParams)}
            className={`inline-flex size-9 items-center justify-center rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 ${
              p === currentPage
                ? "bg-[#2c1d11] text-[#fcf9f4] shadow-md shadow-[#2c1d11]/15 border border-[#2c1d11] backdrop-blur-xs"
                : "border border-[var(--admin-line)] text-[var(--ink-soft)] hover:border-[#d87b37]/30 hover:bg-white/50 hover:text-[#d87b37] backdrop-blur-xs"
            }`}
          >
            {p}
          </Link>
        ),
      )}

      {currentPage < totalPages ? (
        <Link
          href={buildUrl(basePath, currentPage + 1, extraParams)}
          className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--admin-line)] text-[var(--ink-soft)] transition-all duration-200 hover:border-[#d87b37]/30 hover:bg-white/50 hover:text-[#d87b37] backdrop-blur-xs"
        >
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--admin-line)]/40 text-[var(--ink-soft)]/30 bg-white/10 backdrop-blur-xs">
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
