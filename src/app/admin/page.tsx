import {
  AlertTriangle,
  ArrowUpRight,
  BadgePercent,
  BookOpenText,
  CheckCircle2,
  ClipboardList,
  HardDrive,
  ImageIcon,
  LayoutDashboard,
  Server,
  ShieldAlert,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminTrendChart } from "@/components/admin/dashboard/admin-trend-chart";
import { formatStorageBytes } from "@/components/admin/storage/utils";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { getAdminDashboardData } from "@/lib/server/admin-overview";
import { requireAdminRecord } from "@/lib/server/current-user";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const data = await getAdminDashboardData();
  const totalFeatured = data.featuredImagesCount + data.featuredVideosCount;

  const kpis = [
    {
      delta: data.todayNewUsers > 0 ? `今日 +${data.todayNewUsers}` : "今日 0 新增",
      deltaTone: data.todayNewUsers > 0 ? "positive" : "neutral",
      href: "/admin/users",
      icon: Users,
      label: "注册用户总量",
      value: data.userCount.toLocaleString("zh-CN"),
    },
    {
      delta:
        data.todayGenerations > 0
          ? `今日 +${data.todayGenerations}${data.todayFailedGenerations > 0 ? ` · 失败 ${data.todayFailedGenerations}` : ""}`
          : "今日暂无新任务",
      deltaTone: data.todayFailedGenerations > 0 ? "warning" : "positive",
      href: "/admin/generations",
      icon: Sparkles,
      label: "累计生成任务",
      value: data.totalGenerations.toLocaleString("zh-CN"),
    },
    {
      delta:
        data.pendingWorksCount + data.takedownPendingCount > 0
          ? `${data.pendingWorksCount} 待审 · ${data.takedownPendingCount} 待下架`
          : "无积压待审作品",
      deltaTone:
        data.pendingWorksCount + data.takedownPendingCount > 0
          ? "warning"
          : "neutral",
      href: "/admin/works",
      icon: ImageIcon,
      label: "公开精选作品",
      value: totalFeatured.toLocaleString("zh-CN"),
    },
    {
      delta: `${data.inviteRemainingCount} 可领邀请 · ${data.activeRedeemCodeCount} 有效兑换码`,
      deltaTone: "neutral",
      href: "/admin/redeem-codes",
      icon: Ticket,
      label: "启用生图渠道",
      value: `${data.activeChannelCount} / ${data.totalChannelCount}`,
    },
  ] as const;

  const todoItems = [
    {
      count: data.pendingWorksCount,
      desc: "审核用户提交至公开精选画廊的图片与视频作品",
      href: "/admin/works?status=PENDING",
      label: "待审核投稿作品",
      tone: data.pendingWorksCount > 0 ? "accent" : "clear",
    },
    {
      count: data.takedownPendingCount,
      desc: "处理作者发起的精选作品撤回下架申请",
      href: "/admin/works?status=TAKEDOWN_PENDING",
      label: "待处理下架申请",
      tone: data.takedownPendingCount > 0 ? "warning" : "clear",
    },
    {
      count: data.coordinationCount,
      desc: "检视 Worker v1 HANDOFF_UNKNOWN 任务的尝试记录与证据",
      href: "/admin/generations?status=COORDINATION",
      label: "需人工协调生成任务",
      tone: data.coordinationCount > 0 ? "danger" : "clear",
    },
    {
      count: data.failedPromptSourcesCount,
      desc: `已入库 ${data.totalPromptCount.toLocaleString("zh-CN")} 条提示词，核查 GitHub 来源同步状态`,
      href: "/admin/prompts",
      label: "同步异常提示词源",
      tone: data.failedPromptSourcesCount > 0 ? "danger" : "clear",
    },
  ] as const;

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Overview"
          icon={LayoutDashboard}
          title="运营中枢概览"
          description="实时聚合站点核心产出趋势、待处理审核队列与基础设施健康水位。"
        />

        {/* 4-Column Responsive Bento KPI Row */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <Link
                key={kpi.label}
                href={kpi.href}
                className="studio-card admin-card-interactive group flex flex-col justify-between p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-[var(--ink-soft)] sm:text-sm">
                      {kpi.label}
                    </div>
                    <div className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular-nums text-[var(--ink)]">
                      {kpi.value}
                    </div>
                  </div>
                  <span className="admin-metric-icon transition-transform group-hover:scale-105">
                    <Icon className="size-4.5" aria-hidden />
                  </span>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--line)]/60 pt-3 text-xs">
                  <span
                    className={cn(
                      "truncate font-medium",
                      kpi.deltaTone === "positive" && "text-emerald-700",
                      kpi.deltaTone === "warning" && "text-[#b54722]",
                      kpi.deltaTone === "neutral" && "text-[var(--ink-soft)]",
                    )}
                  >
                    {kpi.delta}
                  </span>
                  <ArrowUpRight
                    className="size-3.5 shrink-0 text-[var(--ink-soft)]/50 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#c85a32]"
                    aria-hidden
                  />
                </div>
              </Link>
            );
          })}
        </div>

        {/* Main 2-Column Workspace: Trend + Storage on Left, Pending Queue on Right */}
        <div className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="grid gap-5 self-start">
            <AdminTrendChart points={data.trend} />

            {/* Infrastructure & Storage Health Strip */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Link
                href="/admin/settings/channels"
                className="studio-card admin-card-interactive flex flex-col justify-between p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                    <Server className="size-4 text-[#b54722]" aria-hidden />
                    生图渠道状态
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      data.activeChannelCount > 0
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800",
                    )}
                  >
                    {data.activeChannelCount > 0
                      ? `${data.activeChannelCount} 个活跃`
                      : "未配置活跃渠道"}
                  </span>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-[var(--ink-soft)]">
                  共登记 {data.totalChannelCount} 个上游提供商，点击可进行延迟探测或调整模型目录。
                </p>
              </Link>

              <Link
                href="/admin/settings/storage"
                className="studio-card admin-card-interactive flex flex-col justify-between p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                    <HardDrive className="size-4 text-[#b54722]" aria-hidden />
                    图片存储水位
                  </span>
                  <span className="font-mono text-xs font-semibold text-[var(--ink-soft)]">
                    {data.storage
                      ? `${Math.round(data.storage.usedRatio * 100)}%`
                      : "待检查"}
                  </span>
                </div>

                {data.storage ? (
                  <div className="mt-3">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#ebe3d5]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          data.storage.usedRatio >= 0.85
                            ? "bg-rose-500"
                            : data.storage.usedRatio >= 0.65
                              ? "bg-amber-500"
                              : "bg-[#c85a32]",
                        )}
                        style={{
                          width: `${Math.max(3, Math.round(data.storage.usedRatio * 100))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 font-mono text-[11px] text-[var(--ink-soft)]">
                      已用 {formatStorageBytes(data.storage.usedBytes)} / 上限{" "}
                      {formatStorageBytes(data.storage.limitBytes)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2.5 text-xs text-[var(--ink-soft)]">
                    前往图片存储页查看纳管容量与自动清理策略。
                  </p>
                )}
              </Link>
            </div>
          </div>

          {/* Right Column: Actionable Queue + Quick Links */}
          <div className="grid gap-5 self-start">
            <section className="studio-card p-5 md:p-6">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-[var(--ink)] sm:text-lg">
                    待办与巡检队列
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                    需优先关注或人工介入处理的运营事项。
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2.5">
                {todoItems.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[#faf7f1] px-4 py-3 transition hover:border-[#c85a32]/45 hover:bg-white"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {item.count > 0 ? (
                          <AlertTriangle
                            className={cn(
                              "size-3.5 shrink-0",
                              item.tone === "danger"
                                ? "text-rose-600"
                                : "text-amber-600",
                            )}
                            aria-hidden
                          />
                        ) : (
                          <CheckCircle2
                            className="size-3.5 shrink-0 text-emerald-600"
                            aria-hidden
                          />
                        )}
                        <span className="truncate text-sm font-medium text-[var(--ink)]">
                          {item.label}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[var(--ink-soft)]">
                        {item.desc}
                      </p>
                    </div>

                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums",
                        item.count === 0 && "bg-emerald-100 text-emerald-800",
                        item.count > 0 &&
                          item.tone === "accent" &&
                          "bg-[#c85a32] text-white",
                        item.count > 0 &&
                          item.tone === "warning" &&
                          "bg-amber-500 text-[#1d140c]",
                        item.count > 0 &&
                          item.tone === "danger" &&
                          "bg-rose-600 text-white",
                      )}
                    >
                      {item.count}
                    </span>
                  </Link>
                ))}
              </div>
            </section>

            <section className="studio-card p-5 md:p-6">
              <h2 className="text-base font-semibold text-[var(--ink)]">常用运营直达</h2>
              <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                {[
                  { desc: "检索与积分调账", href: "/admin/users", icon: Users, title: "用户管理" },
                  { desc: "排障与重试证据", href: "/admin/generations", icon: ClipboardList, title: "生成流水" },
                  { desc: "拦截记录与词库", href: "/admin/moderation", icon: ShieldAlert, title: "内容风控" },
                  { desc: "口令与积分活动", href: "/admin/redeem-codes", icon: BadgePercent, title: "兑换码发行" },
                  { desc: "批次与公开领取", href: "/admin/invites", icon: Ticket, title: "邀请码管理" },
                  { desc: "灵感来源同步", href: "/admin/prompts", icon: BookOpenText, title: "提示词库" },
                ].map((entry) => {
                  const Icon = entry.icon;
                  return (
                    <Link
                      key={entry.href}
                      href={entry.href}
                      className="rounded-xl border border-[var(--line)] bg-[#faf7f1] p-3 transition hover:border-[#c85a32]/45 hover:bg-white"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 text-[#b54722]" aria-hidden />
                        <span className="text-xs font-semibold text-[var(--ink)] sm:text-sm">
                          {entry.title}
                        </span>
                      </div>
                      <span className="mt-1 block text-[11px] text-[var(--ink-soft)]">
                        {entry.desc}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
