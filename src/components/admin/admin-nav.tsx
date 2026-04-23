import Link from "next/link";

import { cn } from "@/lib/utils";

const adminLinks = [
  { href: "/admin", label: "概览" },
  { href: "/admin/benefits", label: "福利" },
  { href: "/admin/invites", label: "邀请码" },
  { href: "/admin/users", label: "用户" },
  { href: "/admin/works", label: "作品审核" },
  { href: "/admin/generations", label: "生成记录" },
];

export function AdminNav({ currentPath }: { currentPath: string }) {
  return (
    <nav className="flex flex-wrap gap-2">
      {adminLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "rounded-full px-4 py-2 text-sm transition",
            currentPath === link.href
              ? "bg-[var(--ink)] text-white"
              : "ring-link text-[var(--ink-soft)]",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
