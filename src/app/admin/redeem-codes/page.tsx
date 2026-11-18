import { RedeemCodeMode, type Prisma } from "@prisma/client";
import { Gift, RotateCcw, Search, X } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminPagination } from "@/components/admin/admin-pagination";
import {
  RedeemBatchCopy,
  RedeemBatchDelete,
  RedeemBatchDownload,
  RedeemBatchToggle,
  RedeemBatchViewButton,
  RedeemCodeCreator,
} from "@/components/admin/redeem-code-manager";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

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

export default async function AdminRedeemCodesPage(props?: {
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
    params.status === "active" || params.status === "inactive"
      ? params.status
      : "";

  const activeCondition: Prisma.RedeemCodeWhereInput = {
    OR: [{ batchId: null }, { batch: { isActive: true } }],
    isActive: true,
  };

  const inactiveCondition: Prisma.RedeemCodeWhereInput = {
    OR: [{ isActive: false }, { batch: { isActive: false } }],
  };

  const codeClauses: Prisma.RedeemCodeWhereInput[] = [];
  if (q) {
    codeClauses.push({
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } },
        { batch: { is: { title: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  if (status === "active") {
    codeClauses.push(activeCondition);
  } else if (status === "inactive") {
    codeClauses.push(inactiveCondition);
  }

  const codeWhere: Prisma.RedeemCodeWhereInput =
    codeClauses.length === 0
      ? {}
      : codeClauses.length === 1
        ? codeClauses[0]!
        : { AND: codeClauses };

  const [
    batches,
    codes,
    filteredCount,
    redemptions,
    totalCodes,
    activeCodes,
    totalRedemptions,
  ] = await Promise.all([
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
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      where: codeWhere,
    }),
    db.redeemCode.count({ where: codeWhere }),
    db.redeemRedemption.findMany({
      include: {
        code: { select: { code: true, mode: true } },
        user: { select: { email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.redeemCode.count(),
    db.redeemCode.count({ where: activeCondition }),
    db.redeemRedemption.count(),
  ]);

  const totalPages = Math.ceil(filteredCount / PAGE_SIZE);
  const extraParams: Record<string, string> = {};
  if (q) extraParams.q = q;
  if (status) extraParams.status = status;

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Redeem Codes"
          icon={Gift}
          title="兑换码与批次管理"
          description="发行可兑换积分的活动口令或定向单次码，支持按批次查看明细、一键复制导出及启停控制。"
        />

        <div className="grid gap-4 md:grid-cols-3">
          {[
            { hint: "累计发行的单次码与共享口令", label: "兑换码总数", value: totalCodes },
            {
              hint: "自身启用且所属批次未停用",
              label: "启用中的兑换码",
              value: activeCodes,
            },
            {
              hint: "全站用户累计成功核销人次",
              label: "累计兑换人次",
              value: totalRedemptions,
            },
          ].map((stat) => (
            <div key={stat.label} className="studio-card p-5">
              <div className="text-xs font-medium text-[var(--ink-soft)]">
                {stat.label}
              </div>
              <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-[var(--ink)]">
                {stat.value.toLocaleString("zh-CN")}
              </div>
              <div className="mt-1 text-xs text-[var(--ink-soft)]">{stat.hint}</div>
            </div>
          ))}
        </div>

        <RedeemCodeCreator />

        {batches.length > 0 ? (
          <section className="grid gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-[var(--ink-soft)]">
              最近发行批次（{batches.length}）
            </h2>
            {batches.map((batch) => {
              const remaining = batch.codes.reduce(
                (sum, code) =>
                  sum + Math.max(0, code.maxRedemptions - code.redeemedCount),
                0,
              );
              return (
                <article
                  key={batch.id}
                  className="studio-card grid gap-4 p-4 md:p-5 xl:grid-cols-[1.2fr_0.55fr_0.55fr_auto]"
                >
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-soft)]">
                      {formatMode(batch.mode)}
                    </div>
                    <h3 className="mt-1.5 text-lg font-semibold text-[var(--ink)]">
                      {batch.title || "未命名批次"}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      创建于 {formatTime(batch.createdAt)} · 每次{" "}
                      <span className="font-mono font-semibold text-[var(--admin-ink-credit)]">
                        +{batch.rewardCredits}
                      </span>{" "}
                      积分
                    </p>
                  </div>

                  <div>
                    <div className="text-xs text-[var(--ink-soft)]">批次码数</div>
                    <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[var(--ink)]">
                      {batch.codes.length}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-[var(--ink-soft)]">剩余可兑人次</div>
                    <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[var(--admin-ink-credit)]">
                      {remaining}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
                    <RedeemBatchViewButton batchId={batch.id} title={batch.title} />
                    <RedeemBatchCopy batchId={batch.id} />
                    <RedeemBatchDownload batchId={batch.id} />
                    <RedeemBatchToggle batchId={batch.id} isActive={batch.isActive} />
                    <RedeemBatchDelete
                      batchId={batch.id}
                      total={batch.codes.length}
                      remaining={remaining}
                    />
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="grid content-start gap-4">
            <section className="studio-card overflow-hidden">
              <div className="border-b border-[var(--line)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-[var(--ink)]">
                    兑换码明细列表
                  </h2>
                  <span className="text-xs text-[var(--ink-soft)]">
                    匹配 {filteredCount} 条记录
                  </span>
                </div>

                <form
                  action="/admin/redeem-codes"
                  method="get"
                  className="mt-3 flex flex-wrap items-center gap-2"
                >
                  <div className="relative min-w-[200px] flex-1">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-soft)]"
                      aria-hidden
                    />
                    <input
                      key={q}
                      name="q"
                      defaultValue={q}
                      placeholder="搜索码值、备注或批次名称…"
                      className="w-full rounded-xl border border-[var(--admin-line)] bg-white py-2 pr-8 pl-9 text-xs outline-none sm:text-sm"
                    />
                    {q ? (
                      <Link
                        href={
                          status
                            ? `/admin/redeem-codes?status=${status}`
                            : "/admin/redeem-codes"
                        }
                        aria-label="清空兑换码搜索"
                        className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)]"
                      >
                        <X className="size-3.5" aria-hidden />
                      </Link>
                    ) : null}
                  </div>

                  <select
                    name="status"
                    defaultValue={status}
                    aria-label="按兑换码状态筛选"
                    className="rounded-xl border border-[var(--admin-line)] bg-white px-3 py-2 text-xs font-medium text-[var(--ink)] outline-none sm:text-sm"
                  >
                    <option value="">全部状态</option>
                    <option value="active">仅启用中</option>
                    <option value="inactive">已停用</option>
                  </select>

                  <button
                    type="submit"
                    className="rounded-xl bg-[#c25934] px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a] sm:text-sm"
                  >
                    筛选
                  </button>

                  {q || status ? (
                    <Link
                      href="/admin/redeem-codes"
                      className="inline-flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[#faf7f1] px-3 py-2 text-xs font-medium text-[var(--ink-soft)] hover:text-[#c85a32]"
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      重置
                    </Link>
                  ) : null}
                </form>
              </div>

              {/* Mobile Cards */}
              <div className="grid gap-2.5 p-3 md:hidden">
                {codes.map((code) => {
                  const effectiveActive =
                    code.isActive && code.batch?.isActive !== false;
                  return (
                    <article
                      key={code.id}
                      className="rounded-xl border border-[var(--line)] bg-[#faf7f1]/70 p-3.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold text-[var(--ink)]">
                          {code.code}
                        </span>
                        <span
                          className={
                            effectiveActive
                              ? "rounded-full bg-emerald-100 px-2.5 py-0.5 font-semibold text-emerald-800"
                              : "rounded-full bg-stone-200 px-2.5 py-0.5 font-medium text-stone-600"
                          }
                        >
                          {effectiveActive ? "启用" : "停用"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[var(--ink-soft)]">
                        <span>
                          {formatMode(code.mode)} ·{" "}
                          {code.batch?.title || code.note || "独立发行"}
                        </span>
                        <span className="font-mono font-semibold text-[var(--admin-ink-credit)]">
                          +{code.rewardCredits}（{code.redeemedCount}/
                          {code.maxRedemptions}）
                        </span>
                      </div>
                    </article>
                  );
                })}
                {codes.length === 0 ? (
                  <p className="py-8 text-center text-xs text-[var(--ink-soft)]">
                    暂无符合条件的兑换码。
                  </p>
                ) : null}
              </div>

              {/* Desktop Table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-[var(--line)] text-xs text-[var(--ink-soft)]">
                    <tr>
                      <th className="px-4 py-3.5 font-medium">兑换码 / 批次</th>
                      <th className="px-4 py-3.5 font-medium">类型</th>
                      <th className="px-4 py-3.5 font-medium">奖励积分</th>
                      <th className="px-4 py-3.5 font-medium">核销进度</th>
                      <th className="px-4 py-3.5 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]/70">
                    {codes.map((code) => {
                      const effectiveActive =
                        code.isActive && code.batch?.isActive !== false;
                      return (
                        <tr
                          key={code.id}
                          className="transition-colors hover:bg-[#faf6ee]/80"
                        >
                          <td className="px-4 py-3.5">
                            <div className="font-mono font-semibold text-[var(--ink)]">
                              {code.code}
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--ink-soft)]">
                              {code.batch?.title || code.note || "独立兑换码"}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-[var(--ink-soft)]">
                            {formatMode(code.mode)}
                          </td>
                          <td className="px-4 py-3.5 font-mono font-semibold tabular-nums text-[var(--admin-ink-credit)]">
                            +{code.rewardCredits}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-xs tabular-nums text-[var(--ink-soft)]">
                            {code.redeemedCount} / {code.maxRedemptions}
                          </td>
                          <td className="px-4 py-3.5">
                            {effectiveActive ? (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                                启用
                              </span>
                            ) : (
                              <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-600">
                                停用
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {codes.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-10 text-center text-sm text-[var(--ink-soft)]"
                        >
                          暂无符合条件的兑换码。
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <AdminPagination
              basePath="/admin/redeem-codes"
              currentPage={page}
              totalPages={totalPages}
              extraParams={extraParams}
            />
          </div>

          <section className="studio-card h-fit p-5">
            <h2 className="text-base font-semibold text-[var(--ink)]">
              最近核销流水
            </h2>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              展示全站最新 20 条成功兑换记录。
            </p>
            <div className="mt-4 grid gap-2.5">
              {redemptions.length > 0 ? (
                redemptions.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-[var(--line)] bg-[#faf7f1]/70 px-3.5 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs font-semibold text-[var(--ink)]">
                        {item.code.code}
                      </span>
                      <span className="font-mono text-xs font-semibold text-[var(--admin-ink-credit)]">
                        +{item.rewardCredits}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-[var(--ink-soft)]">
                      {item.user.email} · {formatTime(item.createdAt)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--ink-soft)]">
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
