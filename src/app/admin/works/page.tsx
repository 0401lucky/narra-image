import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { AdminWorksBoard } from "@/components/admin/admin-works-board";
import { SiteHeader } from "@/components/marketing/site-header";
import { serializeUser } from "@/lib/prisma-mappers";
import { requireAdminRecord } from "@/lib/server/current-user";
import { listAdminWorks } from "@/lib/server/works";
import { getBenefitConfig } from "@/lib/benefits/config";
import { ShowcaseAutoApproveToggle } from "@/components/admin/showcase-auto-approve-toggle";

export const dynamic = "force-dynamic";

export default async function AdminWorksPage() {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const [works, benefitConfig] = await Promise.all([
    listAdminWorks(),
    getBenefitConfig(),
  ]);

  const counts = {
    featured: works.filter((work) => work.showcaseStatus === "FEATURED").length,
    pending: works.filter((work) => work.showcaseStatus === "PENDING").length,
    takedownPending: works.filter((work) => work.showcaseStatus === "TAKEDOWN_PENDING").length,
  };

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />

      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              作品审核
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              审核投稿、处理下架申请，并查看当前公开中的单图作品。
            </p>
          </div>
          <AdminNav currentPath="/admin/works" />
        </div>

        <ShowcaseAutoApproveToggle
          initialValue={benefitConfig.autoApproveShowcase}
        />

        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["待审核投稿", counts.pending],
            ["待处理下架", counts.takedownPending],
            ["公开中作品", counts.featured],
          ].map(([label, value]) => (
            <div key={label} className="studio-card rounded-[1.8rem] p-5">
              <p className="text-sm text-[var(--ink-soft)]">{label}</p>
              <p className="mt-3 text-4xl font-semibold text-[var(--ink)]">{value}</p>
            </div>
          ))}
        </div>

        <AdminWorksBoard works={works} />
      </section>
    </main>
  );
}
