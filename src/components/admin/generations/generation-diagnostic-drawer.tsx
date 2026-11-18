"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Cpu,
  KeyRound,
  Loader2,
  ShieldAlert,
  User as UserIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useAdminToast } from "../hooks/use-admin-toast";
import { AdminDrawer } from "../ui/admin-drawer";

type DiagnosticAttempt = {
  completedAt: string | null;
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  idempotencyKey: string;
  model: string;
  nextRetryAt: string | null;
  operation: string;
  ordinal: number;
  providerChannelId: string | null;
  providerRequestId: string | null;
  status: string;
  updatedAt: string;
  upstreamSubmittedAt: string | null;
  workerId: string;
};

type GenerationDiagnosticData = {
  apiKey: { id: string; keyPrefix: string; name: string } | null;
  aspectRatio: string | null;
  attemptCount: number;
  attempts: DiagnosticAttempt[];
  cancelRequestedAt: string | null;
  channel: { id: string; name: string; slug: string } | null;
  clientSource: string;
  completedAt: string | null;
  contractVersion: number;
  conversationId: string | null;
  count: number;
  createdAt: string;
  creditsSpent: number;
  durationSeconds: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  generationType: string;
  handoffState: string | null;
  id: string;
  lockedAt: string | null;
  model: string;
  moderation: string;
  negativePrompt: string | null;
  nextAttemptAt: string | null;
  outputCompression: number | null;
  outputFormat: string;
  prompt: string;
  providerBaseUrl: string | null;
  providerChannelId: string | null;
  providerLabel: string | null;
  providerMode: string;
  quality: string;
  refundAppliedAt: string | null;
  seed: number | null;
  size: string;
  startedAt: string | null;
  status: string;
  updatedAt: string;
  user: {
    credits: number;
    email: string;
    id: string;
    nickname: string | null;
  };
  workerId: string | null;
  workerManaged: boolean;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatDurationMs(startIso: string | null, endIso: string | null) {
  if (!startIso || !endIso) return "—";
  const ms = Math.max(0, Date.parse(endIso) - Date.parse(startIso));
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function buildPlainTextReport(job: GenerationDiagnosticData) {
  const lines = [
    `=== Narra Generation Diagnostic Report ===`,
    `Job ID: ${job.id}`,
    `Status: ${job.status} | Handoff: ${job.handoffState ?? "NONE"} | Contract: v${job.contractVersion}`,
    `User: ${job.user.email} (${job.user.id})`,
    `Source: ${job.clientSource}${job.apiKey ? ` (Key: ${job.apiKey.keyPrefix}...)` : ""}`,
    `Type / Model: ${job.generationType} / ${job.model}`,
    `Provider: ${job.providerMode}${job.channel ? ` (${job.channel.name} / ${job.channel.slug})` : ""}`,
    `Credits: spent=${job.creditsSpent}, refundedAt=${job.refundAppliedAt ?? "null"}`,
    `Created: ${job.createdAt} | Started: ${job.startedAt ?? "null"} | Completed: ${job.completedAt ?? "null"}`,
    `Error: [${job.errorCode ?? "NONE"}] ${job.errorMessage ?? "null"}`,
    `Attempts (${job.attempts.length}):`,
    ...job.attempts.map(
      (a) =>
        `  #${a.ordinal} [${a.status}] worker=${a.workerId} reqId=${a.providerRequestId ?? "-"} submitted=${a.upstreamSubmittedAt ?? "-"} completed=${a.completedAt ?? "-"} err=${a.errorCode ?? "-"}:${a.errorMessage ?? "-"}`,
    ),
  ];
  return lines.join("\n");
}

type GenerationDiagnosticDrawerProps = {
  jobId: string | null;
  onClose: () => void;
};

export function GenerationDiagnosticDrawer({
  jobId,
  onClose,
}: GenerationDiagnosticDrawerProps) {
  const toast = useAdminToast();
  const [fetched, setFetched] = useState<{
    detail: GenerationDiagnosticData | null;
    error: string | null;
    forJobId: string;
  } | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);

  useEffect(() => {
    if (!jobId) return;

    let active = true;
    async function load(targetId: string) {
      try {
        const res = await fetch(`/api/admin/generations/${targetId}`, {
          credentials: "same-origin",
        });
        const json = (await res.json().catch(() => ({}))) as {
          data?: { job?: GenerationDiagnosticData };
          error?: string;
        };
        if (!active) return;
        if (!res.ok || !json.data?.job) {
          setFetched({
            detail: null,
            error: json.error || "加载任务排障详情失败",
            forJobId: targetId,
          });
          return;
        }
        setFetched({
          detail: json.data.job,
          error: null,
          forJobId: targetId,
        });
      } catch (err) {
        if (active) {
          setFetched({
            detail: null,
            error: err instanceof Error ? err.message : "网络请求异常",
            forJobId: targetId,
          });
        }
      }
    }

    void load(jobId);
    return () => {
      active = false;
    };
  }, [jobId]);

  const loading = jobId !== null && fetched?.forJobId !== jobId;
  const error = jobId !== null && fetched?.forJobId === jobId ? fetched.error : null;
  const detail = jobId !== null && fetched?.forJobId === jobId ? fetched.detail : null;

  const isCoordinationRequired =
    detail !== null &&
    detail.contractVersion >= 1 &&
    (detail.handoffState === "UNKNOWN" || detail.errorCode === "HANDOFF_UNKNOWN");

  async function handleCopyReport() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(buildPlainTextReport(detail));
      setCopiedReport(true);
      toast.success("排障摘要已复制", "可直接粘贴至工单或上游渠道核对");
      setTimeout(() => setCopiedReport(false), 2000);
    } catch {
      toast.error("复制排障摘要失败");
    }
  }

  async function handleCopyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}已复制`, text);
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <AdminDrawer
      open={jobId !== null}
      onClose={onClose}
      width="lg"
      eyebrow="GENERATION DIAGNOSTICS"
      title={detail ? `任务排障 · ${detail.id.slice(0, 12)}…` : "任务排障详情"}
      description="只读诊断视图：完整保留 Worker 契约状态、计费结算状态与上游重试轨迹。"
      footer={
        detail ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-xs text-[var(--ink-soft)]">
              契约版本 v{detail.contractVersion} · {detail.workerManaged ? "Worker 托管" : "内联执行"}
            </span>
            <button
              type="button"
              onClick={() => void handleCopyReport()}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#c25934] px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a]"
            >
              {copiedReport ? (
                <Check className="size-3.5 text-emerald-300" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
              {copiedReport ? "已复制排障摘要" : "一键复制排障摘要"}
            </button>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--ink-soft)]">
          <Loader2 className="size-5 animate-spin text-[#c85a32]" aria-hidden />
          <span>正在读取任务与重试轨迹…</span>
        </div>
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : detail ? (
        <div className="grid gap-5">
          {/* Worker v1 Coordination Guard Banner */}
          {isCoordinationRequired ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50/90 p-4 text-amber-950">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    需人工协调（HANDOFF_UNKNOWN 契约保护态）
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
                    该任务可能已提交至上游渠道，但在回写结果前失联或超时。根据 Worker v1
                    安全契约，系统保留扣费与重试证据，禁止自动退分或物理删除。请结合下方{" "}
                    <code className="rounded bg-amber-100 px-1 font-mono">
                      providerRequestId
                    </code>{" "}
                    与上游账单核对后，前往用户管理页执行人工积分补偿。
                  </p>
                  <div className="mt-3">
                    <Link
                      href={`/admin/users?q=${encodeURIComponent(detail.user.email)}`}
                      onClick={onClose}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-800"
                    >
                      前往调整该用户积分
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Upstream Error Block */}
          {detail.errorCode || detail.errorMessage ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50/75 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-800">
                  <AlertTriangle className="size-4" aria-hidden />
                  错误诊断摘要
                </span>
                {detail.errorCode ? (
                  <span className="rounded-md border border-rose-300 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-rose-700">
                    {detail.errorCode}
                  </span>
                ) : null}
              </div>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/90 p-3 font-mono text-xs leading-relaxed text-rose-900">
                {detail.errorMessage || "未记录详细错误文本"}
              </pre>
            </div>
          ) : null}

          {/* Summary KPI Grid */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border border-[var(--line)] bg-white p-3">
              <div className="text-[11px] text-[var(--ink-soft)]">执行状态</div>
              <div className="mt-1 font-mono text-sm font-semibold text-[var(--ink)]">
                {detail.status}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
                交接：{detail.handoffState ?? "正常"}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-white p-3">
              <div className="text-[11px] text-[var(--ink-soft)]">积分结算</div>
              <div className="mt-1 font-mono text-sm font-semibold text-[var(--admin-ink-credit)]">
                {detail.creditsSpent} 积分
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
                {detail.refundAppliedAt ? "已自动退还" : "未触发退还"}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-white p-3">
              <div className="text-[11px] text-[var(--ink-soft)]">端到端耗时</div>
              <div className="mt-1 font-mono text-sm font-semibold text-[var(--ink)]">
                {formatDurationMs(
                  detail.startedAt ?? detail.createdAt,
                  detail.completedAt,
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
                重试 {detail.attempts.length} 次
              </div>
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-white p-3">
              <div className="text-[11px] text-[var(--ink-soft)]">调用入口</div>
              <div className="mt-1 font-mono text-sm font-semibold text-[var(--ink)]">
                {detail.clientSource}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-[var(--ink-soft)]">
                {detail.apiKey ? `${detail.apiKey.keyPrefix}…` : "网页会话"}
              </div>
            </div>
          </div>

          {/* GenerationAttempt Timeline */}
          <section className="rounded-xl border border-[var(--line)] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">
                <Cpu className="size-4 text-[#c85a32]" aria-hidden />
                Worker 重试与上游交接轨迹（{detail.attempts.length}）
              </h3>
              {detail.workerId ? (
                <span className="font-mono text-[11px] text-[var(--ink-soft)]">
                  最近 Worker：{detail.workerId}
                </span>
              ) : null}
            </div>

            {detail.attempts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--line)] bg-[#faf7f1] px-4 py-6 text-center text-xs text-[var(--ink-soft)]">
                暂无 GenerationAttempt 记录（旧版内联任务或尚未被 Worker 认领）。
              </div>
            ) : (
              <div className="space-y-2.5">
                {detail.attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="rounded-xl border border-[var(--line)] bg-[#faf7f1]/75 p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-[#e5dec9] bg-white px-2 py-0.5 font-mono font-semibold text-[#292524]">
                          #{attempt.ordinal}
                        </span>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold",
                            attempt.status === "SUCCEEDED"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : attempt.status === "FAILED" ||
                                  attempt.status === "TIMED_OUT"
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-amber-200 bg-amber-50 text-amber-800",
                          )}
                        >
                          {attempt.status}
                        </span>
                        <span className="font-mono text-[var(--ink-soft)]">
                          {attempt.operation} · {attempt.model}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-[var(--ink-soft)]">
                        耗时 {formatDurationMs(attempt.createdAt, attempt.completedAt)}
                      </span>
                    </div>

                    <div className="mt-2 grid gap-1.5 text-[11px] text-[var(--ink-soft)] sm:grid-cols-2">
                      <div>
                        Worker：<span className="font-mono text-[var(--ink)]">{attempt.workerId}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span>上游请求 ID：</span>
                        {attempt.providerRequestId ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyText(
                                "上游请求 ID",
                                attempt.providerRequestId!,
                              )
                            }
                            className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 font-mono text-[var(--ink)] hover:text-[#c85a32]"
                          >
                            <span className="max-w-[160px] truncate">
                              {attempt.providerRequestId}
                            </span>
                            <Copy className="size-3" aria-hidden />
                          </button>
                        ) : (
                          <span>—</span>
                        )}
                      </div>
                      <div>认领时间：{formatDateTime(attempt.createdAt)}</div>
                      <div>
                        提交上游：{formatDateTime(attempt.upstreamSubmittedAt)}
                      </div>
                    </div>

                    {attempt.errorCode || attempt.errorMessage ? (
                      <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/80 px-2.5 py-1.5 font-mono text-[11px] text-rose-800">
                        {attempt.errorCode ? `[${attempt.errorCode}] ` : ""}
                        {attempt.errorMessage}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Context & Metadata */}
          <section className="rounded-xl border border-[var(--line)] bg-white p-4 text-xs">
            <h3 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">
              <Clock className="size-4 text-[#c85a32]" aria-hidden />
              上下文与参数快照
            </h3>

            <dl className="grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-lg bg-[#faf7f1] p-2.5">
                <dt className="inline-flex items-center gap-1 text-[var(--ink-soft)]">
                  <UserIcon className="size-3.5" aria-hidden />
                  发起用户
                </dt>
                <dd className="mt-1 font-medium text-[var(--ink)]">
                  {detail.user.nickname || "未设昵称"}（{detail.user.email}）
                  <span className="ml-2 font-mono text-[var(--admin-ink-credit)]">
                    当前余额 {detail.user.credits}
                  </span>
                </dd>
              </div>

              <div className="rounded-lg bg-[#faf7f1] p-2.5">
                <dt className="inline-flex items-center gap-1 text-[var(--ink-soft)]">
                  <KeyRound className="size-3.5" aria-hidden />
                  渠道与路由
                </dt>
                <dd className="mt-1 font-medium text-[var(--ink)]">
                  {detail.providerMode === "BUILT_IN" ? "内置渠道" : "用户自填渠道"}
                  {detail.channel
                    ? ` · ${detail.channel.name} (${detail.channel.slug})`
                    : detail.providerLabel
                      ? ` · ${detail.providerLabel}`
                      : ""}
                </dd>
              </div>

              <div className="rounded-lg bg-[#faf7f1] p-2.5">
                <dt className="text-[var(--ink-soft)]">任务 ID（点击复制）</dt>
                <dd className="mt-1">
                  <button
                    type="button"
                    onClick={() => void handleCopyText("任务 ID", detail.id)}
                    className="inline-flex items-center gap-1 font-mono text-[var(--ink)] hover:text-[#c85a32]"
                  >
                    {detail.id}
                    <Copy className="size-3" aria-hidden />
                  </button>
                </dd>
              </div>

              <div className="rounded-lg bg-[#faf7f1] p-2.5">
                <dt className="text-[var(--ink-soft)]">规格参数</dt>
                <dd className="mt-1 font-mono text-[var(--ink)]">
                  {detail.generationType} · {detail.size} · 数量 {detail.count}
                  {detail.aspectRatio ? ` · ${detail.aspectRatio}` : ""}
                  {detail.durationSeconds ? ` · ${detail.durationSeconds}s` : ""}
                </dd>
              </div>

              <div className="rounded-lg bg-[#faf7f1] p-2.5">
                <dt className="text-[var(--ink-soft)]">创建 / 开始 / 完成时间</dt>
                <dd className="mt-1 font-mono text-[11px] text-[var(--ink)]">
                  <div>创：{formatDateTime(detail.createdAt)}</div>
                  <div>始：{formatDateTime(detail.startedAt)}</div>
                  <div>完：{formatDateTime(detail.completedAt)}</div>
                </dd>
              </div>

              <div className="rounded-lg bg-[#faf7f1] p-2.5">
                <dt className="text-[var(--ink-soft)]">退款记录时间</dt>
                <dd className="mt-1 font-mono text-[var(--ink)]">
                  {formatDateTime(detail.refundAppliedAt)}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      ) : null}
    </AdminDrawer>
  );
}
