"use client";

import { Check, Copy, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminConfirmDialog } from "./ui/admin-modal";

type InviteDeleteBtnProps = {
  code?: string;
  inviteId: string;
};

export function InviteDeleteBtn({ code, inviteId }: InviteDeleteBtnProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/invites/${inviteId}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        const msg = result.error || "删除邀请码失败";
        setError(msg);
        toast.error("删除邀请码失败", msg);
        return;
      }

      setOpen(false);
      toast.success("邀请码已删除", code ? `已移除 ${code}` : undefined);
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
        disabled={isPending || deleting}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
        title="删除邀请码"
        aria-label={code ? `删除邀请码 ${code}` : "删除邀请码"}
      >
        <Trash2 className="size-4" aria-hidden />
      </button>

      <AdminConfirmDialog
        open={open}
        onClose={() => {
          if (!deleting) setOpen(false);
        }}
        onConfirm={() => void handleDelete()}
        busy={deleting}
        tone="danger"
        title="删除单条邀请码"
        description={
          code
            ? `确定要永久删除邀请码「${code}」吗？删除后该码不可再用于注册。`
            : "确定要永久删除这条邀请码吗？此操作不可恢复。"
        }
        confirmLabel={deleting ? "删除中…" : "确认删除"}
        error={error}
      />
    </>
  );
}

export function InviteCopyCodeBtn({ code }: { code: string }) {
  const toast = useAdminToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("邀请码已复制", code);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("复制失败", "当前浏览器环境不允许自动写入剪贴板");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-[#f5eee3] hover:text-[#c85a32]"
      title="复制邀请码"
      aria-label={`复制邀请码 ${code}`}
    >
      {copied ? (
        <Check className="size-4 text-emerald-600" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
    </button>
  );
}

export function InviteTableActions({ usedCount }: { usedCount: number }) {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClearUsed() {
    setError(null);
    setClearing(true);
    try {
      const response = await fetch("/api/admin/invites/used", {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        const msg = result.error || "清除已使用邀请码失败";
        setError(msg);
        toast.error("清除失败", msg);
        return;
      }

      setOpen(false);
      toast.success("已清理已使用邀请码", `共移除 ${usedCount} 条历史已用记录`);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setClearing(false);
    }
  }

  if (usedCount === 0) return null;

  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={isPending || clearing}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
        >
          <Trash2 className="size-3.5" aria-hidden />
          {clearing || isPending ? "清除中…" : `清理 ${usedCount} 条已使用邀请码`}
        </button>
      </div>

      <AdminConfirmDialog
        open={open}
        onClose={() => {
          if (!clearing) setOpen(false);
        }}
        onConfirm={() => void handleClearUsed()}
        busy={clearing}
        tone="danger"
        title="批量清理已使用邀请码"
        description={`将物理清除全部 ${usedCount} 条已使用的邀请码记录（不影响已注册用户账户），操作不可恢复。`}
        confirmLabel={clearing ? "清理中…" : "确认清理"}
        error={error}
      />
    </>
  );
}
