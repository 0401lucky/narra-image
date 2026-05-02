"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Save, ShieldCheck, ToggleLeft, ToggleRight } from "lucide-react";

type TurnstileConfigData = {
  isEnabled: boolean;
  siteKey: string;
  secretConfigured: boolean;
  protectLogin: boolean;
  protectRegister: boolean;
  protectInviteRedeem: boolean;
  protectGenerate: boolean;
};

type Scope = "Login" | "Register" | "InviteRedeem" | "Generate";

const SCOPE_META: Array<{ key: Scope; label: string; hint: string }> = [
  { key: "Login", label: "登录页", hint: "保护 /login 表单" },
  { key: "Register", label: "注册页", hint: "保护 /register 表单" },
  { key: "InviteRedeem", label: "邀请码兑换", hint: "保护 /invite-claim 公开领取" },
  { key: "Generate", label: "图像生成", hint: "保护 /api/create（已登录用户每次生成都需验证）" },
];

export function TurnstileConfigForm({
  initialConfig,
}: {
  initialConfig: TurnstileConfigData;
}) {
  const [config, setConfig] = useState<TurnstileConfigData>(initialConfig);
  const [siteKey, setSiteKey] = useState(initialConfig.siteKey);
  const [secretInput, setSecretInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  function setProtect(key: Scope, value: boolean) {
    setConfig((c) => ({ ...c, [`protect${key}`]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        isEnabled: config.isEnabled,
        siteKey: siteKey.trim() || null,
        protectLogin: config.protectLogin,
        protectRegister: config.protectRegister,
        protectInviteRedeem: config.protectInviteRedeem,
        protectGenerate: config.protectGenerate,
      };
      if (secretInput) payload.secretKey = secretInput;

      const res = await fetch("/api/admin/turnstile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { data?: { config: TurnstileConfigData }; error?: string };
      if (!res.ok || !json.data) {
        setMessage({ text: json.error || "保存失败", type: "error" });
        return;
      }
      setConfig(json.data.config);
      setSiteKey(json.data.config.siteKey);
      setSecretInput("");
      setMessage({ text: "已保存", type: "success" });
    } catch {
      setMessage({ text: "保存时发生错误", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  const totalProtect =
    Number(config.protectLogin) +
    Number(config.protectRegister) +
    Number(config.protectInviteRedeem) +
    Number(config.protectGenerate);

  const usable = config.isEnabled && Boolean(siteKey.trim()) && (config.secretConfigured || Boolean(secretInput));

  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-5 text-[var(--accent)]" />
        <h2 className="text-xl font-semibold text-[var(--ink)]">Cloudflare Turnstile</h2>
      </div>

      <p className="text-sm text-[var(--ink-soft)]">
        Turnstile 是 Cloudflare 提供的免费人机验证服务，无需托管在 Cloudflare 即可使用，主要用于防止登录/注册/邀请码兑换被自动化脚本批量调用。
      </p>

      <div className="studio-card rounded-2xl p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-[var(--ink)]">总开关</h3>
            <p className="text-xs text-[var(--ink-soft)]">
              {usable ? `已启用，正在保护 ${totalProtect} 个场景` : "未启用或未配置 site key / secret"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfig((c) => ({ ...c, isEnabled: !c.isEnabled }))}
            className="flex items-center gap-1.5"
          >
            {config.isEnabled ? (
              <>
                <ToggleRight className="size-6 text-emerald-500" />
                <span className="text-sm text-emerald-600">启用</span>
              </>
            ) : (
              <>
                <ToggleLeft className="size-6 text-[var(--ink-soft)]" />
                <span className="text-sm text-[var(--ink-soft)]">停用</span>
              </>
            )}
          </button>
        </div>
      </div>

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

      <div className="studio-card grid gap-4 rounded-2xl p-5">
        <h3 className="font-semibold text-[var(--ink)]">凭证</h3>

        <div className="grid gap-1.5">
          <label className="text-sm font-medium text-[var(--ink)]">Site Key</label>
          <input
            value={siteKey}
            onChange={(e) => setSiteKey(e.target.value)}
            placeholder="0x4AAAAAA..."
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)]/60 px-4 py-2.5 font-mono text-sm outline-none transition focus:border-[var(--accent)]"
          />
        </div>

        <div className="grid gap-1.5">
          <label className="text-sm font-medium text-[var(--ink)]">
            Secret Key
            {config.secretConfigured && (
              <span className="ml-2 text-xs text-emerald-600">已配置</span>
            )}
          </label>
          <input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            placeholder={config.secretConfigured ? "留空则保留当前 secret" : "0x4AAAAAA..."}
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)]/60 px-4 py-2.5 font-mono text-sm outline-none transition focus:border-[var(--accent)]"
          />
        </div>

        <a
          href="https://developers.cloudflare.com/turnstile/get-started/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
        >
          前往 Cloudflare 控制台申请凭证 <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="studio-card grid gap-3 rounded-2xl p-5">
        <h3 className="font-semibold text-[var(--ink)]">保护范围</h3>
        <p className="text-xs text-[var(--ink-soft)]">仅当总开关启用且凭证齐全时，下列保护才会生效。</p>

        <div className="grid gap-2">
          {SCOPE_META.map((scope) => {
            const value = config[`protect${scope.key}` as keyof TurnstileConfigData] as boolean;
            return (
              <button
                key={scope.key}
                type="button"
                onClick={() => setProtect(scope.key, !value)}
                className="flex items-center justify-between rounded-xl border border-[var(--line)] px-4 py-3 text-left transition hover:bg-[var(--surface-strong)]"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--ink)]">{scope.label}</div>
                  <div className="text-xs text-[var(--ink-soft)]">{scope.hint}</div>
                </div>
                {value ? (
                  <ToggleRight className="size-5 text-emerald-500" />
                ) : (
                  <ToggleLeft className="size-5 text-[var(--ink-soft)]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--accent)] disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存配置
        </button>
        <p className="text-xs text-[var(--ink-soft)]">
          提示：开发环境可使用测试 site key{" "}
          <code className="rounded bg-[var(--surface-strong)] px-1.5 py-0.5 font-mono text-[10px]">
            1x00000000000000000000AA
          </code>
          （永远通过）
        </p>
      </div>
    </div>
  );
}