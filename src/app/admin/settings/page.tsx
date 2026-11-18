import {
  ArrowRight,
  Cog,
  HardDrive,
  ImageIcon,
  KeyRound,
  Server,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { formatStorageBytes } from "@/components/admin/storage/utils";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { getAllOAuthProviders } from "@/lib/auth/oauth-config";
import { getTurnstileConfig } from "@/lib/auth/turnstile";
import { getModerationConfigMeta } from "@/lib/moderation/config";
import { getChannelsForAdmin } from "@/lib/providers/built-in-provider";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getLoginCoverConfig } from "@/lib/server/login-cover";
import { getStorageManagementOverview } from "@/lib/storage/image-management";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "系统设置 — Narra Image",
};

type StatusTone = "active" | "warning" | "neutral";

export default async function AdminSettingsPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const [
    storageOverview,
    oauthProviders,
    turnstileCfg,
    channels,
    loginCoverCfg,
    moderationCfg,
  ] = await Promise.all([
    getStorageManagementOverview().catch(() => null),
    getAllOAuthProviders().catch(() => []),
    getTurnstileConfig().catch(() => null),
    getChannelsForAdmin().catch(() => []),
    getLoginCoverConfig().catch(() => ({ customUrl: null, mode: "featured" as const })),
    getModerationConfigMeta().catch(() => null),
  ]);

  const activeChannels = channels.filter((c) => c.isActive).length;
  const enabledOauth = oauthProviders.filter((p) => p.isEnabled).length;
  const turnstileUsable = Boolean(
    turnstileCfg?.isEnabled &&
      turnstileCfg.siteKey &&
      turnstileCfg.secretEncrypted,
  );
  const storageRatio = storageOverview
    ? Math.round(
        ((Number(storageOverview.usedBytes) || 0) /
          Math.max(1, Number(storageOverview.policy.limitBytes) || 1)) *
          100,
      )
    : null;

  const cards: Array<{
    badge: string;
    badgeTone: StatusTone;
    description: string;
    href: string;
    icon: typeof HardDrive;
    title: string;
  }> = [
    {
      badge: storageOverview
        ? `已用 ${formatStorageBytes(storageOverview.usedBytes)} (${storageRatio}%)`
        : "待检查状态",
      badgeTone:
        storageRatio !== null && storageRatio >= 85
          ? "warning"
          : storageOverview?.policy.enabled
            ? "active"
            : "neutral",
      description:
        "查看受纳管图片用量，配置容量上限与保留期限，预览并安全清理可回收历史图片。",
      href: "/admin/settings/storage",
      icon: HardDrive,
      title: "图片存储与清理",
    },
    {
      badge:
        activeChannels > 0
          ? `${activeChannels} 个启用 / 共 ${channels.length} 个`
          : "0 个启用渠道",
      badgeTone: activeChannels > 0 ? "active" : "warning",
      description:
        "管理 OpenAI / Grok / 中转等生图与视频渠道，支持延迟测速、模型检索与优先级排序。",
      href: "/admin/settings/channels",
      icon: Server,
      title: "生图渠道管理",
    },
    {
      badge:
        enabledOauth > 0
          ? `已启用 ${enabledOauth} 个登录源`
          : oauthProviders.length > 0
            ? "已配置但未启用"
            : "尚未配置",
      badgeTone: enabledOauth > 0 ? "active" : "neutral",
      description:
        "配置 LinuxDo 等第三方 OAuth2 登录源，让用户免邀请码与密码快捷登录。",
      href: "/admin/settings/oauth",
      icon: KeyRound,
      title: "第三方登录源",
    },
    {
      badge: turnstileUsable ? "防护生效中" : "未启用",
      badgeTone: turnstileUsable ? "active" : "neutral",
      description:
        "配置 Cloudflare Turnstile 人机验证，防止登录、注册与公开邀请码领取被脚本刷取。",
      href: "/admin/settings/turnstile",
      icon: ShieldCheck,
      title: "人机验证防护",
    },
    {
      badge: loginCoverCfg.mode === "custom" ? "固定指定图片" : "随机公开精选",
      badgeTone: "active",
      description:
        "配置登录与注册页面左侧展示的品牌视觉封面，支持随机精选作品或指定固定图片。",
      href: "/admin/settings/login-cover",
      icon: ImageIcon,
      title: "登录封面图",
    },
    {
      badge: moderationCfg?.isEnabled
        ? `已开启${moderationCfg.aiEnabled ? " · 含 AI 审核" : " · 敏感词匹配"}`
        : "审核未开启",
      badgeTone: moderationCfg?.isEnabled ? "active" : "neutral",
      description:
        "配置敏感词与上游 AI 语义审核阈值，并检索内置分类敏感词库。",
      href: "/admin/settings/moderation",
      icon: ShieldAlert,
      title: "内容审核规则",
    },
  ];

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Settings"
          icon={Cog}
          title="系统设置总览"
          description="一站式检视所有底层基础设施、鉴权安全与内容治理模块的实时启用状态。"
        />

        <SettingsSubNav currentPath="/admin/settings" />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="studio-card admin-card-interactive group flex flex-col justify-between gap-4 p-5 md:p-6"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="admin-metric-icon">
                      <Icon className="size-4.5" aria-hidden />
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        card.badgeTone === "active" &&
                          "bg-emerald-100 text-emerald-800",
                        card.badgeTone === "warning" &&
                          "bg-amber-100 text-amber-800",
                        card.badgeTone === "neutral" &&
                          "bg-[#efe8dc] text-[var(--ink-soft)]",
                      )}
                    >
                      {card.badge}
                    </span>
                  </div>

                  <h2 className="mt-4 text-base font-semibold text-[var(--ink)] sm:text-lg">
                    {card.title}
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-soft)] sm:text-sm">
                    {card.description}
                  </p>
                </div>

                <div className="flex items-center gap-1 border-t border-[var(--line)]/60 pt-3 text-xs font-semibold text-[#b54722]">
                  <span>进入模块配置</span>
                  <ArrowRight
                    className="size-3.5 transition-transform group-hover:translate-x-1"
                    aria-hidden
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
