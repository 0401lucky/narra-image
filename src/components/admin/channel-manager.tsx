"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Globe,
  Key,
  Loader2,
  Pencil,
  Plus,
  Search,
  Server,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminConfirmDialog, AdminModal } from "./ui/admin-modal";
import { AdminSwitch } from "./ui/admin-switch";

type ChannelItem = {
  apiKeyConfigured: boolean;
  baseUrl: string;
  creditCost: number;
  defaultModel: string;
  id: string;
  isActive: boolean;
  models: string[];
  name: string;
  slug: string;
  sortOrder: number;
  videoCreditCost: number;
};

type ChannelProbeResult = {
  defaultAvailable?: boolean;
  latencyMs?: number;
  message?: string;
  modelCount?: number;
  status: "idle" | "probing" | "ok" | "error";
};

type ChannelManagerProps = {
  initialChannels: ChannelItem[];
};

export function ChannelManager({ initialChannels }: ChannelManagerProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [channels, setChannels] = useState(initialChannels);
  const [editingChannel, setEditingChannel] = useState<ChannelItem | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChannelItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [probeMap, setProbeMap] = useState<Record<string, ChannelProbeResult>>({});
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();
  const [isFetchingModels, startFetchingModels] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState("");

  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formDefaultModel, setFormDefaultModel] = useState("");
  const [formModels, setFormModels] = useState<string[]>([]);
  const [fetchedModels, setFetchedModels] = useState<
    Array<{ id: string; imageLikely: boolean }>
  >([]);
  const [formCreditCost, setFormCreditCost] = useState(5);
  const [formVideoCreditCost, setFormVideoCreditCost] = useState(20);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [isFormDirty, setIsFormDirty] = useState(false);

  const sortedChannels = useMemo(
    () =>
      [...channels].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      ),
    [channels],
  );

  const filteredFetchedModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return fetchedModels;
    return fetchedModels.filter((m) => m.id.toLowerCase().includes(q));
  }, [fetchedModels, modelQuery]);

  function resetForm() {
    setFormName("");
    setFormSlug("");
    setFormBaseUrl("");
    setFormApiKey("");
    setFormDefaultModel("");
    setFormModels([]);
    setFetchedModels([]);
    setModelQuery("");
    setFormCreditCost(5);
    setFormVideoCreditCost(20);
    setFormIsActive(true);
    setFormSortOrder(0);
    setIsFormDirty(false);
    setError(null);
    setModelError(null);
  }

  function openCreate() {
    resetForm();
    setFormSortOrder(channels.length);
    setEditingChannel(null);
    setShowCreateForm(true);
  }

  function openEdit(ch: ChannelItem) {
    setFormName(ch.name);
    setFormSlug(ch.slug);
    setFormBaseUrl(ch.baseUrl);
    setFormApiKey("");
    setFormDefaultModel(ch.defaultModel);
    setFormModels(ch.models);
    setFetchedModels(ch.models.map((id) => ({ id, imageLikely: true })));
    setModelQuery("");
    setFormCreditCost(ch.creditCost);
    setFormVideoCreditCost(ch.videoCreditCost);
    setFormIsActive(ch.isActive);
    setFormSortOrder(ch.sortOrder);
    setIsFormDirty(false);
    setEditingChannel(ch);
    setShowCreateForm(true);
    setError(null);
    setModelError(null);
  }

  function forceCloseForm() {
    setConfirmDiscardOpen(false);
    setShowCreateForm(false);
    setEditingChannel(null);
    resetForm();
  }

  function requestCloseForm() {
    if (isFormDirty && !isPending) {
      setConfirmDiscardOpen(true);
      return;
    }
    forceCloseForm();
  }

  function autoSlug(name: string) {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/[\u4e00-\u9fa5]/g, "")
        .replace(/-+/g, "-") || "channel"
    );
  }

  async function handleSave() {
    setError(null);

    if (editingChannel) {
      const response = await fetch(`/api/admin/channels/${editingChannel.id}`, {
        body: JSON.stringify({
          ...(formApiKey ? { apiKey: formApiKey } : {}),
          baseUrl: formBaseUrl,
          creditCost: formCreditCost,
          defaultModel: formDefaultModel,
          isActive: formIsActive,
          models: formModels,
          name: formName,
          sortOrder: formSortOrder,
          videoCreditCost: formVideoCreditCost,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });

      const result = (await response.json().catch(() => ({}))) as {
        data?: { channels: ChannelItem[] };
        error?: string;
      };
      if (!response.ok) {
        const msg = result.error || "保存失败";
        setError(msg);
        toast.error("渠道保存失败", msg);
        return;
      }
      setChannels(result.data?.channels ?? []);
      toast.success("渠道修改已保存", formName);
    } else {
      const response = await fetch("/api/admin/channels", {
        body: JSON.stringify({
          apiKey: formApiKey,
          baseUrl: formBaseUrl,
          creditCost: formCreditCost,
          defaultModel: formDefaultModel,
          isActive: formIsActive,
          models: formModels,
          name: formName,
          slug: formSlug,
          sortOrder: formSortOrder,
          videoCreditCost: formVideoCreditCost,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const result = (await response.json().catch(() => ({}))) as {
        data?: { channels: ChannelItem[] };
        error?: string;
      };
      if (!response.ok) {
        const msg = result.error || "创建失败";
        setError(msg);
        toast.error("渠道创建失败", msg);
        return;
      }
      setChannels(result.data?.channels ?? []);
      toast.success("新增渠道已创建", formName);
    }

    forceCloseForm();
    startTransition(() => router.refresh());
  }

  async function confirmDeleteChannel() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/channels/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as {
        data?: { channels: ChannelItem[] };
        error?: string;
      };
      if (!response.ok) {
        const msg = result.error || "删除渠道失败";
        setDeleteError(msg);
        toast.error("删除渠道失败", msg);
        return;
      }
      setChannels(result.data?.channels ?? []);
      toast.success("渠道已删除", deleteTarget.name);
      setDeleteTarget(null);
      startTransition(() => router.refresh());
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggle(ch: ChannelItem, nextActive: boolean) {
    const response = await fetch(`/api/admin/channels/${ch.id}`, {
      body: JSON.stringify({ isActive: nextActive }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const result = (await response.json().catch(() => ({}))) as {
      data?: { channels: ChannelItem[] };
      error?: string;
    };
    if (!response.ok) {
      toast.error("切换渠道状态失败", result.error || "请稍后再试");
      return;
    }
    setChannels(result.data?.channels ?? []);
    toast.success(
      nextActive ? `已启用渠道「${ch.name}」` : `已停用渠道「${ch.name}」`,
    );
    startTransition(() => router.refresh());
  }

  async function handleMoveOrder(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sortedChannels.length) return;

    const reordered = [...sortedChannels];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    setReorderingId(moved.id);
    try {
      let latestChannels = channels;
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].sortOrder === i) continue;
        const res = await fetch(`/api/admin/channels/${reordered[i].id}`, {
          body: JSON.stringify({ sortOrder: i }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        });
        const json = (await res.json().catch(() => ({}))) as {
          data?: { channels: ChannelItem[] };
          error?: string;
        };
        if (!res.ok) {
          toast.error("更新排序失败", json.error || "请稍后再试");
          return;
        }
        if (json.data?.channels) {
          latestChannels = json.data.channels;
        }
      }
      setChannels(latestChannels);
      toast.success("渠道顺序已更新");
      startTransition(() => router.refresh());
    } finally {
      setReorderingId(null);
    }
  }

  async function handleProbeChannel(ch: ChannelItem) {
    setProbeMap((prev) => ({
      ...prev,
      [ch.id]: { status: "probing" },
    }));
    const started = performance.now();
    try {
      const res = await fetch("/api/provider-models/probe", {
        body: JSON.stringify({
          apiKey: null,
          baseUrl: ch.baseUrl,
          channelId: ch.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const latencyMs = Math.max(1, Math.round(performance.now() - started));
      const json = (await res.json().catch(() => ({}))) as {
        data?: { models: Array<{ id: string; imageLikely: boolean }> };
        error?: string;
      };
      if (!res.ok || !json.data) {
        const msg = json.error || "连接探测失败";
        setProbeMap((prev) => ({
          ...prev,
          [ch.id]: { latencyMs, message: msg, status: "error" },
        }));
        toast.error(`「${ch.name}」探测异常`, msg);
        return;
      }
      const models = json.data.models;
      const defaultAvailable = models.some((m) => m.id === ch.defaultModel);
      setProbeMap((prev) => ({
        ...prev,
        [ch.id]: {
          defaultAvailable,
          latencyMs,
          modelCount: models.length,
          status: "ok",
        },
      }));
      toast.success(
        `「${ch.name}」连通正常 (${latencyMs}ms)`,
        `返回 ${models.length} 个模型 · 默认模型${defaultAvailable ? "可用" : "未在列表中"}`,
      );
    } catch {
      setProbeMap((prev) => ({
        ...prev,
        [ch.id]: { message: "网络请求失败", status: "error" },
      }));
    }
  }

  async function handleFetchModels() {
    setModelError(null);
    const response = await fetch("/api/provider-models/probe", {
      body: JSON.stringify({
        apiKey: formApiKey || null,
        baseUrl: formBaseUrl,
        channelId: editingChannel?.id ?? null,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as {
      data?: { models: Array<{ id: string; imageLikely: boolean }> };
      error?: string;
    };
    if (!response.ok) {
      setModelError(result.error || "拉取模型失败");
      return;
    }
    const models = result.data?.models ?? [];
    setFetchedModels(models);
    setIsFormDirty(true);
    const imageModels = models.filter((m) => m.imageLikely).map((m) => m.id);
    setFormModels(imageModels);
    if (imageModels[0]) {
      setFormDefaultModel(imageModels[0]);
    } else if (models[0]?.id) {
      setFormDefaultModel(models[0].id);
    }
  }

  function toggleModel(id: string) {
    setIsFormDirty(true);
    setFormModels((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((m) => m !== id);
        if (formDefaultModel === id) {
          setFormDefaultModel(next[0] ?? "");
        }
        return next;
      }
      return [...prev, id];
    });
  }

  function selectAllModels() {
    setIsFormDirty(true);
    setFormModels(fetchedModels.map((m) => m.id));
  }

  function selectImageModelsOnly() {
    setIsFormDirty(true);
    const ids = fetchedModels.filter((m) => m.imageLikely).map((m) => m.id);
    setFormModels(ids);
    if (!ids.includes(formDefaultModel)) {
      setFormDefaultModel(ids[0] ?? "");
    }
  }

  function clearAllModels() {
    setIsFormDirty(true);
    setFormModels([]);
    setFormDefaultModel("");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--ink)]">
            已配置渠道（{sortedChannels.filter((c) => c.isActive).length} 启用 / 共 {sortedChannels.length} 个）
          </h3>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            支持一键探测上游连通性与响应延迟，并可调整前台展示优先级。
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c85a32]"
        >
          <Plus className="size-4" aria-hidden />
          新增渠道
        </button>
      </div>

      {sortedChannels.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[#faf7f1]/70 p-12 text-center">
          <Server className="mx-auto size-10 text-[var(--ink-soft)] opacity-40" aria-hidden />
          <p className="mt-4 text-sm text-[var(--ink-soft)]">
            尚未配置任何生图渠道。点击右上角「新增渠道」接入你的第一个上游服务商。
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sortedChannels.map((ch, idx) => {
            const probe = probeMap[ch.id];
            const isProbing = probe?.status === "probing";
            return (
              <article
                key={ch.id}
                className={cn(
                  "studio-card flex flex-col justify-between p-5 transition-opacity",
                  !ch.isActive && "opacity-65",
                )}
              >
                <div>
                  <div className="mb-3.5 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-xl border",
                          ch.isActive
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-[var(--line)] bg-[#f4ede1] text-[var(--ink-soft)]",
                        )}
                      >
                        <Zap className="size-4" aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-[#efe8dc] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--ink-soft)]">
                            #{idx + 1}
                          </span>
                          <h4 className="truncate font-semibold text-[var(--ink)]">
                            {ch.name}
                          </h4>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--ink-soft)]">
                          {ch.slug}
                        </p>
                      </div>
                    </div>

                    <AdminSwitch
                      size="sm"
                      ariaLabel={`${ch.isActive ? "停用" : "启用"}渠道 ${ch.name}`}
                      checked={ch.isActive}
                      onCheckedChange={(next) => void handleToggle(ch, next)}
                    />
                  </div>

                  <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[#faf7f1] p-3 text-xs text-[var(--ink-soft)]">
                    <div className="flex items-center gap-2">
                      <Globe className="size-3.5 shrink-0 text-[#9e5322]" aria-hidden />
                      <span className="truncate font-mono" title={ch.baseUrl}>
                        {ch.baseUrl}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Server className="size-3.5 shrink-0 text-[#9e5322]" aria-hidden />
                      <span className="truncate font-mono text-[var(--ink)]" title={ch.defaultModel}>
                        {ch.defaultModel}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Key className="size-3.5 shrink-0 text-[#9e5322]" aria-hidden />
                        <span>{ch.apiKeyConfigured ? "密钥已配置" : "未配置密钥"}</span>
                      </span>
                      <span className="font-mono text-[11px]">
                        启用 {ch.models.length} 模型
                      </span>
                    </div>
                  </div>

                  {probe && probe.status !== "idle" ? (
                    <div
                      className={cn(
                        "mt-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs",
                        probe.status === "probing" &&
                          "border-amber-200 bg-amber-50/70 text-amber-800",
                        probe.status === "ok" &&
                          "border-emerald-200 bg-emerald-50/70 text-emerald-800",
                        probe.status === "error" &&
                          "border-rose-200 bg-rose-50/80 text-rose-700",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 truncate">
                        {probe.status === "probing" ? (
                          <>
                            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                            <span>正在连接探测 /models…</span>
                          </>
                        ) : probe.status === "ok" ? (
                          <>
                            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                            <span className="truncate">
                              连通 · {probe.modelCount} 模型 ·{" "}
                              {probe.defaultAvailable ? "默认模型可用" : "默认模型未命中"}
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle className="size-3.5 shrink-0 text-rose-600" aria-hidden />
                            <span className="truncate" title={probe.message}>
                              {probe.message}
                            </span>
                          </>
                        )}
                      </span>
                      {probe.latencyMs !== undefined ? (
                        <span className="shrink-0 font-mono text-[11px] font-semibold">
                          {probe.latencyMs}ms
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)]/70 pt-3.5">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-md bg-[#c85a32]/10 px-2 py-0.5 font-mono text-xs font-semibold text-[#b54722]">
                      图 -{ch.creditCost}
                    </span>
                    <span className="rounded-md bg-violet-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-violet-700">
                      视 -{ch.videoCreditCost}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={isProbing || !ch.apiKeyConfigured}
                      onClick={() => void handleProbeChannel(ch)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-white px-2 py-1 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32] disabled:opacity-45"
                      title="测试渠道连通性与延迟"
                      aria-label={`探测渠道 ${ch.name}`}
                    >
                      <Activity className="size-3.5" aria-hidden />
                      测速
                    </button>
                    <button
                      type="button"
                      disabled={idx === 0 || reorderingId !== null}
                      onClick={() => void handleMoveOrder(idx, -1)}
                      className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-[#f4ede1] hover:text-[var(--ink)] disabled:opacity-30"
                      title="上移优先级"
                      aria-label={`上移 ${ch.name}`}
                    >
                      <ArrowUp className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={idx === sortedChannels.length - 1 || reorderingId !== null}
                      onClick={() => void handleMoveOrder(idx, 1)}
                      className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-[#f4ede1] hover:text-[var(--ink)] disabled:opacity-30"
                      title="下移优先级"
                      aria-label={`下移 ${ch.name}`}
                    >
                      <ArrowDown className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(ch)}
                      className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-[#f4ede1] hover:text-[var(--ink)]"
                      aria-label={`编辑 ${ch.name}`}
                      title="编辑渠道"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(ch);
                      }}
                      className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-rose-50 hover:text-rose-600"
                      aria-label={`删除 ${ch.name}`}
                      title="删除渠道"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <AdminModal
        open={showCreateForm}
        onClose={requestCloseForm}
        busy={isPending}
        preventOutsideClose={isFormDirty}
        size="lg"
        eyebrow="PROVIDER CHANNEL"
        title={editingChannel ? `编辑渠道: ${editingChannel.name}` : "新增生图 API 渠道"}
        description="支持 OpenAI 兼容协议端点，拉取后可按关键词筛选并勾选向用户开放的模型。"
        footer={
          <>
            <button
              type="button"
              onClick={requestCloseForm}
              className="rounded-full border border-[var(--line)] bg-white px-5 py-2 text-sm font-medium text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => startTransition(() => void handleSave())}
              disabled={
                isPending ||
                !formName ||
                !formBaseUrl ||
                !formDefaultModel ||
                (!editingChannel && !formApiKey)
              }
              className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-6 py-2 text-sm font-semibold text-white transition hover:bg-[#c85a32] disabled:opacity-50"
            >
              {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {isPending ? "保存中…" : editingChannel ? "保存修改" : "创建渠道"}
            </button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-[var(--ink-soft)]">渠道名称</span>
            <input
              value={formName}
              onChange={(e) => {
                setIsFormDirty(true);
                setFormName(e.target.value);
                if (!editingChannel) setFormSlug(autoSlug(e.target.value));
              }}
              placeholder="例如：OpenAI 官方"
              className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none"
            />
          </label>

          {!editingChannel ? (
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[var(--ink-soft)]">渠道标识（slug）</span>
              <input
                value={formSlug}
                onChange={(e) => {
                  setIsFormDirty(true);
                  setFormSlug(e.target.value);
                }}
                placeholder="openai-official"
                className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm outline-none"
              />
            </label>
          ) : (
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-[var(--ink-soft)]">渠道标识（只读）</span>
              <div className="rounded-xl border border-[var(--line)] bg-[#faf7f1] px-3.5 py-2.5 font-mono text-sm text-[var(--ink-soft)]">
                {formSlug}
              </div>
            </div>
          )}

          <label className="grid gap-1.5 md:col-span-2">
            <span className="text-xs font-medium text-[var(--ink-soft)]">Base URL</span>
            <input
              value={formBaseUrl}
              onChange={(e) => {
                setIsFormDirty(true);
                setFormBaseUrl(e.target.value);
              }}
              placeholder="https://api.openai.com/v1"
              className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm outline-none"
            />
          </label>

          <label className="grid gap-1.5 md:col-span-2">
            <span className="text-xs font-medium text-[var(--ink-soft)]">
              API Key
              {editingChannel ? (
                <span className="ml-2 text-xs font-normal text-[var(--ink-soft)]">
                  留空则保留当前已加密密钥
                </span>
              ) : null}
            </span>
            <input
              value={formApiKey}
              onChange={(e) => {
                setIsFormDirty(true);
                setFormApiKey(e.target.value);
              }}
              placeholder={editingChannel?.apiKeyConfigured ? "••••••••" : "sk-..."}
              type="password"
              className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm outline-none"
            />
          </label>

          <div className="grid gap-1.5 md:col-span-2">
            <label htmlFor="channel-default-model" className="text-xs font-medium text-[var(--ink-soft)]">
              默认模型与上游模型目录
            </label>
            <div className="flex gap-2">
              <input
                id="channel-default-model"
                value={formDefaultModel}
                onChange={(e) => {
                  setIsFormDirty(true);
                  setFormDefaultModel(e.target.value);
                }}
                placeholder="gpt-image-1"
                className="flex-1 rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => startFetchingModels(() => void handleFetchModels())}
                disabled={isFetchingModels || !formBaseUrl}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[#faf7f1] px-4 py-2.5 text-xs font-semibold text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32] disabled:opacity-50"
              >
                {isFetchingModels ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                {isFetchingModels ? "拉取中…" : "拉取"}
              </button>
            </div>
            {modelError ? <p className="mt-1 text-xs text-rose-600">{modelError}</p> : null}
          </div>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-[var(--ink-soft)]">图片单次消耗积分</span>
            <input
              type="number"
              min={0}
              value={formCreditCost}
              onChange={(e) => {
                setIsFormDirty(true);
                setFormCreditCost(Number(e.target.value));
              }}
              className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm font-semibold tabular-nums outline-none"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-[var(--ink-soft)]">视频单次消耗积分</span>
            <input
              type="number"
              min={0}
              value={formVideoCreditCost}
              onChange={(e) => {
                setIsFormDirty(true);
                setFormVideoCreditCost(Number(e.target.value));
              }}
              className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm font-semibold tabular-nums outline-none"
            />
          </label>

          {fetchedModels.length > 0 ? (
            <div className="rounded-xl border border-[var(--line)] bg-[#faf7f1] p-3.5 md:col-span-2">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--ink)]">
                  模型启用清单（已勾选 {formModels.length} / 共 {fetchedModels.length}）
                </span>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={selectImageModelsOnly}
                    className="font-medium text-[#b54722] hover:underline"
                  >
                    仅生图模型
                  </button>
                  <span className="text-[var(--ink-soft)]/40">·</span>
                  <button
                    type="button"
                    onClick={selectAllModels}
                    className="font-medium text-[#b54722] hover:underline"
                  >
                    全选
                  </button>
                  <span className="text-[var(--ink-soft)]/40">·</span>
                  <button
                    type="button"
                    onClick={clearAllModels}
                    className="font-medium text-[#b54722] hover:underline"
                  >
                    清空
                  </button>
                </div>
              </div>

              <div className="relative mb-2.5">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-soft)]"
                  aria-hidden
                />
                <input
                  type="text"
                  value={modelQuery}
                  onChange={(e) => setModelQuery(e.target.value)}
                  placeholder="输入模型关键词过滤（如 flux / gpt-image / kling / veo）…"
                  className="w-full rounded-lg border border-[var(--line)] bg-white py-1.5 pr-3 pl-8 text-xs outline-none"
                />
              </div>

              <div className="premium-scrollbar grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {filteredFetchedModels.map((m) => {
                  const checked = formModels.includes(m.id);
                  const isDefault = formDefaultModel === m.id && checked;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 transition",
                        isDefault
                          ? "border-[#231810]/30 bg-white shadow-2xs"
                          : "border-transparent bg-white/70 hover:border-[var(--line)] hover:bg-white",
                      )}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleModel(m.id)}
                          className="size-3.5 shrink-0 rounded accent-[#c85a32]"
                        />
                        <span
                          className={cn(
                            "truncate font-mono text-xs",
                            checked ? "font-medium text-[var(--ink)]" : "text-[var(--ink-soft)]",
                          )}
                          title={m.id}
                        >
                          {m.id}
                        </span>
                      </label>

                      <div className="flex shrink-0 items-center gap-1">
                        {m.imageLikely ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                            生图
                          </span>
                        ) : null}
                        {isDefault ? (
                          <span className="rounded bg-[#231810] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            默认
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setIsFormDirty(true);
                              if (!checked) toggleModel(m.id);
                              setFormDefaultModel(m.id);
                            }}
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--ink-soft)] transition hover:bg-[#f4ede1] hover:text-[#b54722]"
                          >
                            设默认
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredFetchedModels.length === 0 ? (
                  <p className="col-span-full py-6 text-center text-xs text-[var(--ink-soft)]">
                    没有匹配「{modelQuery}」的模型
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[#faf7f1] px-4 py-3 md:col-span-2">
            <div className="flex items-center gap-3">
              <AdminSwitch
                ariaLabel="启用此渠道"
                checked={formIsActive}
                onCheckedChange={(next) => {
                  setIsFormDirty(true);
                  setFormIsActive(next);
                }}
              />
              <span className="text-sm font-medium text-[var(--ink)]">启用此生图渠道</span>
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-[var(--ink-soft)]">
              <span>排序权重</span>
              <input
                type="number"
                value={formSortOrder}
                onChange={(e) => {
                  setIsFormDirty(true);
                  setFormSortOrder(Number(e.target.value));
                }}
                className="w-20 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-center font-mono text-sm text-[var(--ink)] outline-none"
              />
            </label>
          </div>
        </div>

        {error ? (
          <div className="mt-4">
            <Alert variant="error">{error}</Alert>
          </div>
        ) : null}
      </AdminModal>

      <AdminConfirmDialog
        open={confirmDiscardOpen}
        onClose={() => setConfirmDiscardOpen(false)}
        onConfirm={forceCloseForm}
        tone="warning"
        title="放弃未保存的渠道修改？"
        description="当前渠道表单已有未保存的编辑内容，关闭后本次填写的密钥与模型选择将会丢失。"
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
      />

      <AdminConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDeleteChannel()}
        busy={deleting}
        tone="danger"
        title="删除生图渠道"
        description={
          deleteTarget
            ? `确定要永久删除渠道「${deleteTarget.name} (${deleteTarget.slug})」吗？删除后用户无法再通过该内置渠道发起生图。`
            : "确定要删除这个渠道吗？"
        }
        confirmLabel={deleting ? "删除中…" : "确认删除"}
        error={deleteError}
      />
    </div>
  );
}
