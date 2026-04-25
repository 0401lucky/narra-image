import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { SiteHeader } from "@/components/marketing/site-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { InviteBatchToggle, InviteCreator } from "@/components/admin/admin-actions";
import { serializeUser } from "@/lib/prisma-mappers";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { InviteDeleteBtn, InviteTableActions } from "@/components/admin/invite-table-actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function AdminInvitesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const [batches, invites, totalCount, usedCount] = await Promise.all([
    db.inviteBatch.findMany({
      include: {
        inviteCodes: {
          select: { claimedAt: true, id: true, usedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.inviteCode.findMany({
      include: {
        batch: { select: { id: true, isPublic: true, title: true } },
        usedBy: { select: { email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.inviteCode.count(),
    db.inviteCode.count({ where: { usedAt: { not: null } } }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className="mx-auto grid max-w-7xl gap-5 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              邀请码管理
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              批量生成和管理系统的准入邀请码。共 {totalCount} 个邀请码，{usedCount} 个已使用。
            </p>
          </div>
          <AdminNav currentPath="/admin/invites" />
        </div>

        <InviteCreator />

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="studio-card rounded-[1.6rem] p-4 md:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-medium">公开领取入口</h2>
                <p className="mt-2 text-sm text-[var(--ink-soft)]">
                  开放批次会自动同步到邀请码领取页，由系统分配一个邀请码后跳转注册。
                </p>
              </div>
              <Link
                href="/invite-claim"
                className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent)]"
              >
                打开领取页
              </Link>
            </div>
          </section>

          <section className="studio-card rounded-[1.6rem] p-4 md:p-5">
            <h2 className="text-xl font-medium">批次概览</h2>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              每次批量生成都会形成一个可独立开放的领取批次。
            </p>
          </section>
        </div>

        <div className="grid gap-4">
          {batches.map((batch) => {
            const remainingCount = batch.inviteCodes.filter(
              (invite) => !invite.usedAt && !invite.claimedAt,
            ).length;
            return (
              <article
                key={batch.id}
                className="studio-card grid gap-4 rounded-[1.6rem] p-4 md:p-5 xl:grid-cols-[1.2fr_0.8fr_0.8fr_auto]"
              >
                <div>
                  <div className="text-xs uppercase tracking-[0.28em] text-[var(--ink-soft)]">
                    邀请批次
                  </div>
                  <h2 className="mt-2 text-xl font-medium">
                    {batch.title || "未命名批次"}
                  </h2>
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">
                    创建于 {new Date(batch.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div>
                  <div className="text-sm text-[var(--ink-soft)]">总数量</div>
                  <div className="mt-3 text-3xl font-semibold text-[var(--ink)]">
                    {batch.inviteCodes.length}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-[var(--ink-soft)]">可领取剩余</div>
                  <div className="mt-3 text-3xl font-semibold text-[var(--accent)]">
                    {remainingCount}
                  </div>
                </div>
                <div className="flex flex-wrap items-end justify-start gap-2 xl:justify-end">
                  {remainingCount > 0 ? (
                    <a
                      href={`/api/admin/invites/batches/${batch.id}/export`}
                      download
                      className="rounded-full border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      title="下载本批次未发放的邀请码（每行一个）"
                    >
                      下载 .txt
                    </a>
                  ) : (
                    <span
                      className="rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-soft)]/50"
                      title="本批次没有可下载的邀请码"
                    >
                      下载 .txt
                    </span>
                  )}
                  <InviteBatchToggle batchId={batch.id} isPublic={batch.isPublic} />
                </div>
              </article>
            );
          })}
        </div>

        <InviteTableActions usedCount={usedCount} />

        <div className="grid gap-3 lg:hidden">
          {invites.map((invite) => (
            <article key={invite.id} className="studio-card rounded-[1.4rem] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--ink)] break-all">
                    {invite.code}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ink-soft)]">
                    {invite.batch?.title || "独立邀请码"}
                  </div>
                </div>
                <div className="shrink-0">
                  {invite.usedAt ? (
                    <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white">
                      已使用
                    </span>
                  ) : invite.claimedAt ? (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-700">
                      已发放
                    </span>
                  ) : (
                    <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--ink-soft)]">
                      未使用
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-[var(--ink-soft)]">
                <p>备注：{invite.note || "—"}</p>
                <p>使用用户：{invite.usedBy?.email || "—"}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="studio-card hidden overflow-hidden rounded-[2rem] lg:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--line)] bg-white/60 text-[var(--ink-soft)]">
              <tr>
                <th className="px-5 py-4 font-medium">邀请码</th>
                <th className="px-5 py-4 font-medium">批次</th>
                <th className="px-5 py-4 font-medium">备注</th>
                <th className="px-5 py-4 font-medium">状态</th>
                <th className="px-5 py-4 font-medium">使用用户</th>
                <th className="px-5 py-4 font-medium w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <InviteTableRow
                  key={invite.id}
                  invite={{
                    batch: invite.batch,
                    claimedAt: invite.claimedAt?.toISOString() ?? null,
                    code: invite.code,
                    id: invite.id,
                    note: invite.note,
                    usedAt: invite.usedAt?.toISOString() ?? null,
                    usedByEmail: invite.usedBy?.email ?? null,
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>

        <AdminPagination
          currentPage={page}
          totalPages={totalPages}
          basePath="/admin/invites"
        />
      </section>
    </main>
  );
}

function InviteTableRow({
  invite,
}: {
  invite: {
    batch: { id: string; isPublic: boolean; title: string | null } | null;
    claimedAt: string | null;
    code: string;
    id: string;
    note: string | null;
    usedAt: string | null;
    usedByEmail: string | null;
  };
}) {
  return (
    <tr className="border-b border-[var(--line)] last:border-none">
      <td className="px-5 py-4 font-medium">{invite.code}</td>
      <td className="px-5 py-4 text-[var(--ink-soft)]">
        {invite.batch?.title || "独立邀请码"}
        {invite.batch ? (
          <span className="ml-2 rounded-full border border-[var(--line)] px-2 py-0.5 text-xs">
            {invite.batch.isPublic ? "已开放" : "未开放"}
          </span>
        ) : null}
      </td>
      <td className="px-5 py-4 text-[var(--ink-soft)]">{invite.note || "—"}</td>
      <td className="px-5 py-4">
        {invite.usedAt ? (
          <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white">
            已使用
          </span>
        ) : invite.claimedAt ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-700">
            已发放
          </span>
        ) : (
          <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--ink-soft)]">
            未使用
          </span>
        )}
      </td>
      <td className="px-5 py-4 text-[var(--ink-soft)]">
        {invite.usedByEmail || "—"}
      </td>
      <td className="px-5 py-4">
        <InviteDeleteBtn inviteId={invite.id} />
      </td>
    </tr>
  );
}

