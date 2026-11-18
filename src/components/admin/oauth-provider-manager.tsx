"use client";

import { ExternalLink, Loader2, Save, Shield } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminSwitch } from "./ui/admin-switch";

type OAuthProviderData = {
  clientId: string;
  createdAt: string;
  displayName: string;
  id: string;
  isEnabled: boolean;
  type: string;
  updatedAt: string;
};

type OAuthProviderManagerProps = {
  initialProviders: OAuthProviderData[];
};

const SUPPORTED_PROVIDERS = [
  {
    authorizeUrl: "https://connect.linux.do/oauth2/authorize",
    description: "接入 LinuxDo 社区 OAuth2 登录，用户可使用社区账号一键登录，无需邀请码与密码。",
    helpUrl: "https://connect.linux.do",
    label: "LinuxDo",
    type: "linuxdo",
  },
];

export function OAuthProviderManager({
  initialProviders,
}: OAuthProviderManagerProps) {
  const toast = useAdminToast();
  const [providers, setProviders] = useState<OAuthProviderData[]>(initialProviders);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

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
        body: JSON.stringify({
          clientId: formClientId,
          clientSecret: formClientSecret,
          displayName,
          isEnabled: formEnabled,
          type,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { providers: OAuthProviderData[] };
        error?: string;
      };
      if (!res.ok || !json.data) {
        const msg = json.error || "保存失败";
        setMessage({ text: msg, type: "error" });
        toast.error(`${displayName} 保存失败`, msg);
        return;
      }
      setProviders(json.data.providers);
      setEditingType(null);
      const okMsg = `${displayName} OAuth 配置已保存`;
      setMessage({ text: okMsg, type: "success" });
      toast.success("登录源配置已更新", okMsg);
    } catch {
      setMessage({ text: "保存时发生网络错误", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(type: string, nextEnabled: boolean) {
    const existing = providers.find((p) => p.type === type);
    if (!existing) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/oauth", {
        body: JSON.stringify({
          clientId: existing.clientId,
          clientSecret: "",
          displayName: existing.displayName,
          isEnabled: nextEnabled,
          type: existing.type,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { providers: OAuthProviderData[] };
        error?: string;
      };
      if (!res.ok || !json.data) {
        const msg = json.error || "切换失败";
        setMessage({ text: msg, type: "error" });
        toast.error("切换状态失败", msg);
        return;
      }
      setProviders(json.data.providers);
      const okMsg = `${existing.displayName} 已${nextEnabled ? "启用" : "停用"}`;
      setMessage({ text: okMsg, type: "success" });
      toast.success(okMsg);
    } catch {
      setMessage({ text: "操作失败", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5">
      {message ? (
        <Alert variant={message.type === "success" ? "success" : "error"}>
          {message.text}
        </Alert>
      ) : null}

      {SUPPORTED_PROVIDERS.map((sp) => {
        const existing = providers.find((p) => p.type === sp.type);
        const isEditing = editingType === sp.type;

        return (
          <div key={sp.type} className="studio-card p-5 md:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3.5">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#c85a32]/20 bg-[#c85a32]/10 text-base font-bold text-[#b54722]">
                  {sp.label[0]}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-[var(--ink)]">
                      {sp.label}
                    </h2>
                    {existing ? (
                      <span
                        className={
                          existing.isEnabled
                            ? "rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800"
                            : "rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-600"
                        }
                      >
                        {existing.isEnabled ? "已启用" : "已停用"}
                      </span>
                    ) : (
                      <span className="rounded-full border border-[var(--line)] bg-[#f8f4ec] px-2.5 py-0.5 text-xs text-[var(--ink-soft)]">
                        未配置凭证
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)] sm:text-sm">
                    {sp.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                {existing ? (
                  <AdminSwitch
                    ariaLabel={`${sp.label} 登录开关`}
                    checked={existing.isEnabled}
                    disabled={saving}
                    onCheckedChange={(next) => void handleToggle(sp.type, next)}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => (isEditing ? setEditingType(null) : startEdit(sp.type))}
                  className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
                >
                  {isEditing ? "收起编辑" : existing ? "修改凭证" : "配置凭证"}
                </button>
              </div>
            </div>

            {isEditing ? (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="mt-5 grid gap-4 border-t border-[var(--line)] pt-5 md:max-w-2xl"
              >
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-[var(--ink-soft)]">
                    Client ID
                  </span>
                  <input
                    type="text"
                    value={formClientId}
                    onChange={(e) => setFormClientId(e.target.value)}
                    placeholder="从 connect.linux.do 获取"
                    className="w-full rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 font-mono text-sm outline-none"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-[var(--ink-soft)]">
                    Client Secret
                  </span>
                  <input
                    type="password"
                    value={formClientSecret}
                    onChange={(e) => setFormClientSecret(e.target.value)}
                    placeholder={existing ? "留空则保留当前密钥不修改" : "从 connect.linux.do 获取"}
                    className="w-full rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 font-mono text-sm outline-none"
                  />
                </label>

                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[#faf7f1] px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <Shield className="size-4 text-[#c85a32]" aria-hidden />
                    <span>保存后启用此登录源</span>
                  </div>
                  <AdminSwitch
                    ariaLabel="保存后启用此登录源"
                    checked={formEnabled}
                    onCheckedChange={setFormEnabled}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    disabled={saving || !formClientId}
                    onClick={() => void handleSave(sp.type, sp.label)}
                    className="inline-flex items-center gap-2 rounded-full bg-[#c25934] px-5 py-2.5 text-sm font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a] disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Save className="size-4" aria-hidden />
                    )}
                    保存配置
                  </button>
                  <a
                    href={sp.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#b54722] hover:underline"
                  >
                    前往 {sp.label} 申请 OAuth 凭证
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </div>
              </motion.div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
