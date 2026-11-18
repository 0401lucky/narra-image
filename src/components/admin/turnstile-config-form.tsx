"use client";

import { ExternalLink, Loader2, Save, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminSwitch } from "./ui/admin-switch";

type TurnstileConfigData = {
  isEnabled: boolean;
  protectGenerate: boolean;
  protectInviteRedeem: boolean;
  protectLogin: boolean;
  protectRegister: boolean;
  secretConfigured: boolean;
  siteKey: string;
};

type Scope = "Login" | "Register" | "InviteRedeem" | "Generate";

const SCOPE_META: Array<{ hint: string; key: Scope; label: string }> = [
  { hint: "保护 /login 登录表单，防撞库爆破", key: "Login", label: "登录页验证" },
  { hint: "保护 /register 注册表单，防批量注册", key: "Register", label: "注册页验证" },
  { hint: "保护 /invite-claim 公开领取，防脚本抢码", key: "InviteRedeem", label: "公开邀请码领取" },
  { hint: "保护创作生成接口（已登录用户每次生成均需验证，谨慎开启）", key: "Generate", label: "图像生成请求" },
];

type TurnstileConfigFormProps = {
  initialConfig: TurnstileConfigData;
};

export function TurnstileConfigForm({
  initialConfig,
}: TurnstileConfigFormProps) {
  const toast = useAdminToast();
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
        protectGenerate: config.protectGenerate,
        protectInviteRedeem: config.protectInviteRedeem,
        protectLogin: config.protectLogin,
        protectRegister: config.protectRegister,
        siteKey: siteKey.trim() || null,
      };
      if (secretInput) payload.secretKey = secretInput;

      const res = await fetch("/api/admin/turnstile", {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { config: TurnstileConfigData };
        error?: string;
      };
      if (!res.ok || !json.data) {
        const msg = json.error || "保存失败";
        setMessage({ text: msg, type: "error" });
        toast.error("Turnstile 保存失败", msg);
        return;
      }
      setConfig(json.data.config);
      setSiteKey(json.data.config.siteKey);
      setSecretInput("");
      setMessage({ text: "Turnstile 人机验证配置已更新并生效。", type: "success" });
      toast.success("人机验证配置已保存");
    } catch {
      setMessage({ text: "保存时发生网络错误", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  const totalProtect =
    Number(config.protectLogin) +
    Number(config.protectRegister) +
    Number(config.protectInviteRedeem) +
    Number(config.protectGenerate);

  const usable =
    config.isEnabled &&
    Boolean(siteKey.trim()) &&
    (config.secretConfigured || Boolean(secretInput));

  return (
    <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="grid gap-5 self-start">
        <div className="studio-card p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="admin-metric-icon shrink-0">
                <ShieldCheck className="size-4.5" aria-hidden />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-[var(--ink)]">
                    Turnstile 总开关
                  </h2>
                  <span
                    className={
                      usable
                        ? "rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800"
                        : "rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-600"
                    }
                  >
                    {usable ? `保护中 · ${totalProtect} 个场景` : "未生效"}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)] sm:text-sm">
                  {usable
                    ? "人机验证已激活，所选入口在提交前需完成无感/交互校验。"
                    : "需同时打开总开关并填写有效的 Site Key 与 Secret Key 才会生效。"}
                </p>
              </div>
            </div>

            <AdminSwitch
              ariaLabel="Turnstile 总开关"
              checked={config.isEnabled}
              onCheckedChange={(next) => setConfig((c) => ({ ...c, isEnabled: next }))}
            />
          </div>
        </div>

        <div className="studio-card grid gap-4 p-5 md:p-6">
          <h3 className="text-base font-semibold text-[var(--ink)]">Cloudflare 站点凭证</h3>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-[var(--ink-soft)]">Site Key（公开站点密钥）</span>
            <input
              value={siteKey}
              onChange={(e) => setSiteKey(e.target.value)}
              placeholder="0x4AAAAAA..."
              className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 font-mono text-sm outline-none"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="flex items-center gap-2 text-xs font-medium text-[var(--ink-soft)]">
              <span>Secret Key（服务端密钥）</span>
              {config.secretConfigured ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                  已加密存储
                </span>
              ) : null}
            </span>
            <input
              type="password"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              placeholder={config.secretConfigured ? "留空则保留当前已存储的 Secret Key" : "0x4AAAAAA..."}
              className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 font-mono text-sm outline-none"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-[var(--ink-soft)]">
            <span>
              本地调试测试 Site Key：
              <code className="ml-1 rounded bg-[#f4ede1] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink)]">
                1x00000000000000000000AA
              </code>
            </span>
            <a
              href="https://developers.cloudflare.com/turnstile/get-started/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-[#b54722] hover:underline"
            >
              申请凭证
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        </div>
      </div>

      <div className="grid gap-5 self-start">
        <div className="studio-card grid gap-4 p-5 md:p-6">
          <div>
            <h3 className="text-base font-semibold text-[var(--ink)]">受保护入口范围</h3>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              按业务风险单独控制哪些公开或高频入口要求校验 Turnstile 令牌。
            </p>
          </div>

          <div className="grid gap-2.5">
            {SCOPE_META.map((scope) => {
              const value = config[`protect${scope.key}` as keyof TurnstileConfigData] as boolean;
              return (
                <div
                  key={scope.key}
                  className="rounded-xl border border-[var(--line)] bg-[#faf7f1] px-4 py-3"
                >
                  <AdminSwitch
                    label={scope.label}
                    hint={scope.hint}
                    checked={value}
                    onCheckedChange={(next) => setProtect(scope.key, next)}
                  />
                </div>
              );
            })}
          </div>

          {message ? (
            <Alert variant={message.type === "success" ? "success" : "error"}>
              {message.text}
            </Alert>
          ) : null}

          <div className="flex justify-end border-t border-[var(--line)] pt-4">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-2 rounded-full bg-[#c25934] px-6 py-2.5 text-sm font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a] disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              保存配置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
