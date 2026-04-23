import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getBenefitConfig } from "@/lib/benefits/config";
import { requireAdminRecord } from "@/lib/server/current-user";
import { SiteHeader } from "@/components/marketing/site-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { CheckInBenefitForm } from "@/components/admin/check-in-benefit-form";
import { serializeUser } from "@/lib/prisma-mappers";

export const dynamic = "force-dynamic";

export default async function AdminBenefitsPage() {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const [benefitConfig, records] = await Promise.all([
    getBenefitConfig(),
    db.checkInRecord.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            email: true,
            id: true,
          },
        },
      },
      take: 50,
    }),
  ]);

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-6 md:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              福利配置
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              维护每日签到奖励，并查看最近签到记录。
            </p>
          </div>
          <AdminNav currentPath="/admin/benefits" />
        </div>

        <CheckInBenefitForm initialCheckInReward={benefitConfig.checkInReward} />

        <section className="studio-card rounded-[1.8rem] p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">最近签到记录</h2>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                用于排查奖励发放和用户反馈。
              </p>
            </div>
            <span className="text-xs text-[var(--ink-soft)]">
              共 {records.length} 条
            </span>
          </div>

          <div className="mt-5 grid gap-3">
            {records.length > 0 ? (
              records.map((record) => (
                <article
                  key={record.id}
                  className="rounded-[1.2rem] border border-[var(--line)] bg-[var(--surface-strong)]/30 px-4 py-3"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-medium text-[var(--ink)]">
                        {record.user.email}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">
                        日期键 {record.dateKey}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-[var(--accent)]">
                        +{record.rewardCredits}
                      </span>
                      <span className="text-[var(--ink-soft)]">
                        {new Date(record.createdAt).toLocaleString("zh-CN")}
                      </span>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-[1.2rem] border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
                暂时还没有签到记录。
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
