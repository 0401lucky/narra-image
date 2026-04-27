"use client";

import type { GenerationImage, GenerationJob, User } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { X } from "lucide-react";

type GenerationAdminJob = GenerationJob & {
  images: GenerationImage[];
  user: Pick<User, "email">;
};

export function InviteCreator() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [count, setCount] = useState(1);
  const [downloadAfterCreate, setDownloadAfterCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadBatchTxt(batchId: string) {
    const exportRes = await fetch(`/api/admin/invites/batches/${batchId}/export`);
    if (!exportRes.ok) {
      throw new Error("下载邀请码文件失败");
    }
    const dispo = exportRes.headers.get("Content-Disposition") ?? "";
    const match = dispo.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? `invite-codes-${batchId}.txt`;
    const blob = await exportRes.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleCreate() {
    setError(null);
    const response = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, count, isPublic }),
    });
    const result = (await response.json()) as {
      data?: { batchId: string; claimPageUrl: string; message: string };
      error?: string;
    };

    if (!response.ok) {
      setError(result.error || "创建失败");
      return;
    }

    if (downloadAfterCreate && result.data?.batchId) {
      try {
        await downloadBatchTxt(result.data.batchId);
      } catch (err) {
        // 下载失败不阻断创建流程，提示用户后续可从批次卡片手动下载
        setError(
          err instanceof Error
            ? `${err.message}，请稍后从批次卡片手动下载`
            : "下载失败，请稍后从批次卡片手动下载",
        );
      }
    }

    setNote("");
    setIsPublic(false);
    setCount(1);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="studio-card rounded-[1.8rem] p-5 md:p-6">
      <h3 className="text-lg font-medium">创建邀请码</h3>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        建议为每个邀请码写备注，并可批量生成多个。
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="备注，例如：首批设计师"
          className="flex-1 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none transition-all focus:border-[var(--accent)]"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
          <label className="inline-flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-soft)]">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            开放领取
          </label>
          <label className="inline-flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-soft)]">
            <input
              type="checkbox"
              checked={downloadAfterCreate}
              onChange={(event) => setDownloadAfterCreate(event.target.checked)}
            />
            生成后下载 .txt
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="w-24 shrink-0 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-center outline-none transition-all focus:border-[var(--accent)]"
            title="生成数量"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(handleCreate)}
            className="shrink-0 rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-[var(--accent)] disabled:opacity-60"
          >
            {isPending ? "创建中..." : "批量生成"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}

export function InviteBatchToggle({
  batchId,
  isPublic,
}: {
  batchId: string;
  isPublic: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleToggle() {
    await fetch(`/api/admin/invites/batches/${batchId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isPublic: !isPublic,
      }),
    });

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(handleToggle)}
      className={`rounded-full px-3 py-2 text-xs font-medium ${
        isPublic
          ? "bg-[var(--accent)] text-white"
          : "border border-[var(--line)] text-[var(--ink-soft)]"
      }`}
    >
      {isPending ? "处理中..." : isPublic ? "关闭领取" : "开放领取"}
    </button>
  );
}

export function CreditAdjuster({ userId }: { userId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleAdjust() {
    setError(null);

    const response = await fetch(`/api/admin/users/${userId}/credits`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error || "调整失败");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
          className="w-24 rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(handleAdjust)}
          className="rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-soft)] disabled:opacity-60"
        >
          更新积分
        </button>
      </div>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  );
}


export function GenerationAdminCard({ job }: { job: GenerationAdminJob }) {
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <article className="studio-card flex flex-col xl:flex-row gap-5 p-5 rounded-[1.8rem]">
      {job.images && job.images[0] ? (
        <div className="shrink-0 flex justify-center">
          <img 
            src={job.images[0].url} 
            alt="Thumbnail" 
            className="size-32 xl:size-40 rounded-xl object-cover cursor-pointer hover:scale-105 transition border border-[var(--line)] shadow-sm" 
            onClick={() => setZoomedImage(job.images[0].url)}
          />
        </div>
      ) : (
        <div className="flex size-32 xl:size-40 shrink-0 mx-auto xl:mx-0 items-center justify-center rounded-xl bg-[var(--surface-strong)]/50 text-xs text-[var(--ink-soft)] border border-[var(--line)]">
          暂无图片
        </div>
      )}
      
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-[var(--ink-soft)] mb-2">
            <span className="truncate max-w-[150px]" title={job.user?.email}>{job.user?.email || "未知用户"}</span>
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded-full bg-[var(--surface-strong)] border border-[var(--line)] px-2 py-0.5">
                {job.generationType === "IMAGE_TO_IMAGE" ? "图生图" : "文生图"}
              </span>
              <span className="shrink-0 rounded-full bg-[var(--surface-strong)] border border-[var(--line)] px-2 py-0.5">
                {job.providerMode === "BUILT_IN" ? "内置渠道" : "自填渠道"}
              </span>
            </div>
          </div>
          <p className="line-clamp-2 text-sm text-[var(--ink)] leading-relaxed">
            {job.prompt}
          </p>
          {job.sourceImageUrls.length > 0 ? (
            <p className="mt-2 text-xs text-[var(--ink-soft)]">
              本条记录包含 {job.sourceImageUrls.length} 张参考图，支持追溯图生图来源。
            </p>
          ) : null}
        </div>
        
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--line)]/50">
          <button 
            type="button" 
            onClick={() => setShowPrompt(true)}
            className="text-xs text-[var(--accent)] hover:underline font-medium"
          >
            完整提示词
          </button>
          <div className="flex items-center gap-3 text-xs text-[var(--ink-soft)]">
            <span className="shrink-0 bg-[var(--surface-strong)] rounded px-1.5 py-0.5">{job.model}</span>
            <span className="shrink-0 font-medium text-[var(--accent-soft)]">-{job.creditsSpent}</span>
          </div>
        </div>
      </div>

      {zoomedImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setZoomedImage(null)}
        >
          <button 
            type="button"
            className="absolute top-6 right-6 text-white/70 transition hover:text-white hover:scale-110"
            onClick={() => setZoomedImage(null)}
            title="关闭"
          >
            <X className="size-8" />
          </button>
          <img 
            src={zoomedImage} 
            alt="Zoomed" 
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}

      {showPrompt && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowPrompt(false)}
        >
          <div 
            className="studio-card relative w-full max-w-2xl rounded-[2rem] p-6 md:p-8 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              type="button"
              className="absolute top-6 right-6 text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
              onClick={() => setShowPrompt(false)}
            >
              <X className="size-6" />
            </button>
            <h3 className="text-xl font-semibold mb-6">完整提示词</h3>
            <p className="whitespace-pre-wrap text-[var(--ink)] leading-relaxed text-sm">
              {job.prompt}
            </p>
            {job.negativePrompt && (
              <div className="mt-6 border-t border-[var(--line)] pt-4">
                <h4 className="text-sm font-medium text-[var(--ink-soft)] mb-2">负向提示词</h4>
                <p className="whitespace-pre-wrap text-[var(--ink)]/80 leading-relaxed text-sm">
                  {job.negativePrompt}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
