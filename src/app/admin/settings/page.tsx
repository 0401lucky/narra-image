import Link from "next/link";
import { redirect } from "next/navigation";
import { Cog, ImageIcon, KeyRound, Server, ShieldCheck } from "lucide-react";

import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "系统设置 — Narra Image",
};

const cards = [
  {
    href: "/admin/settings/oauth",
    icon: KeyRound,
    title: "登录源",
    description: "配置第三方 OAuth 登录源，用户可使用第三方账号快捷登录。",
  },
  {
    href: "/admin/settings/turnstile",
    icon: ShieldCheck,
    title: "人机验证",
    description: "Cloudflare Turnstile 配置；防止登录、注册、邀请码兑换被脚本批量调用。",
  },
  {
    href: "/admin/settings/channels",
    icon: Server,
    title: "生图渠道",
    description: "管理 OpenAI / Grok / 中转等生图 API 渠道，支持多渠道并存与切换。",
  },
  {
    href: "/admin/settings/login-cover",
    icon: ImageIcon,
    title: "登录封面",
    description: "配置登录/注册页面左侧展示的封面图片，支持精选随机或指定图片。",
  },
];

export default async function AdminSettingsPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-2">
          <div>
            <p className="admin-eyebrow">Settings</p>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              <Cog className="mr-2 inline-block size-7 text-[var(--ink-soft)]" />
              系统设置
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              低频但关键的系统级配置都收纳在这里。
            </p>
          </div>
        </div>

        <SettingsSubNav currentPath="/admin/settings" />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="studio-card group flex flex-col gap-3 rounded-[1.8rem] p-6 transition hover:border-[var(--accent)] hover:shadow-md"
              >
                <div className="flex size-11 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
                  <Icon className="size-5" />
                </div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">{card.title}</h2>
                <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
                  {card.description}
                </p>
                <span className="mt-auto pt-2 text-xs font-medium text-[var(--accent)] opacity-80 group-hover:opacity-100">
                  前往配置 →
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
