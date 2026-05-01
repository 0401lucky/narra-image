import Link from "next/link";

import { AuthCover } from "@/components/marketing/auth-cover";

type AuthShellProps = {
  children: React.ReactNode;
  cover: {
    authorName: string;
    image: string;
    title: string;
  } | null;
  coverCaption?: string;
  description: React.ReactNode;
  eyebrow: string;
  footnote?: React.ReactNode;
  title: string;
};

export function AuthShell({
  children,
  cover,
  coverCaption,
  description,
  eyebrow,
  footnote,
  title,
}: AuthShellProps) {
  return (
    <main className="auth-page relative min-h-svh overflow-hidden">
      <span aria-hidden className="auth-blob auth-blob--rose" />
      <span aria-hidden className="auth-blob auth-blob--amber" />
      <span aria-hidden className="auth-blob auth-blob--sky" />
      <span aria-hidden className="auth-blob auth-blob--violet" />

      <Link
        href="/"
        className="absolute left-5 top-5 z-20 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-4 py-2 text-[11px] uppercase tracking-[0.32em] text-[var(--ink-soft)] backdrop-blur-md transition hover:text-[var(--ink)] md:left-8 md:top-8"
      >
        <span className="size-1.5 rounded-full bg-[var(--accent)]" />
        Narra Image
      </Link>

      <div className="relative z-10 flex min-h-svh items-center justify-center px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="auth-card relative grid w-full max-w-[58rem] overflow-hidden lg:min-h-[39rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <AuthCover work={cover} caption={coverCaption} placement="left" />

          <section className="flex flex-col gap-6 px-6 py-7 sm:px-10 sm:py-9">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)]/70 text-[var(--accent)]">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 17l5-7 4 5 3-4 4 6" />
                  <rect x="3" y="3" width="18" height="18" rx="3.5" />
                </svg>
              </span>
              <div className="flex flex-col leading-tight">
                <span className="editorial-title text-xl font-semibold text-[var(--ink)]">
                  Narra Image
                </span>
                <span className="text-[10px] uppercase tracking-[0.32em] text-[var(--ink-soft)]">
                  Control Center
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="auth-eyebrow">{eyebrow}</span>
              <h1 className="editorial-title text-[2.1rem] font-semibold leading-tight tracking-[-0.04em] text-[var(--ink)] sm:text-[2.5rem]">
                {title}
              </h1>
              <p className="text-sm leading-6 text-[var(--ink-soft)]">
                {description}
              </p>
            </div>

            <div className="flex-1">{children}</div>

            {footnote ? (
              <p className="text-center text-xs leading-6 text-[var(--ink-soft)]">
                {footnote}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
