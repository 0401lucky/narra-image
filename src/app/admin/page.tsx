import { redirect } from "next/navigation";

import { ShowcaseStatus } from "@prisma/client";
import Link from "next/link";
import {
  BadgePercent,
  ClipboardList,
  ImageIcon,
  Ticket,
  Users,
} from "lucide-react";

import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const [userCount, inviteCount, redeemCodeCount, generationCount, featuredCount] =
    await Promise.all([
      db.user.count(),
      db.inviteCode.count(),
      db.redeemCode.count(),
      db.generationJob.count(),
      db.generationImage.count({
        where: {
          showcaseStatus: ShowcaseStatus.FEATURED,
        },
      }),
    ]);
  const metrics = [
    { caption: "用户池", icon: Users, label: "注册用户", value: userCount },
    { caption: "准入", icon: Ticket, label: "邀请码总数", value: inviteCount },
    {
      caption: "积分活动",
      icon: BadgePercent,
      label: "兑换码总数",
      value: redeemCodeCount,
    },
    {
      caption: "任务流水",
      icon: ClipboardList,
      label: "生成记录",
      value: generationCount,
    },
    { caption: "社区精选", icon: ImageIcon, label: "公开作品", value: featuredCount },
  ];

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="admin-eyebrow">Overview</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              管理后台
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              全局数据概览、内容审核和运营入口都集中在这里。
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="studio-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-[var(--ink-soft)]">
                      {metric.label}
                    </div>
                    <div className="mt-3 text-4xl font-semibold text-[var(--ink)]">
                      {metric.value}
                    </div>
                  </div>
                  <span className="admin-metric-icon">
                    <Icon className="size-5" />
                  </span>
                </div>
                <div className="mt-4 text-xs text-[var(--ink-soft)]">
                  {metric.caption}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="studio-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">系统概览</h2>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  当前后台核心模块已就绪，可直接处理内容和积分运营。
                </p>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                运行中
              </span>
            </div>
            <div className="mt-5 grid gap-3 text-sm text-[var(--ink-soft)] sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--line)] bg-white/55 p-4">
                <span className="block text-xs">内容队列</span>
                <strong className="mt-2 block text-2xl text-[var(--ink)]">
                  {featuredCount}
                </strong>
                <span className="mt-1 block">公开精选作品</span>
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-white/55 p-4">
                <span className="block text-xs">运营资产</span>
                <strong className="mt-2 block text-2xl text-[var(--ink)]">
                  {inviteCount + redeemCodeCount}
                </strong>
                <span className="mt-1 block">邀请码与兑换码合计</span>
              </div>
            </div>
          </section>

          <section className="studio-card p-5">
            <h2 className="text-lg font-semibold">快速入口</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ["/admin/works", "批量审核", "集中处理投稿作品"],
                ["/admin/users", "用户管理", "搜索与调整用户"],
                ["/admin/generations", "生成记录", "查看任务流水"],
                ["/admin/settings", "系统设置", "站点与安全配置"],
              ].map(([href, title, desc]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-lg border border-[var(--line)] bg-white/55 p-4 text-sm transition hover:border-[var(--accent)] hover:bg-white/80"
                >
                  <span className="font-semibold text-[var(--ink)]">{title}</span>
                  <span className="mt-1 block text-xs text-[var(--ink-soft)]">
                    {desc}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
