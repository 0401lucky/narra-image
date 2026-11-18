import type { Prisma } from "@prisma/client";
import { ArrowUpRight, RotateCcw, Search, Ticket, X } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  InviteBatchCopy,
  InviteBatchDelete,
  InviteBatchToggle,
  InviteBatchViewButton,
  InviteCreator,
} from "@/components/admin/admin-actions";
import { AdminPagination } from "@/components/admin/admin-pagination";
import {
  InviteCopyCodeBtn,
  InviteDeleteBtn,
  InviteTableActions,
} from "@/components/admin/invite-table-actions";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function AdminInvitesPage(props?: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const params = props?.searchParams ? await props.searchParams : {};
  const page = Math.max(1, Number(params.page) || 1);
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const status =
    params.status === "unused" ||
    params.status === "claimed" ||
    params.status === "used"
      ? params.status
      : "";

  const clauses: Prisma.InviteCodeWhereInput[] = [];
  if (q) {
    clauses.push({
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } },
        { batch: { is: { title: { contains: q, mode: "insensitive" } } } },
        { usedBy: { is: { email: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  if (status === "unused") {
    clauses.push({ claimedAt: null, usedAt: null });
  } else if (status === "claimed") {
    clauses.push({ claimedAt: { not: null }, usedAt: null });
  } else if (status === "used") {
    clauses.push({ usedAt: { not: null } });
  }

  const inviteWhere: Prisma.InviteCodeWhereInput =
    clauses.length === 0
      ? {}
      : clauses.length === 1
        ? clauses[0]!
        : { AND: clauses };

  const [
    batches,
    invites,
    filteredCount,
    totalCount,
    usedCount,
    claimedPendingCount,
  ] = await Promise.all([
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
      where: inviteWhere,
    }),
    db.inviteCode.count({ where: inviteWhere }),
    db.inviteCode.count(),
    db.inviteCode.count({ where: { usedAt: { not: null } } }),
    db.inviteCode.count({ where: { claimedAt: { not: null }, usedAt: null } }),
  ]);

  const unusedCount = Math.max(0, totalCount - usedCount - claimedPendingCount);
  const publicBatchCount = batches.filter((b) => b.isPublic).length;
  const totalPages = Math.ceil(filteredCount / PAGE_SIZE);

  const extraParams: Record<string, string> = {};
  if (q) extraParams.q = q;
  if (status) extraParams.status = status;

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Invites & Onboarding"
          icon={Ticket}
          title="准入邀请码管理"
          description="批量发行与管理注册准入邀请码，支持公开领取池动态启停与转化追踪。"
          actions={
            <Link
              href="/invite-claim"
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
            >
              预览公开领取页
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          }
        />

        {/* Real Funnel Stats instead of empty placeholder card */}
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <div className="studio-card p-4">
            <div className="text-xs text-[var(--ink-soft)]">累计生成总数</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-[var(--ink)]">
              {totalCount.toLocaleString("zh-CN")}
            </div>
            <div className="mt-1 text-[11px] text-[var(--ink-soft)]">
              最近 {batches.length} 个批次（{publicBatchCount} 个公开中）
            </div>
          </div>

          <div className="studio-card p-4">
            <div className="text-xs text-[var(--ink-soft)]">剩余未发放</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-emerald-700">
              {unusedCount.toLocaleString("zh-CN")}
            </div>
            <div className="mt-1 text-[11px] text-[var(--ink-soft)]">
              可供定向分发或公开领取
            </div>
          </div>

          <div className="studio-card p-4">
            <div className="text-xs text-[var(--ink-soft)]">已领取待注册</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-amber-700">
              {claimedPendingCount.toLocaleString("zh-CN")}
            </div>
            <div className="mt-1 text-[11px] text-[var(--ink-soft)]">
              用户已从领取页分配但尚未完成注册
            </div>
          </div>

          <div className="studio-card p-4">
            <div className="text-xs text-[var(--ink-soft)]">已完成注册</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-[var(--admin-ink-credit)]">
              {usedCount.toLocaleString("zh-CN")}
            </div>
            <div className="mt-1 text-[11px] text-[var(--ink-soft)]">
              整体注册转化率{" "}
              {totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0}%
            </div>
          </div>
        </div>

        <InviteCreator />

        {batches.length > 0 ? (
          <div className="grid gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-[var(--ink-soft)]">
              邀请码批次列表（{batches.length}）
            </h2>
            {batches.map((batch) => {
              const remainingCount = batch.inviteCodes.filter(
                (invite) => !invite.usedAt && !invite.claimedAt,
              ).length;
              return (
                <article
                  key={batch.id}
                  className="studio-card grid gap-4 p-4 md:p-5 xl:grid-cols-[1.2fr_0.55fr_0.55fr_auto]"
                >
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                      邀请批次
                    </div>
                    <h3 className="mt-1.5 text-lg font-semibold text-[var(--ink)]">
                      {batch.title || "未命名批次"}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      创建于 {new Date(batch.createdAt).toLocaleString("zh-CN")}
                    </p>
                  </div>

                  <div>
                    <div className="text-xs text-[var(--ink-soft)]">总数量</div>
                    <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[var(--ink)]">
                      {batch.inviteCodes.length}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-[var(--ink-soft)]">可领取剩余</div>
                    <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[var(--admin-ink-credit)]">
                      {remainingCount}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
                    <InviteBatchViewButton batchId={batch.id} title={batch.title} />
                    <InviteBatchCopy batchId={batch.id} />
                    {remainingCount > 0 ? (
                      <a
                        href={`/api/admin/invites/batches/${batch.id}/export`}
                        download
                        className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
                        title="下载本批次未发放的邀请码（每行一个）"
                      >
                        下载 .txt
                      </a>
                    ) : (
                      <span
                        className="rounded-full border border-[var(--line)] bg-[#faf7f1] px-3 py-1.5 text-xs text-[var(--ink-soft)]/50"
                        title="本批次没有可下载的邀请码"
                      >
                        下载 .txt
                      </span>
                    )}
                    <InviteBatchToggle batchId={batch.id} isPublic={batch.isPublic} />
                    <InviteBatchDelete
                      batchId={batch.id}
                      total={batch.inviteCodes.length}
                      remaining={remainingCount}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {/* Filter Bar + Clear Used Action */}
        <div className="studio-card flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <form
            action="/admin/invites"
            method="get"
            className="flex flex-1 flex-wrap items-center gap-2"
          >
            <div className="relative min-w-[220px] flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--ink-soft)]"
                aria-hidden
              />
              <input
                key={q}
                name="q"
                defaultValue={q}
                placeholder="搜索邀请码、备注、批次名或注册邮箱…"
                className="w-full rounded-xl border border-[var(--admin-line)] bg-white py-2 pr-8 pl-10 text-xs outline-none sm:text-sm"
              />
              {q ? (
                <Link
                  href={status ? `/admin/invites?status=${status}` : "/admin/invites"}
                  aria-label="清空邀请码搜索"
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)]"
                >
                  <X className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </div>

            <select
              name="status"
              defaultValue={status}
              aria-label="按邀请码状态筛选"
              className="rounded-xl border border-[var(--admin-line)] bg-white px-3 py-2 text-xs font-medium text-[var(--ink)] outline-none sm:text-sm"
            >
              <option value="">全部状态</option>
              <option value="unused">未使用</option>
              <option value="claimed">已发放待注册</option>
              <option value="used">已注册使用</option>
            </select>

            <button
              type="submit"
              className="rounded-xl bg-[#c25934] px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a] sm:text-sm"
            >
              检索
            </button>

            {q || status ? (
              <Link
                href="/admin/invites"
                className="inline-flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[#faf7f1] px-3 py-2 text-xs font-medium text-[var(--ink-soft)] hover:text-[#c85a32]"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                重置
              </Link>
            ) : null}
          </form>

          <InviteTableActions usedCount={usedCount} />
        </div>

        {/* Mobile Cards with Copy + Delete Parity */}
        <div className="grid gap-3 lg:hidden">
          {invites.map((invite) => (
            <article key={invite.id} className="studio-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="break-all font-mono text-sm font-semibold text-[var(--ink)]">
                      {invite.code}
                    </span>
                    <InviteCopyCodeBtn code={invite.code} />
                  </div>
                  <div className="mt-1 text-xs text-[var(--ink-soft)]">
                    {invite.batch?.title || "独立邀请码"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {invite.usedAt ? (
                    <span className="rounded-full bg-[#ebe5dc] px-2.5 py-0.5 text-xs font-medium text-[#57534e]">
                      已使用
                    </span>
                  ) : invite.claimedAt ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                      已发放
                    </span>
                  ) : (
                    <span className="rounded-full border border-[var(--line)] bg-[#faf7f1] px-2.5 py-0.5 text-xs text-[var(--ink-soft)]">
                      未使用
                    </span>
                  )}
                  <InviteDeleteBtn inviteId={invite.id} code={invite.code} />
                </div>
              </div>
              <div className="mt-3 grid gap-1 text-xs text-[var(--ink-soft)]">
                <p>备注：{invite.note || "—"}</p>
                <p>注册账号：{invite.usedBy?.email || "—"}</p>
              </div>
            </article>
          ))}
          {invites.length === 0 ? (
            <div className="studio-card p-8 text-center text-sm text-[var(--ink-soft)]">
              暂无符合筛选条件的邀请码。
            </div>
          ) : null}
        </div>

        {/* Desktop Table */}
        <div className="studio-card hidden overflow-hidden lg:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--line)] text-xs text-[var(--ink-soft)]">
              <tr>
                <th className="px-5 py-3.5 font-medium">邀请码</th>
                <th className="px-5 py-3.5 font-medium">所属批次</th>
                <th className="px-5 py-3.5 font-medium">备注</th>
                <th className="px-5 py-3.5 font-medium">状态</th>
                <th className="px-5 py-3.5 font-medium">注册用户</th>
                <th className="w-24 px-5 py-3.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]/70">
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
              {invites.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-sm text-[var(--ink-soft)]"
                  >
                    暂无符合筛选条件的邀请码。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <AdminPagination
          currentPage={page}
          totalPages={totalPages}
          basePath="/admin/invites"
          extraParams={extraParams}
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
    <tr className="transition-colors hover:bg-[#faf6ee]/80">
      <td className="px-5 py-3.5 font-mono font-semibold text-[var(--ink)]">
        {invite.code}
      </td>
      <td className="px-5 py-3.5 text-xs text-[var(--ink-soft)]">
        {invite.batch?.title || "独立邀请码"}
        {invite.batch ? (
          <span className="ml-2 rounded-full border border-[var(--line)] bg-[#faf7f1] px-2 py-0.5 text-[11px]">
            {invite.batch.isPublic ? "公开中" : "未公开"}
          </span>
        ) : null}
      </td>
      <td className="px-5 py-3.5 text-xs text-[var(--ink-soft)]">
        {invite.note || "—"}
      </td>
      <td className="px-5 py-3.5">
        {invite.usedAt ? (
          <span className="rounded-full bg-[#ebe5dc] px-2.5 py-0.5 text-xs font-medium text-[#57534e]">
            已使用
          </span>
        ) : invite.claimedAt ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            已发放
          </span>
        ) : (
          <span className="rounded-full border border-[var(--line)] bg-[#faf7f1] px-2.5 py-0.5 text-xs text-[var(--ink-soft)]">
            未使用
          </span>
        )}
      </td>
      <td className="px-5 py-3.5 font-mono text-xs text-[var(--ink-soft)]">
        {invite.usedByEmail || "—"}
      </td>
      <td className="px-5 py-3.5 text-right">
        <div className="inline-flex items-center justify-end gap-1">
          <InviteCopyCodeBtn code={invite.code} />
          <InviteDeleteBtn inviteId={invite.id} code={invite.code} />
        </div>
      </td>
    </tr>
  );
}
