"use client";

import { Loader2, Save, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminSwitch } from "./ui/admin-switch";

type WordsSnapshot = {
  category: string;
  count: number;
  label: string;
  words: string[];
};

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
  const toast = useAdminToast();
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
  const [wordQuery, setWordQuery] = useState("");

  const totalWords = useMemo(
    () => words.reduce((sum, item) => sum + item.count, 0),
    [words],
  );

  const filteredWordGroups = useMemo(() => {
    const q = wordQuery.trim().toLowerCase();
    if (!q) return words;
    return words
      .map((group) => {
        if (group.label.toLowerCase().includes(q)) return group;
        const matched = group.words.filter((w) => w.toLowerCase().includes(q));
        return {
          ...group,
          count: matched.length,
          words: matched,
        };
      })
      .filter((group) => group.words.length > 0);
  }, [wordQuery, words]);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/moderation/config", {
        body: JSON.stringify({
          aiApiKey: aiApiKey || undefined,
          aiBaseUrl,
          aiEnabled,
          aiModel,
          aiThreshold,
          isEnabled,
          sensitiveWordsEnabled,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        const msg = json.error || "保存失败";
        setMessage({ text: msg, type: "error" });
        toast.error("审核配置保存失败", msg);
        return;
      }
      setAiApiKey("");
      const okMsg = "内容审核规则已保存并立即生效。";
      setMessage({ text: okMsg, type: "success" });
      toast.success("审核规则已更新", okMsg);
    } catch {
      setMessage({ text: "保存时发生网络错误", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
      <div className="grid gap-5 self-start">
        <div className="studio-card p-5 md:p-6">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
            审核拦截开关与 AI 阈值
          </h2>
          <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
            命中敏感词或 AI 判定超阈值时立即拒绝生成（不扣减用户积分），并自动写入风控拦截流水。
          </p>

          <div className="mt-5 grid gap-3">
            <div className="rounded-xl border border-[var(--line)] bg-[#faf7f1] px-4 py-3">
              <AdminSwitch
                checked={isEnabled}
                label="启用全站内容审核"
                hint="总开关；关闭后生图请求不经过敏感词与 AI 审查。"
                onCheckedChange={setIsEnabled}
              />
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-[#faf7f1] px-4 py-3">
              <AdminSwitch
                checked={sensitiveWordsEnabled}
                label="启用内置敏感词匹配"
                hint="毫秒级同步扫描正向与负向提示词中的中英文高危词条。"
                onCheckedChange={setSensitiveWordsEnabled}
              />
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-[#faf7f1] px-4 py-3">
              <AdminSwitch
                checked={aiEnabled}
                label="启用上游 AI 语义审核"
                hint="调用 OpenAI Moderations 兼容接口；上游异常或超时将自动降级放行，不阻塞生图。"
                onCheckedChange={setAiEnabled}
              />
            </div>
          </div>

          <div className="mt-5 grid gap-4 rounded-xl border border-[var(--line)] bg-[#faf7f1]/70 p-4">
            <div>
              <label
                htmlFor="moderation-base-url"
                className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]"
              >
                AI 审核 Base URL
              </label>
              <input
                id="moderation-base-url"
                type="text"
                value={aiBaseUrl}
                onChange={(event) => setAiBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm text-[var(--ink)] outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="moderation-api-key"
                className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]"
              >
                AI 审核 API Key
              </label>
              <input
                id="moderation-api-key"
                type="password"
                value={aiApiKey}
                onChange={(event) => setAiApiKey(event.target.value)}
                placeholder={config.aiConfigured ? "已加密存储（留空不修改）" : "未配置"}
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm text-[var(--ink)] outline-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="moderation-model"
                  className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]"
                >
                  审核模型（Model）
                </label>
                <input
                  id="moderation-model"
                  type="text"
                  value={aiModel}
                  onChange={(event) => setAiModel(event.target.value)}
                  placeholder="text-moderation-latest"
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm text-[var(--ink)] outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="moderation-threshold"
                  className="mb-1.5 flex items-center justify-between text-xs font-medium text-[var(--ink-soft)]"
                >
                  <span>拦截违规分阈值</span>
                  <span className="rounded bg-white px-2 py-0.5 font-mono font-semibold text-[#b54722]">
                    {aiThreshold.toFixed(2)}
                  </span>
                </label>
                <input
                  id="moderation-threshold"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={aiThreshold}
                  onChange={(event) => setAiThreshold(Number(event.target.value))}
                  className="mt-2 w-full accent-[#c85a32]"
                />
              </div>
            </div>
          </div>

          {message ? (
            <div className="mt-4">
              <Alert variant={message.type === "success" ? "success" : "error"}>
                {message.text}
              </Alert>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
            <span className="text-xs text-[var(--ink-soft)]">
              {config.updatedAt
                ? `最近保存：${new Date(config.updatedAt).toLocaleString("zh-CN", { hour12: false })}`
                : "当前使用默认环境变量配置"}
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c85a32] disabled:opacity-60"
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

      {/* 内置敏感词库检索面板 */}
      <div className="studio-card flex max-h-[720px] flex-col self-start p-5 md:p-6">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-[var(--ink)]">内置敏感词库</h3>
            <span className="rounded-full bg-[#efe8dc] px-2.5 py-0.5 font-mono text-xs font-semibold text-[var(--ink-soft)]">
              {totalWords} 词
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            只读内置词表，支持输入关键词即时检索定位所属分类。
          </p>
        </div>

        <div className="relative mt-3.5">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-soft)]"
            aria-hidden
          />
          <input
            type="text"
            value={wordQuery}
            onChange={(event) => setWordQuery(event.target.value)}
            placeholder="检索敏感词或类别名称…"
            className="w-full rounded-xl border border-[var(--line)] bg-white py-2 pr-8 pl-8.5 text-xs outline-none"
          />
          {wordQuery ? (
            <button
              type="button"
              onClick={() => setWordQuery("")}
              aria-label="清空词库搜索"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)]"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="premium-scrollbar mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
          {filteredWordGroups.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--ink-soft)]">
              未匹配到包含「{wordQuery}」的内置词条
            </div>
          ) : (
            filteredWordGroups.map((group) => (
              <div
                key={group.category}
                className="rounded-xl border border-[var(--line)] bg-[#faf7f1] p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--ink)]">
                    {group.label}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--ink-soft)]">
                    {group.count} 词
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.words.map((word) => (
                    <span
                      key={`${group.category}-${word}`}
                      className="rounded-md border border-[var(--line)] bg-white px-2 py-0.5 font-mono text-[11px] text-[var(--ink-soft)]"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
