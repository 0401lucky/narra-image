"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";

import { cn } from "@/lib/utils";

type WordsSnapshot = {
  category: string;
  count: number;
  label: string;
  words: string[];
};

function ToggleField({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-[var(--accent)]"
      />
      <span>
        <span className="block text-sm font-medium text-[var(--ink)]">{label}</span>
        <span className="mt-0.5 block text-xs text-[var(--ink-soft)]">{hint}</span>
      </span>
    </label>
  );
}

type ModerationConfigFormProps = {
  config: {
    aiBaseUrl: string;
    aiConfigured: boolean;
    aiEnabled: boolean;
    aiModel: string | null;
    aiThreshold: number;
    isEnabled: boolean;
    sensitiveWordsEnabled: boolean;
    updatedAt: string | null;
  };
  words: WordsSnapshot[];
};

export function ModerationConfigForm({
  config,
  words,
}: ModerationConfigFormProps) {
  const [isEnabled, setIsEnabled] = useState(config.isEnabled);
  const [sensitiveWordsEnabled, setSensitiveWordsEnabled] = useState(
    config.sensitiveWordsEnabled,
  );
  const [aiEnabled, setAiEnabled] = useState(config.aiEnabled);
  const [aiBaseUrl, setAiBaseUrl] = useState(config.aiBaseUrl);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState(config.aiModel ?? "");
  const [aiThreshold, setAiThreshold] = useState(config.aiThreshold);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/moderation/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiApiKey: aiApiKey || undefined,
          aiBaseUrl,
          aiEnabled,
          aiModel,
          aiThreshold,
          isEnabled,
          sensitiveWordsEnabled,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setMessage({ text: json.error || "保存失败", type: "error" });
        return;
      }
      setAiApiKey("");
      setMessage({ text: "审核配置已保存并立即生效。", type: "success" });
    } catch {
      setMessage({ text: "保存时发生错误", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="grid gap-5 self-start">
        <div className="studio-card rounded-[1.8rem] p-6">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--ink)]">
            审核规则
          </h2>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            命中敏感词或 AI 判定违规时，本次生成会被拒绝（不扣积分），并记为一条触发事件。
          </p>

          <div className="mt-6 grid gap-4">
            <ToggleField
              checked={isEnabled}
              label="启用内容审核"
              hint="关闭后等于未接入审核，行为与之前一致。"
              onChange={setIsEnabled}
            />
            <ToggleField
              checked={sensitiveWordsEnabled}
              label="敏感词匹配（内置词库）"
              hint="中英文内置词库按类别匹配 prompt 与 negativePrompt。"
              onChange={setSensitiveWordsEnabled}
            />
            <ToggleField
              checked={aiEnabled}
              label="启用 AI 审核"
              hint="需配置下方端点与密钥。服务异常/超时自动放行，不会卡住生成。"
              onChange={setAiEnabled}
            />
          </div>

          <div className="mt-6 grid gap-4 rounded-[1.2rem] border border-[var(--line)] bg-[var(--surface-strong)]/40 p-4">
            <div>
              <label
                htmlFor="moderation-base-url"
                className="mb-2 block text-sm font-medium text-[var(--ink)]"
              >
                AI 审核 Base URL
              </label>
              <input
                id="moderation-base-url"
                type="text"
                value={aiBaseUrl}
                onChange={(event) => setAiBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)]/60 px-4 py-3 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)]/60 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
              />
            </div>

            <div>
              <label
                htmlFor="moderation-api-key"
                className="mb-2 block text-sm font-medium text-[var(--ink)]"
              >
                API Key
              </label>
              <input
                id="moderation-api-key"
                type="password"
                value={aiApiKey}
                onChange={(event) => setAiApiKey(event.target.value)}
                placeholder={config.aiConfigured ? "已配置（留空不改）" : "未配置"}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)]/60 px-4 py-3 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)]/60 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="moderation-model"
                  className="mb-2 block text-sm font-medium text-[var(--ink)]"
                >
                  Model
                </label>
                <input
                  id="moderation-model"
                  type="text"
                  value={aiModel}
                  onChange={(event) => setAiModel(event.target.value)}
                  placeholder="text-moderation-latest"
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)]/60 px-4 py-3 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)]/60 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                />
              </div>
              <div>
                <label
                  htmlFor="moderation-threshold"
                  className="mb-2 block text-sm font-medium text-[var(--ink)]"
                >
                  违规阈值 {aiThreshold.toFixed(2)}
                </label>
                <input
                  id="moderation-threshold"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={aiThreshold}
                  onChange={(event) => setAiThreshold(Number(event.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
              </div>
            </div>
          </div>

          {message ? (
            <div
              className={cn(
                "mt-5 rounded-xl px-4 py-3 text-sm",
                message.type === "success"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-red-200 bg-red-50 text-red-700",
              )}
            >
              {message.type === "success" ? (
                <CheckCircle2 className="mr-1 inline-block size-4" />
              ) : null}
              {message.text}
            </div>
          ) : null}

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[var(--accent)] disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存配置
          </button>
          <p className="mt-3 text-xs text-[var(--ink-soft)]">
            {config.updatedAt
              ? `最近更新：${new Date(config.updatedAt).toLocaleString("zh-CN", { hour12: false })}`
              : "使用环境变量默认值（尚未在后台保存过）。"}
          </p>
        </div>
      </div>

      {/* 词库只读 */}
      <div className="studio-card self-start rounded-[1.8rem] p-6">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center justify-between text-left"
        >
          <span>
            <h3 className="font-semibold text-[var(--ink)]">内置敏感词库</h3>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              只读展示；共 {words.reduce((sum, item) => sum + item.count, 0)} 词，按类别分组。
            </p>
          </span>
          <span className="text-xs text-[var(--ink-soft)]">{collapsed ? "展开 ▾" : "收起 ▴"}</span>
        </button>

        {!collapsed ? (
          <div className="mt-4 grid gap-4">
            {words.map((group) => (
              <div key={group.category}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--ink)]">
                    {group.label}
                  </span>
                  <span className="text-xs text-[var(--ink-soft)]">{group.count} 词</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
                  {group.words.join("、")}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}