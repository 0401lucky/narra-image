"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, X, ToggleLeft, ToggleRight, Zap, Globe, Key, Server } from "lucide-react";

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
};

type ChannelManagerProps = {
  initialChannels: ChannelItem[];
};

export function ChannelManager({ initialChannels }: ChannelManagerProps) {
  const router = useRouter();
  const [channels, setChannels] = useState(initialChannels);
  const [editingChannel, setEditingChannel] = useState<ChannelItem | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isFetchingModels, startFetchingModels] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formDefaultModel, setFormDefaultModel] = useState("");
  const [formModels, setFormModels] = useState<string[]>([]);
  // 拉取到的所有模型（包含非生图），管理员可在其中勾选实际启用的模型
  const [fetchedModels, setFetchedModels] = useState<Array<{ id: string; imageLikely: boolean }>>([]);
  const [formCreditCost, setFormCreditCost] = useState(5);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formSortOrder, setFormSortOrder] = useState(0);

  function resetForm() {
    setFormName("");
    setFormSlug("");
    setFormBaseUrl("");
    setFormApiKey("");
    setFormDefaultModel("");
    setFormModels([]);
    setFetchedModels([]);
    setFormCreditCost(5);
    setFormIsActive(true);
    setFormSortOrder(0);
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
    // 老数据没有 imageLikely 标记，先按已启用来展示，后续重新拉取再覆盖
    setFetchedModels(ch.models.map((id) => ({ id, imageLikely: true })));
    setFormCreditCost(ch.creditCost);
    setFormIsActive(ch.isActive);
    setFormSortOrder(ch.sortOrder);
    setEditingChannel(ch);
    setShowCreateForm(true);
    setError(null);
    setModelError(null);
  }

  function closeForm() {
    setShowCreateForm(false);
    setEditingChannel(null);
    resetForm();
  }

  function autoSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/[\u4e00-\u9fa5]/g, "")
      .replace(/-+/g, "-")
      || "channel";
  }

  async function handleSave() {
    setError(null);

    if (editingChannel) {
      // Update
      const response = await fetch(`/api/admin/channels/${editingChannel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(formApiKey ? { apiKey: formApiKey } : {}),
          baseUrl: formBaseUrl,
          creditCost: formCreditCost,
          defaultModel: formDefaultModel,
          isActive: formIsActive,
          models: formModels,
          name: formName,
          sortOrder: formSortOrder,
        }),
      });

      const result = (await response.json()) as { data?: { channels: ChannelItem[] }; error?: string };
      if (!response.ok) {
        setError(result.error || "保存失败");
        return;
      }
      setChannels(result.data?.channels ?? []);
    } else {
      // Create
      const response = await fetch("/api/admin/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        }),
      });

      const result = (await response.json()) as { data?: { channels: ChannelItem[] }; error?: string };
      if (!response.ok) {
        setError(result.error || "创建失败");
        return;
      }
      setChannels(result.data?.channels ?? []);
    }

    closeForm();
    startTransition(() => router.refresh());
  }

  async function handleDelete(id: string) {
    if (!confirm("确定要删除这个渠道吗？此操作不可恢复。")) return;

    const response = await fetch(`/api/admin/channels/${id}`, { method: "DELETE" });
    const result = (await response.json()) as { data?: { channels: ChannelItem[] }; error?: string };
    if (response.ok) {
      setChannels(result.data?.channels ?? []);
      startTransition(() => router.refresh());
    }
  }

  async function handleToggle(ch: ChannelItem) {
    const response = await fetch(`/api/admin/channels/${ch.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !ch.isActive }),
    });
    const result = (await response.json()) as { data?: { channels: ChannelItem[] }; error?: string };
    if (response.ok) {
      setChannels(result.data?.channels ?? []);
      startTransition(() => router.refresh());
    }
  }

  async function handleFetchModels() {
    setModelError(null);
    const response = await fetch("/api/provider-models/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: formApiKey || null,
        baseUrl: formBaseUrl,
      }),
    });
    const result = (await response.json()) as {
      data?: { models: Array<{ id: string; imageLikely: boolean }> };
      error?: string;
    };
    if (!response.ok) {
      setModelError(result.error || "拉取模型失败");
      return;
    }
    const models = result.data?.models ?? [];
    setFetchedModels(models);
    // 默认只勾选生图模型
    const imageModels = models.filter((m) => m.imageLikely).map((m) => m.id);
    setFormModels(imageModels);
    if (imageModels[0]) {
      setFormDefaultModel(imageModels[0]);
    } else if (models[0]?.id) {
      setFormDefaultModel(models[0].id);
    }
  }

  function toggleModel(id: string) {
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
    setFormModels(fetchedModels.map((m) => m.id));
  }

  function selectImageModelsOnly() {
    const ids = fetchedModels.filter((m) => m.imageLikely).map((m) => m.id);
    setFormModels(ids);
    if (!ids.includes(formDefaultModel)) {
      setFormDefaultModel(ids[0] ?? "");
    }
  }

  function clearAllModels() {
    setFormModels([]);
    setFormDefaultModel("");
  }

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--ink)]">API 渠道管理</h3>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            配置多个生图 API 渠道，支持 OpenAI / Grok / 国内中转等。用户可在前端切换使用。
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-[var(--accent)]"
        >
          <Plus className="size-4" />
          新增渠道
        </button>
      </div>


      {channels.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-[var(--line)] p-12 text-center">
          <Server className="mx-auto size-10 text-[var(--ink-soft)] opacity-40" />
          <p className="mt-4 text-sm text-[var(--ink-soft)]">
            尚未配置任何渠道。点击「新增渠道」开始配置你的第一个 API 提供商。
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {channels.map((ch) => (
            <div
              key={ch.id}
              className={`studio-card group relative rounded-2xl p-5 transition-all hover:shadow-md ${
                !ch.isActive ? "opacity-60" : ""
              }`}
            >

              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className={`flex size-8 items-center justify-center rounded-lg ${ch.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-[var(--surface-strong)] text-[var(--ink-soft)]"}`}>
                    <Zap className="size-4" />
                  </div>
                  <div>
                    <h4 className="font-medium text-[var(--ink)] leading-tight">{ch.name}</h4>
                    <p className="text-[10px] text-[var(--ink-soft)] font-mono">{ch.slug}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle(ch)}
                  className="shrink-0 transition hover:scale-110"
                  title={ch.isActive ? "停用" : "启用"}
                >
                  {ch.isActive ? (
                    <ToggleRight className="size-6 text-emerald-500" />
                  ) : (
                    <ToggleLeft className="size-6 text-[var(--ink-soft)]" />
                  )}
                </button>
              </div>


              <div className="space-y-2 text-xs text-[var(--ink-soft)]">
                <div className="flex items-center gap-2">
                  <Globe className="size-3.5 shrink-0" />
                  <span className="truncate font-mono">{ch.baseUrl}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Server className="size-3.5 shrink-0" />
                  <span className="truncate">{ch.defaultModel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Key className="size-3.5 shrink-0" />
                  <span>{ch.apiKeyConfigured ? "已配置" : "未配置"}</span>
                </div>
              </div>


              <div className="mt-4 flex items-center justify-between border-t border-[var(--line)]/50 pt-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                    -{ch.creditCost} 积分/次
                  </span>
                  {ch.models.length > 0 && (
                    <span className="rounded-md bg-[var(--surface-strong)] px-2 py-0.5 text-[10px] text-[var(--ink-soft)]">
                      {ch.models.length} 个模型
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(ch)}
                    className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(ch.id)}
                    className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}


      {showCreateForm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={closeForm}
        >
          <div
            className="studio-card relative w-full max-w-2xl rounded-[2rem] p-6 md:p-8 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute top-6 right-6 text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
              onClick={closeForm}
            >
              <X className="size-6" />
            </button>

            <h3 className="text-xl font-semibold mb-6">
              {editingChannel ? `编辑渠道: ${editingChannel.name}` : "新增渠道"}
            </h3>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-sm text-[var(--ink-soft)]">渠道名称</span>
                <input
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (!editingChannel) setFormSlug(autoSlug(e.target.value));
                  }}
                  placeholder="例如: OpenAI 官方"
                  className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-2.5 outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              {!editingChannel && (
                <label className="grid gap-1.5">
                  <span className="text-sm text-[var(--ink-soft)]">渠道标识 (slug)</span>
                  <input
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value)}
                    placeholder="openai-official"
                    className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-2.5 font-mono text-sm outline-none transition focus:border-[var(--accent)]"
                  />
                </label>
              )}

              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-sm text-[var(--ink-soft)]">Base URL</span>
                <input
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-2.5 font-mono text-sm outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-sm text-[var(--ink-soft)]">
                  API Key
                  {editingChannel && (
                    <span className="ml-2 text-xs text-[var(--ink-soft)]">留空则保留当前密钥</span>
                  )}
                </span>
                <input
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  placeholder={editingChannel?.apiKeyConfigured ? "••••••••" : "sk-..."}
                  type="password"
                  className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-2.5 font-mono text-sm outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-sm text-[var(--ink-soft)]">默认模型</span>
                <div className="flex gap-2">
                  <input
                    value={formDefaultModel}
                    onChange={(e) => setFormDefaultModel(e.target.value)}
                    placeholder="gpt-image-2"
                    className="flex-1 rounded-xl border border-[var(--line)] bg-white/70 px-4 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => startFetchingModels(handleFetchModels)}
                    disabled={isFetchingModels || !formBaseUrl}
                    className="shrink-0 rounded-xl border border-[var(--line)] px-3 py-2.5 text-xs text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                  >
                    {isFetchingModels ? "拉取中..." : "拉取"}
                  </button>
                </div>
                {modelError && <p className="text-xs text-rose-500 mt-1">{modelError}</p>}
              </label>

              <label className="grid gap-1.5">
                <span className="text-sm text-[var(--ink-soft)]">每次消耗积分</span>
                <input
                  type="number"
                  value={formCreditCost}
                  onChange={(e) => setFormCreditCost(Number(e.target.value))}
                  className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-2.5 outline-none transition focus:border-[var(--accent)]"
                />
              </label>


              {fetchedModels.length > 0 && (
                <div className="md:col-span-2">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm text-[var(--ink-soft)]">
                      模型管理（已启用 {formModels.length} / 共拉取 {fetchedModels.length}）
                    </span>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={selectImageModelsOnly}
                        className="text-[var(--accent)] hover:underline"
                      >
                        仅生图
                      </button>
                      <span className="text-[var(--ink-soft)]/50">·</span>
                      <button
                        type="button"
                        onClick={selectAllModels}
                        className="text-[var(--accent)] hover:underline"
                      >
                        全选
                      </button>
                      <span className="text-[var(--ink-soft)]/50">·</span>
                      <button
                        type="button"
                        onClick={clearAllModels}
                        className="text-[var(--accent)] hover:underline"
                      >
                        全不选
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--ink-soft)] mb-2">
                    勾选的模型会出现在创作台供用户选择；点击模型名将其设为默认（自动勾选）。
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-56 overflow-y-auto rounded-xl border border-[var(--line)] p-2">
                    {fetchedModels.map((m) => {
                      const checked = formModels.includes(m.id);
                      const isDefault = formDefaultModel === m.id && checked;
                      return (
                        <label
                          key={m.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition ${
                            isDefault ? "bg-[var(--ink)]/5 ring-1 ring-[var(--ink)]/20" : "hover:bg-[var(--surface-strong)]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleModel(m.id)}
                            className="rounded border-[var(--line)] text-[var(--accent)] focus:ring-[var(--accent)]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!checked) toggleModel(m.id);
                              setFormDefaultModel(m.id);
                            }}
                            className="flex-1 min-w-0 truncate text-left text-xs"
                            title={m.id}
                          >
                            <span className={`font-mono ${checked ? "text-[var(--ink)]" : "text-[var(--ink-soft)]"}`}>
                              {m.id}
                            </span>
                            {m.imageLikely && (
                              <span className="ml-1.5 inline-block rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600">
                                生图
                              </span>
                            )}
                            {isDefault && (
                              <span className="ml-1.5 inline-block rounded-full bg-[var(--ink)] px-1.5 py-0.5 text-[9px] font-medium text-white">
                                默认
                              </span>
                            )}
                          </button>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="md:col-span-2 flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-[var(--ink-soft)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    className="rounded border-[var(--line)] text-[var(--accent)]"
                  />
                  启用此渠道
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
                  排序
                  <input
                    type="number"
                    value={formSortOrder}
                    onChange={(e) => setFormSortOrder(Number(e.target.value))}
                    className="w-16 rounded-lg border border-[var(--line)] bg-white/70 px-2 py-1 text-center text-sm outline-none"
                  />
                </label>
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={closeForm}
                className="rounded-full border border-[var(--line)] px-5 py-2.5 text-sm text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)]"
              >
                取消
              </button>
              <button
                onClick={() => startTransition(handleSave)}
                disabled={isPending || !formName || !formBaseUrl || !formDefaultModel || (!editingChannel && !formApiKey)}
                className="rounded-full bg-[var(--ink)] px-6 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-[var(--accent)] disabled:opacity-50"
              >
                {isPending ? "保存中..." : editingChannel ? "保存修改" : "创建渠道"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
