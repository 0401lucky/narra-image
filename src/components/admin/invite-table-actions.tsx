"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";

export function InviteDeleteBtn({ inviteId }: { inviteId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleDelete() {
    if (!confirm("确定要删除这个邀请码吗？")) return;

    const response = await fetch(`/api/admin/invites/${inviteId}`, {
      method: "DELETE",
    });

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(handleDelete)}
      className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50"
      title="删除邀请码"
    >
      <Trash2 className="size-4" />
    </button>
  );
}

export function InviteTableActions({ usedCount }: { usedCount: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleClearUsed() {
    if (!confirm(`确定要清除 ${usedCount} 条已使用的邀请码吗？此操作不可恢复。`)) {
      return;
    }

    const response = await fetch("/api/admin/invites/used", {
      method: "DELETE",
    });

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }
  }

  if (usedCount === 0) return null;

  return (
    <div className="flex justify-end">
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(handleClearUsed)}
        className="inline-flex items-center gap-2 rounded-full border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
      >
        <Trash2 className="size-4" />
        {isPending ? "清除中…" : `清除 ${usedCount} 条已使用`}
      </button>
    </div>
  );
}
