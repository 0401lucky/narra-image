import Link from "next/link";

import { cn } from "@/lib/utils";

const adminLinks = [
  { href: "/admin", label: "概览" },
  { href: "/admin/benefits", label: "福利" },
  { href: "/admin/invites", label: "邀请码" },
  { href: "/admin/redeem-codes", label: "兑换码" },
  { href: "/admin/users", label: "用户" },
  { href: "/admin/works", label: "作品审核" },
  { href: "/admin/generations", label: "生成记录" },
  { href: "/admin/api", label: "API 管理" },
  { href: "/admin/settings", label: "系统设置" },
];

export function AdminNav({ currentPath }: { currentPath: string }) {
  return (
    <nav className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
      {adminLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "shrink-0 rounded-full px-3.5 py-2 text-sm transition md:px-4",
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
