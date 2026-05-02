import { db } from "@/lib/db";
import { getPublicTurnstileConfig } from "@/lib/auth/turnstile";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { serializeUser } from "@/lib/prisma-mappers";
import { SiteHeader } from "@/components/marketing/site-header";
import { InviteClaimBoard } from "@/components/invites/invite-claim-board";

export const dynamic = "force-dynamic";

export default async function InviteClaimPage() {
  const [user, batches, turnstile] = await Promise.all([
    getCurrentUserRecord(),
    db.inviteBatch.findMany({
      where: {
        isPublic: true,
      },
      include: {
        inviteCodes: {
          select: {
            claimedAt: true,
            id: true,
            usedAt: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
    }),
    getPublicTurnstileConfig(),
  ]);

  const openBatches = batches
    .map((batch) => ({
      id: batch.id,
      remainingCount: batch.inviteCodes.filter((invite) => !invite.usedAt && !invite.claimedAt).length,
      title: batch.title,
      totalCount: batch.inviteCodes.length,
    }))
    .filter((batch) => batch.remainingCount > 0);

  return (
    <main className="pb-20">
      <SiteHeader currentUser={user ? serializeUser(user) : null} />

      <section className="mx-auto grid max-w-5xl gap-6 px-5 pt-8 md:px-8">
        <div className="space-y-5">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-soft)]">
            Claim Access
          </p>
          <h1 className="editorial-title text-4xl leading-none font-semibold md:text-6xl">
            领取邀请码，
            <br />
            再直接注册。
          </h1>
          <p className="max-w-xl text-sm leading-7 text-[var(--ink-soft)] md:text-base md:leading-8">
            这里展示的是管理员当前开放领取的邀请码批次。点击领取后，
            系统会自动分配一个邀请码，并带你进入注册页。
          </p>
        </div>

        {openBatches.length > 0 ? (
          <InviteClaimBoard
            batches={openBatches}
            turnstile={{
              isEnabled: turnstile.isEnabled,
              siteKey: turnstile.siteKey,
              protectInviteRedeem: turnstile.protectInviteRedeem,
            }}
          />
        ) : (
          <div className="studio-card rounded-[1.8rem] border border-dashed border-[var(--line)] p-8 text-center md:p-10">
            <h2 className="text-2xl font-semibold text-[var(--ink)]">当前没有开放领取的邀请码</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
              稍后再来看看，或者联系管理员获取专属邀请码。
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
