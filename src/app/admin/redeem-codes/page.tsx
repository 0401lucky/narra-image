import { redirect } from "next/navigation";

import { RedeemCodeMode } from "@prisma/client";

import { db } from "@/lib/db";
import { serializeUser } from "@/lib/prisma-mappers";
import { requireAdminRecord } from "@/lib/server/current-user";
import { AdminNav } from "@/components/admin/admin-nav";
import { RedeemBatchDownload, RedeemBatchToggle, RedeemCodeCreator } from "@/components/admin/redeem-code-manager";
import { SiteHeader } from "@/components/marketing/site-header";

export const dynamic = "force-dynamic";

function formatMode(mode: RedeemCodeMode) {
  return mode === RedeemCodeMode.SHARED ? "共享限次" : "批量单次";
}

function formatTime(value: Date) {
  return value.toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}

export default async function AdminRedeemCodesPage() {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const [batches, codes, redemptions, totalCodes, totalRedemptions] = await Promise.all([
    db.redeemCodeBatch.findMany({
      include: {
        codes: {
          orderBy: { createdAt: "asc" },
          select: {
            code: true,
            id: true,
            maxRedemptions: true,
            redeemedCount: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.redeemCode.findMany({
      include: {
        batch: { select: { id: true, isActive: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    db.redeemRedemption.findMany({
      include: {
        code: { select: { code: true, mode: true } },
        user: { select: { email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.redeemCode.count(),
    db.redeemRedemption.count(),
  ]);

  const activeCodes = codes.filter((code) => code.isActive && code.batch?.isActive !== false).length;

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className="mx-auto grid max-w-7xl gap-5 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              兑换码管理
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              创建可兑换积分的活动码，支持批量单次发放和共享限次领取。
            </p>
          </div>
          <AdminNav currentPath="/admin/redeem-codes" />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["兑换码总数", totalCodes],
            ["启用中的码", activeCodes],
            ["已兑换次数", totalRedemptions],
          ].map(([label, value]) => (
            <div key={label} className="studio-card rounded-[1.8rem] p-5">
              <div className="text-sm text-[var(--ink-soft)]">{label}</div>
              <div className="mt-3 text-4xl font-semibold text-[var(--ink)]">{value}</div>
            </div>
          ))}
        </div>

        <RedeemCodeCreator />

        <section className="grid gap-4">
          {batches.map((batch) => {
            const remaining = batch.codes.reduce(
              (sum, code) => sum + Math.max(0, code.maxRedemptions - code.redeemedCount),
              0,
            );
            return (
              <article
                key={batch.id}
                className="studio-card grid gap-4 rounded-[1.6rem] p-4 md:p-5 xl:grid-cols-[1.2fr_0.7fr_0.7fr_auto]"
              >
                <div>
                  <div className="text-xs uppercase tracking-[0.28em] text-[var(--ink-soft)]">
                    {formatMode(batch.mode)}
                  </div>
                  <h2 className="mt-2 text-xl font-medium">{batch.title || "未命名批次"}</h2>
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">
                    创建于 {formatTime(batch.createdAt)} · 每次 +{batch.rewardCredits} 积分
                  </p>
                </div>
                <div>
                  <div className="text-sm text-[var(--ink-soft)]">总码数</div>
                  <div className="mt-3 text-3xl font-semibold text-[var(--ink)]">{batch.codes.length}</div>
                </div>
                <div>
                  <div className="text-sm text-[var(--ink-soft)]">剩余可兑</div>
                  <div className="mt-3 text-3xl font-semibold text-[var(--accent)]">{remaining}</div>
                </div>
                <div className="flex flex-wrap items-end justify-start gap-2 xl:justify-end">
                  <RedeemBatchDownload batchId={batch.id} />
                  <RedeemBatchToggle batchId={batch.id} isActive={batch.isActive} />
                </div>
              </article>
            );
          })}
        </section>

        <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
          <section className="studio-card overflow-hidden rounded-[2rem]">
            <div className="border-b border-[var(--line)] px-5 py-4">
              <h2 className="text-xl font-semibold">最近兑换码</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-[var(--line)] bg-white/60 text-[var(--ink-soft)]">
                  <tr>
                    <th className="px-5 py-4 font-medium">兑换码</th>
                    <th className="px-5 py-4 font-medium">类型</th>
                    <th className="px-5 py-4 font-medium">积分</th>
                    <th className="px-5 py-4 font-medium">进度</th>
                    <th className="px-5 py-4 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code) => (
                    <tr key={code.id} className="border-b border-[var(--line)] last:border-none">
                      <td className="px-5 py-4 font-semibold">{code.code}</td>
                      <td className="px-5 py-4 text-[var(--ink-soft)]">{formatMode(code.mode)}</td>
                      <td className="px-5 py-4 text-[var(--accent)]">+{code.rewardCredits}</td>
                      <td className="px-5 py-4 text-[var(--ink-soft)]">
                        {code.redeemedCount}/{code.maxRedemptions}
                      </td>
                      <td className="px-5 py-4">
                        {code.isActive && code.batch?.isActive !== false ? (
                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-700">启用</span>
                        ) : (
                          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600">停用</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="studio-card rounded-[2rem] p-5">
            <h2 className="text-xl font-semibold">最近兑换记录</h2>
            <div className="mt-4 grid gap-3">
              {redemptions.length > 0 ? (
                redemptions.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-[var(--line)] bg-white/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-[var(--ink)]">{item.code.code}</span>
                      <span className="text-sm font-medium text-[var(--accent)]">+{item.rewardCredits}</span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--ink-soft)]">
                      {item.user.email} · {formatTime(item.createdAt)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-soft)]">
                  暂无兑换记录。
                </p>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
