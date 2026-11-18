"use client";

import { Check, Copy, Download, Eye, Gift, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminConfirmDialog, AdminModal } from "./ui/admin-modal";
import { AdminSwitch } from "./ui/admin-switch";
import { AdminTabs, type AdminTabOption } from "./ui/admin-tabs";

type RedeemMode = "single_use" | "shared";

const MODE_OPTIONS: AdminTabOption<RedeemMode>[] = [
  { label: "批量单次码", value: "single_use" },
  { label: "共享限次口令", value: "shared" },
];

export function RedeemCodeCreator() {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<RedeemMode>("single_use");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [count, setCount] = useState(10);
  const [maxRedemptions, setMaxRedemptions] = useState(100);
  const [rewardCredits, setRewardCredits] = useState(50);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdCodes, setCreatedCodes] = useState<Array<{ code: string; id: string }>>([]);
  const [copySuccess, setCopySuccess] = useState(false);

  async function handleCopy(codes: Array<{ code: string }>) {
    try {
      await navigator.clipboard.writeText(codes.map((c) => c.code).join("\n"));
      setCopySuccess(true);
      toast.success("已复制兑换码", `共复制 ${codes.length} 个兑换码`);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      toast.error("复制失败", "请使用下载 .txt 功能导出");
    }
  }

  function handleDownload(codes: Array<{ code: string }>) {
    const text = codes.map((c) => c.code).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `redeem-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleCreate() {
    setError(null);
    setCreatedCodes([]);

    const response = await fetch("/api/admin/redeem-codes", {
      body: JSON.stringify({
        code: mode === "shared" ? code : null,
        count,
        isActive,
        maxRedemptions,
        mode,
        note,
        rewardCredits,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as {
      data?: {
        codes: Array<{ code: string; id: string }>;
      };
      error?: string;
    };

    if (!response.ok) {
      const msg = result.error || "创建失败";
      setError(msg);
      toast.error("兑换码创建失败", msg);
      return;
    }

    const list = result.data?.codes ?? [];
    setCreatedCodes(list);
    if (mode === "shared") setCode("");
    toast.success("兑换码已发行", `成功创建 ${list.length} 个兑换码，每次 +${rewardCredits} 积分`);
    startTransition(() => router.refresh());
  }

  return (
    <section className="studio-card p-5 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">发行积分兑换码</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            批量单次码适合定向私发，共享限次码适合社区活动口令。
          </p>
        </div>
        <AdminTabs
          ariaLabel="兑换码发行模式"
          layoutId="redeem-creator-mode"
          options={MODE_OPTIONS}
          value={mode}
          onChange={setMode}
        />
      </div>

      <div className="mt-5 grid gap-3.5 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--ink-soft)]">批次名称 / 活动备注</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：五一社区福利"
            className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--ink-soft)]">单次奖励积分</span>
          <input
            type="number"
            min={1}
            max={100000}
            value={rewardCredits}
            onChange={(event) => setRewardCredits(Number(event.target.value))}
            className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm font-semibold tabular-nums outline-none"
          />
        </label>

        {mode === "single_use" ? (
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-[var(--ink-soft)]">生成码数量（1 - 100）</span>
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm font-semibold tabular-nums outline-none"
            />
          </label>
        ) : (
          <>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[var(--ink-soft)]">自定义口令（选填）</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="留空自动生成随机码"
                className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm uppercase outline-none"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[var(--ink-soft)]">最大可兑换总人次</span>
              <input
                type="number"
                min={1}
                max={100000}
                value={maxRedemptions}
                onChange={(event) => setMaxRedemptions(Number(event.target.value))}
                className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm font-semibold tabular-nums outline-none"
              />
            </label>
          </>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
        <div className="flex items-center gap-3">
          <AdminSwitch
            ariaLabel="创建后立即启用"
            checked={isActive}
            onCheckedChange={setIsActive}
          />
          <span className="text-sm text-[var(--ink)]">创建后立即生效可兑</span>
        </div>

        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => void handleCreate())}
          className="inline-flex items-center gap-2 rounded-full bg-[#c25934] px-5 py-2.5 text-sm font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a] disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Gift className="size-4" aria-hidden />
          )}
          {isPending ? "生成中…" : "生成兑换码"}
        </button>
      </div>

      {error ? (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      {createdCodes.length > 0 ? (
        <div className="mt-4 rounded-xl border border-emerald-200/90 bg-emerald-50/55 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-emerald-900">
              已创建 {createdCodes.length} 个兑换码
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopy(createdCodes)}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50"
              >
                <Copy className="size-3.5" aria-hidden />
                {copySuccess ? "已复制" : "复制全部"}
              </button>
              <button
                type="button"
                onClick={() => handleDownload(createdCodes)}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50"
              >
                <Download className="size-3.5" aria-hidden />
                下载 .txt
              </button>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {createdCodes.slice(0, 12).map((item) => (
              <span
                key={item.id}
                className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 font-mono text-xs font-semibold text-[var(--ink)]"
              >
                {item.code}
              </span>
            ))}
            {createdCodes.length > 12 ? (
              <span className="rounded-lg bg-white/70 px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                另有 {createdCodes.length - 12} 个
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function RedeemBatchToggle({
  batchId,
  isActive,
}: {
  batchId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();

  async function handleToggle(nextActive: boolean) {
    const response = await fetch(`/api/admin/redeem-codes/batches/${batchId}`, {
      body: JSON.stringify({ isActive: nextActive }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      toast.error("切换批次状态失败", result.error || "请稍后再试");
      return;
    }
    toast.success(nextActive ? "兑换批次已启用" : "兑换批次已停用");
    startTransition(() => router.refresh());
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-3 py-1.5">
      <span
        className={cn(
          "text-xs font-medium",
          isActive ? "text-emerald-700" : "text-[var(--ink-soft)]",
        )}
      >
        {isActive ? "启用中" : "已停用"}
      </span>
      <AdminSwitch
        size="sm"
        ariaLabel={isActive ? "停用兑换批次" : "启用兑换批次"}
        checked={isActive}
        disabled={isPending}
        onCheckedChange={(next) => startTransition(() => void handleToggle(next))}
      />
    </div>
  );
}

export function RedeemBatchDownload({ batchId }: { batchId: string }) {
  return (
    <a
      href={`/api/admin/redeem-codes/batches/${batchId}/export`}
      download
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
    >
      <Download className="size-3.5" aria-hidden />
      导出 .txt
    </a>
  );
}

export function RedeemBatchCopy({ batchId }: { batchId: string }) {
  const toast = useAdminToast();
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleCopy() {
    const res = await fetch(`/api/admin/redeem-codes/batches/${batchId}/export`);
    if (!res.ok) {
      toast.error("获取兑换码失败", "请检查批次是否仍有可复制兑换码");
      return;
    }
    const text = await res.text();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("批次兑换码已复制");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败", "请改用导出 .txt 下载");
    }
  }

  return (
    <button
      type="button"
      disabled={isPending || copied}
      onClick={() => startTransition(() => void handleCopy())}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32] disabled:opacity-60"
      title="复制本批次所有兑换码"
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {copied ? "已复制" : isPending ? "复制中…" : "复制"}
    </button>
  );
}

export function RedeemBatchDelete({
  batchId,
  remaining,
  total,
}: {
  batchId: string;
  remaining: number;
  total: number;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = Math.max(0, total - remaining);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/redeem-codes/batches/${batchId}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        const msg = result?.error || "删除失败";
        setError(msg);
        toast.error("删除兑换批次失败", msg);
        return;
      }

      setOpen(false);
      toast.success("兑换码批次已删除");
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={deleting}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
        title="删除整个批次"
      >
        <Trash2 className="size-3.5" aria-hidden />
        删除批次
      </button>

      <AdminConfirmDialog
        open={open}
        onClose={() => {
          if (!deleting) setOpen(false);
        }}
        onConfirm={() => void handleDelete()}
        busy={deleting}
        tone="danger"
        title="删除兑换码批次"
        description={
          used > 0
            ? `确定要删除整个批次吗？共 ${total} 个兑换码（已有 ${used} 人次完成兑换），删除后下属兑换码与兑换流水都会一并移除（已到账的用户积分不会扣回）。`
            : `确定要删除整个批次吗？共 ${total} 个未兑换码将被一并清除，不可恢复。`
        }
        confirmLabel={deleting ? "删除中…" : "确认删除批次"}
        error={error}
      />
    </>
  );
}

type RedeemBatchDetailCode = {
  code: string;
  id: string;
  isActive: boolean;
  maxRedemptions: number;
  redeemedCount: number;
};

type RedeemBatchDetailRedemption = {
  code: string;
  createdAt: string;
  id: string;
  rewardCredits: number;
  userEmail: string;
};

export function RedeemBatchViewButton({
  batchId,
  title,
}: {
  batchId: string;
  title: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
      >
        <Eye className="size-3.5" aria-hidden />
        查看明细
      </button>
      {open ? (
        <RedeemBatchViewModal
          batchId={batchId}
          batchTitle={title}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function RedeemBatchViewModal({
  batchId,
  batchTitle,
  onClose,
}: {
  batchId: string;
  batchTitle: string | null;
  onClose: () => void;
}) {
  const toast = useAdminToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<RedeemBatchDetailCode[]>([]);
  const [redemptions, setRedemptions] = useState<RedeemBatchDetailRedemption[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/redeem-codes/batches/${batchId}`);
        const json = (await res.json().catch(() => ({}))) as {
          data?: {
            codes: RedeemBatchDetailCode[];
            redemptions: RedeemBatchDetailRedemption[];
          };
          error?: string;
        };
        if (!active) return;
        if (!res.ok || !json.data) {
          setError(json.error || "读取批次明细失败");
          return;
        }
        setCodes(json.data.codes);
        setRedemptions(json.data.redemptions);
      } catch {
        if (active) setError("读取批次明细网络异常");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [batchId]);

  async function copyOne(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      toast.success("已复制兑换码", code);
      setTimeout(() => setCopiedCode(null), 1500);
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      size="xl"
      eyebrow="REDEEM BATCH"
      title={batchTitle || "未命名兑换批次"}
      description="点击任意剩余可用兑换码即可复制；右侧展示该批次最近兑换流水。"
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--ink-soft)]">
          <Loader2 className="size-5 animate-spin text-[#c85a32]" aria-hidden />
          <span>正在载入批次明细…</span>
        </div>
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <h4 className="mb-3 text-sm font-semibold text-[var(--ink)]">
              批次内兑换码（{codes.length}）
            </h4>
            <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto pr-1">
              {codes.map((item) => {
                const exhausted = item.redeemedCount >= item.maxRedemptions;
                const isCopied = copiedCode === item.code;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void copyOne(item.code)}
                    className={cn(
                      "flex flex-col items-start rounded-xl border p-3 text-left transition",
                      isCopied
                        ? "border-emerald-300 bg-emerald-50"
                        : exhausted
                          ? "border-[var(--line)] bg-[#f6f2ea] opacity-65"
                          : "border-[var(--line)] bg-white hover:border-[#c85a32]",
                    )}
                  >
                    <span className="font-mono text-xs font-semibold text-[var(--ink)]">
                      {item.code}
                    </span>
                    <span className="mt-1 font-mono text-[11px] text-[var(--ink-soft)]">
                      已兑 {item.redeemedCount} / {item.maxRedemptions}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-[var(--ink)]">
              最近兑换用户（{redemptions.length}）
            </h4>
            {redemptions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--line)] p-8 text-center text-xs text-[var(--ink-soft)]">
                该批次暂无兑换记录
              </div>
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {redemptions.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[#faf7f1] px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-[var(--ink)]">
                        {rec.userEmail}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-[var(--ink-soft)]">
                        码 {rec.code} · {new Date(rec.createdAt).toLocaleString("zh-CN")}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono font-semibold text-[#b54722]">
                      +{rec.rewardCredits}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </AdminModal>
  );
}
