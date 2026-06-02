"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgePercent,
  BookOpenText,
  ClipboardList,
  Gift,
  ImageIcon,
  KeyRound,
  LayoutDashboard,
  Settings,
  Ticket,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

const adminLinks = [
  { href: "/admin", icon: LayoutDashboard, label: "概览" },
  { href: "/admin/users", icon: Users, label: "用户" },
  { href: "/admin/invites", icon: Ticket, label: "邀请码" },
  { href: "/admin/redeem-codes", icon: BadgePercent, label: "兑换码" },
  { href: "/admin/generations", icon: ClipboardList, label: "生成记录" },
  { href: "/admin/works", icon: ImageIcon, label: "作品审核" },
  { href: "/admin/prompts", icon: BookOpenText, label: "提示词库" },
  { href: "/admin/benefits", icon: Gift, label: "福利" },
  { href: "/admin/settings", icon: Settings, label: "系统设置" },
  { href: "/admin/api", icon: KeyRound, label: "API" },
];

export function AdminNav({
  currentPath,
  onItemClick,
  className,
}: {
  currentPath?: string;
  onItemClick?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const activePath = currentPath ?? pathname;

  return (
    <nav className={cn("admin-nav flex flex-col gap-1.5", className)}>
      {adminLinks.map((link) => {
        const Icon = link.icon;
        const isActive =
          activePath === link.href ||
          (link.href !== "/admin" && activePath.startsWith(`${link.href}/`));

        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onItemClick}
            className={cn("admin-nav-link w-full", isActive && "admin-nav-link-active")}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className={cn("size-4 transition-transform duration-200", isActive && "scale-110 text-[#d87b37]")} />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
