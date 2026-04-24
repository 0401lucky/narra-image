"use client";

import { useState } from "react";
import { Loader2, Save, Shield, ToggleLeft, ToggleRight } from "lucide-react";

type OAuthProviderData = {
  id: string;
  type: string;
  displayName: string;
  clientId: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const SUPPORTED_PROVIDERS = [
  {
    type: "linuxdo",
    label: "LinuxDo",
    description: "接入 LinuxDo 社区 OAuth2 登录，用户可使用 LinuxDo 账号直接登录。",
    authorizeUrl: "https://connect.linux.do/oauth2/authorize",
    helpUrl: "https://connect.linux.do",
  },
];

export function OAuthProviderManager({
  initialProviders,
}: {
  initialProviders: OAuthProviderData[];
}) {
  const [providers, setProviders] = useState<OAuthProviderData[]>(initialProviders);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // 表单状态
  const [formClientId, setFormClientId] = useState("");
  const [formClientSecret, setFormClientSecret] = useState("");
  const [formEnabled, setFormEnabled] = useState(false);

  function startEdit(type: string) {
    const existing = providers.find((p) => p.type === type);
    setFormClientId(existing?.clientId ?? "");
    setFormClientSecret("");
    setFormEnabled(existing?.isEnabled ?? false);
    setEditingType(type);
    setMessage(null);
  }

  async function handleSave(type: string, displayName: string) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          displayName,
          clientId: formClientId,
          clientSecret: formClientSecret,
          isEnabled: formEnabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ text: json.error || "保存失败", type: "error" });
        return;
      }
      setProviders(json.data.providers);
      setEditingType(null);
      setMessage({ text: `${displayName} 配置已保存`, type: "success" });
    } catch {
      setMessage({ text: "保存时发生错误", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(type: string) {
    const existing = providers.find((p) => p.type === type);
    if (!existing) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: existing.type,
          displayName: existing.displayName,
          clientId: existing.clientId,
          clientSecret: "",
          isEnabled: !existing.isEnabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ text: json.error || "操作失败", type: "error" });
        return;
      }
      setProviders(json.data.providers);
      setMessage({
        text: `${existing.displayName} 已${existing.isEnabled ? "停用" : "启用"}`,
        type: "success",
      });
    } catch {
      setMessage({ text: "操作失败", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <Shield className="size-5 text-[var(--accent)]" />
        <h2 className="text-xl font-semibold text-[var(--ink)]">OAuth 登录源</h2>
      </div>
      <p className="text-sm text-[var(--ink-soft)]">
        配置第三方 OAuth 登录后，用户可在登录页使用对应平台账号快捷登录，无需邀请码和密码。
      </p>

      {message && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            message.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {SUPPORTED_PROVIDERS.map((sp) => {
        const existing = providers.find((p) => p.type === sp.type);
        const isEditing = editingType === sp.type;

        return (
          <div
            key={sp.type}
            className="studio-card rounded-[1.5rem] p-5"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent)]/10">
                  <span className="text-sm font-bold text-[var(--accent)]">
                    {sp.label[0]}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold text-[var(--ink)]">{sp.label}</h3>
                  <p className="text-xs text-[var(--ink-soft)]">{sp.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {existing && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleToggle(sp.type)}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition hover:bg-[var(--surface-strong)]"
                  >
                    {existing.isEnabled ? (
                      <>
                        <ToggleRight className="size-4 text-emerald-500" />
                        <span className="text-emerald-600">已启用</span>
                      </>
                    ) : (
                      <>
                        <ToggleLeft className="size-4 text-[var(--ink-soft)]" />
                        <span className="text-[var(--ink-soft)]">未启用</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    isEditing ? setEditingType(null) : startEdit(sp.type)
                  }
                  className="rounded-full border border-[var(--line)] px-4 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  {isEditing ? "收起" : existing ? "编辑" : "配置"}
                </button>
              </div>
            </div>

            {isEditing && (
              <div className="mt-5 grid gap-4 border-t border-[var(--line)] pt-5">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--ink)]">
                    Client ID
                  </label>
                  <input
                    type="text"
                    value={formClientId}
                    onChange={(e) => setFormClientId(e.target.value)}
                    placeholder="从 connect.linux.do 获取"
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)]/60 px-4 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--ink)]">
                    Client Secret
                  </label>
                  <input
                    type="password"
                    value={formClientSecret}
                    onChange={(e) => setFormClientSecret(e.target.value)}
                    placeholder={existing ? "留空则不更新" : "从 connect.linux.do 获取"}
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)]/60 px-4 py-2.5 text-sm outline-none transition focus:border-[var(--accent)]"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-[var(--ink)]">启用状态</label>
                  <button
                    type="button"
                    onClick={() => setFormEnabled(!formEnabled)}
                    className="flex items-center gap-1.5 text-sm"
                  >
                    {formEnabled ? (
                      <ToggleRight className="size-5 text-emerald-500" />
                    ) : (
                      <ToggleLeft className="size-5 text-[var(--ink-soft)]" />
                    )}
                    <span className={formEnabled ? "text-emerald-600" : "text-[var(--ink-soft)]"}>
                      {formEnabled ? "启用" : "停用"}
                    </span>
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={saving || !formClientId}
                    onClick={() => void handleSave(sp.type, sp.label)}
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--accent)] disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    保存配置
                  </button>
                  <a
                    href={sp.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    前往 {sp.label} 申请凭证 →
                  </a>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
