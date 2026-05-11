"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Download, Gift, Power, Trash2 } from "lucide-react";

type RedeemMode = "single_use" | "shared";

export function RedeemCodeCreator() {
  const router = useRouter();
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
    await navigator.clipboard.writeText(codes.map((c) => c.code).join("\n"));
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: mode === "shared" ? code : null,
        count,
        isActive,
        maxRedemptions,
        mode,
        note,
        rewardCredits,
      }),
    });
    const result = (await response.json()) as {
      data?: {
        codes: Array<{ code: string; id: string }>;
      };
      error?: string;
    };

    if (!response.ok) {
      setError(result.error || "创建失败");
      return;
    }

    setCreatedCodes(result.data?.codes ?? []);
    if (mode === "shared") setCode("");
    startTransition(() => router.refresh());
  }

  return (
    <section className="studio-card rounded-[1.8rem] p-5 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ink)]">创建兑换码</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            单次码适合批量发放，共享码适合活动口令。
          </p>
        </div>
        <div className="inline-flex rounded-full bg-[var(--surface-strong)] p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("single_use")}
            className={`rounded-full px-4 py-2 ${mode === "single_use" ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)]"}`}
          >
            批量单次码
          </button>
          <button
            type="button"
            onClick={() => setMode("shared")}
            className={`rounded-full px-4 py-2 ${mode === "shared" ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)]"}`}
          >
            共享限次码
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="备注，例如：五一活动"
          className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
        />
        <input
          type="number"
          min={1}
          max={100000}
          value={rewardCredits}
          onChange={(event) => setRewardCredits(Number(event.target.value))}
          className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
          title="兑换积分"
        />
        {mode === "single_use" ? (
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
            title="生成数量"
          />
        ) : (
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="自定义口令，留空自动生成"
            className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm uppercase outline-none focus:border-[var(--accent)]"
          />
        )}
        {mode === "shared" ? (
          <input
            type="number"
            min={1}
            max={100000}
            value={maxRedemptions}
            onChange={(event) => setMaxRedemptions(Number(event.target.value))}
            className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
            title="可兑换次数"
          />
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-soft)]">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          创建后立即启用
        </label>
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(handleCreate)}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-[var(--accent)] disabled:opacity-60"
        >
          <Gift className="size-4" />
          {isPending ? "创建中..." : "创建兑换码"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
      {createdCodes.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)]/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-[var(--ink)]">
              已创建 {createdCodes.length} 个兑换码
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(createdCodes)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Copy className="size-3.5" />
                {copySuccess ? "已复制" : "复制全部"}
              </button>
              <button
                type="button"
                onClick={() => handleDownload(createdCodes)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Download className="size-3.5" />
                下载 .txt
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {createdCodes.slice(0, 12).map((item) => (
              <span key={item.id} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--ink)]">
                {item.code}
              </span>
            ))}
            {createdCodes.length > 12 ? (
              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--ink-soft)]">
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
  const [isPending, startTransition] = useTransition();

  async function handleToggle() {
    await fetch(`/api/admin/redeem-codes/batches/${batchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(handleToggle)}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium ${
        isActive
          ? "bg-[var(--accent)] text-white"
          : "border border-[var(--line)] text-[var(--ink-soft)]"
      }`}
    >
      <Power className="size-3.5" />
      {isPending ? "处理中..." : isActive ? "停用" : "启用"}
    </button>
  );
}

export function RedeemBatchDownload({ batchId }: { batchId: string }) {
  return (
    <a
      href={`/api/admin/redeem-codes/batches/${batchId}/export`}
      download
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
    >
      <Download className="size-3.5" />
      下载 .txt
    </a>
  );
}

export function RedeemBatchCopy({ batchId }: { batchId: string }) {
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleCopy() {
    const res = await fetch(`/api/admin/redeem-codes/batches/${batchId}/export`);
    if (!res.ok) {
      alert("获取兑换码失败");
      return;
    }
    const text = await res.text();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      disabled={isPending || copied}
      onClick={() => startTransition(handleCopy)}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
      title="复制本批次所有兑换码"
    >
      <Copy className="size-3.5" />
      {copied ? "已复制" : isPending ? "复制中..." : "复制批次"}
    </button>
  );
}

export function RedeemBatchDelete({
  batchId,
  total,
  remaining,
}: {
  batchId: string;
  total: number;
  remaining: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleDelete() {
    const used = Math.max(0, total - remaining);
    const message =
      used > 0
        ? `确定要删除整个批次吗？共 ${total} 个兑换码（其中 ${used} 次已被兑换），所有兑换码与兑换记录都会被清除，不可恢复。`
        : `确定要删除整个批次吗？共 ${total} 个兑换码将被一并清除，且不可恢复。`;
    if (!confirm(message)) return;

    const response = await fetch(`/api/admin/redeem-codes/batches/${batchId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      alert(result?.error || "删除失败");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(handleDelete)}
      className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
      title="删除整个批次"
    >
      <Trash2 className="size-3.5" />
      {isPending ? "删除中..." : "删除批次"}
    </button>
  );
}
