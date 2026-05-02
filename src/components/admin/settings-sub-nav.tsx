import Link from "next/link";

import { cn } from "@/lib/utils";

const settingsLinks = [
  { href: "/admin/settings", label: "总览" },
  { href: "/admin/settings/oauth", label: "登录源" },
  { href: "/admin/settings/turnstile", label: "人机验证" },
  { href: "/admin/settings/channels", label: "生图渠道" },
];

export function SettingsSubNav({ currentPath }: { currentPath: string }) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-[var(--line)] pb-3">
      {settingsLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-xs transition",
            currentPath === link.href
              ? "bg-[var(--accent)]/10 text-[var(--accent)]"
              : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}