import { Gift } from "lucide-react";
import { redirect } from "next/navigation";

import { CheckInBenefitForm } from "@/components/admin/check-in-benefit-form";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { getBenefitConfig } from "@/lib/benefits/config";
import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export default async function AdminBenefitsPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const [benefitConfig, records, totalCheckIns] = await Promise.all([
    getBenefitConfig(),
    db.checkInRecord.findMany({
      include: {
        user: {
          select: {
            email: true,
            id: true,
            nickname: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.checkInRecord.count(),
  ]);

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Benefits"
          icon={Gift}
          title="签到与福利配置"
          description={`配置每日签到积分奖励，并核查近期用户签到发放流水（累计签到 ${totalCheckIns.toLocaleString("zh-CN")} 人次）。`}
        />

        <CheckInBenefitForm initialCheckInReward={benefitConfig.checkInReward} />

        <section className="studio-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
            <div>
              <h2 className="text-base font-semibold text-[var(--ink)]">最近签到发放流水</h2>
            </div>
            <span className="text-xs text-[var(--ink-soft)]">
              最近 {records.length} 条记录
            </span>
          </div>

          {records.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-[var(--line)] text-xs text-[var(--ink-soft)]">
                  <tr>
                    <th className="px-5 py-3 font-medium">签到用户</th>
                    <th className="px-5 py-3 font-medium">签到日期键</th>
                    <th className="px-5 py-3 font-medium">发放积分</th>
                    <th className="px-5 py-3 text-right font-medium">领取时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]/70">
                  {records.map((record) => (
                    <tr key={record.id} className="transition-colors hover:bg-[#faf6ee]/80">
                      <td className="px-5 py-3">
                        <div className="font-medium text-[var(--ink)]">
                          {record.user.nickname?.trim() || record.user.email}
                        </div>
                        {record.user.nickname?.trim() ? (
                          <div className="font-mono text-xs text-[var(--ink-soft)]">
                            {record.user.email}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-[var(--ink-soft)]">
                        {record.dateKey}
                      </td>
                      <td className="px-5 py-3 font-mono font-semibold text-[#b54722]">
                        +{record.rewardCredits}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-[var(--ink-soft)]">
                        {new Date(record.createdAt).toLocaleString("zh-CN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-10 text-center text-sm text-[var(--ink-soft)]">
              暂时还没有签到记录。
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
