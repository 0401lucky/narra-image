"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { X } from "lucide-react";

export function InviteCreator() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [count, setCount] = useState(1);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const response = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, count }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error || "创建失败");
      return;
    }

    setNote("");
    setCount(1);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="studio-card rounded-[1.8rem] p-5 md:p-6">
      <h3 className="text-lg font-medium">创建邀请码</h3>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        建议为每个邀请码写备注，并可批量生成多个。
      </p>
      <div className="mt-4 flex flex-col gap-3 md:flex-row">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="备注，例如：首批设计师"
          className="flex-1 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none transition-all focus:border-[var(--accent)]"
        />
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="w-24 shrink-0 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-center outline-none transition-all focus:border-[var(--accent)]"
            title="生成数量"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(handleCreate)}
            className="shrink-0 rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-[var(--accent)] disabled:opacity-60"
          >
            {isPending ? "创建中..." : "批量生成"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}

export function CreditAdjuster({ userId }: { userId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleAdjust() {
    setError(null);

    const response = await fetch(`/api/admin/users/${userId}/credits`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error || "调整失败");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
          className="w-24 rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(handleAdjust)}
          className="rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-soft)] disabled:opacity-60"
        >
          更新积分
        </button>
      </div>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  );
}

export function FeatureToggleButton({
  featured,
  generationId,
}: {
  featured: boolean;
  generationId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleToggle() {
    await fetch(`/api/admin/generations/${generationId}/feature`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featured: !featured }),
    });

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(handleToggle)}
      className={`rounded-full px-3 py-2 text-xs font-medium ${
        featured
          ? "bg-[var(--accent)] text-white"
          : "border border-[var(--line)] text-[var(--ink-soft)]"
      }`}
    >
      {isPending ? "处理中..." : featured ? "取消精选" : "加入精选"}
    </button>
  );
}

type BuiltInProviderFormProps = {
  initialConfig: {
    apiKeyConfigured: boolean;
    baseUrl: string;
    creditCost: number;
    model: string;
    models: string[];
    name: string;
    source: "database" | "env";
  };
};

export function BuiltInProviderForm({
  initialConfig,
}: BuiltInProviderFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isFetchingModels, startFetchingModels] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>(initialConfig.models || []);
  const [baseUrl, setBaseUrl] = useState(initialConfig.baseUrl);
  const [model, setModel] = useState(initialConfig.model);
  const [name, setName] = useState(initialConfig.name);
  const [creditCost, setCreditCost] = useState(initialConfig.creditCost);
  const [apiKey, setApiKey] = useState("");

  async function handleSave() {
    setError(null);
    const response = await fetch("/api/admin/provider-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        baseUrl,
        creditCost,
        model,
        models: availableModels,
        name,
      }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error || "保存失败");
      return;
    }

    setApiKey("");
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleFetchModels() {
    setModelError(null);
    const response = await fetch("/api/provider-models/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        baseUrl,
      }),
    });
    const result = (await response.json()) as {
      data?: {
        models: Array<{
          id: string;
          imageLikely: boolean;
        }>;
      };
      error?: string;
    };

    if (!response.ok) {
      setModelError(result.error || "拉取模型失败");
      return;
    }

    const models = result.data?.models ?? [];
    setAvailableModels(models.map((item) => item.id));
    if (models[0]?.id) {
      setModel(models[0].id);
    }
  }

  return (
    <div className="studio-card rounded-[1.8rem] p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-lg font-medium">内置渠道配置</h3>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            当前来源：{initialConfig.source === "database" ? "后台数据库配置" : "环境变量兜底配置"}
          </p>
        </div>
        <div className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)]">
          API Key {initialConfig.apiKeyConfigured ? "已配置" : "未配置"}
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 md:col-span-2">
          <span className="text-sm text-[var(--ink-soft)]">渠道名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none"
          />
        </label>
        <label className="grid gap-2 md:col-span-2">
          <span className="text-sm text-[var(--ink-soft)]">Base URL</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://your-gateway.example.com/v1"
            className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm text-[var(--ink-soft)]">模型名</span>
          <div className="grid gap-2">
            <div className="flex gap-2">
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="flex-1 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none"
              />
              <button
                type="button"
                onClick={() => startFetchingModels(handleFetchModels)}
                disabled={isFetchingModels}
                className="rounded-full border border-[var(--line)] px-4 py-3 text-sm text-[var(--ink-soft)] disabled:opacity-60"
              >
                {isFetchingModels ? "拉取中..." : "拉取模型"}
              </button>
            </div>
            {availableModels.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {availableModels.slice(0, 12).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setModel(item)}
                    className={`rounded-full px-3 py-1.5 text-xs ${
                      model === item
                        ? "bg-[var(--ink)] text-white"
                        : "border border-[var(--line)] text-[var(--ink-soft)]"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
            {modelError ? (
              <p className="text-sm text-amber-700">{modelError}</p>
            ) : null}
          </div>
        </label>
        <label className="grid gap-2">
          <span className="text-sm text-[var(--ink-soft)]">每次扣分</span>
          <input
            type="number"
            value={creditCost}
            onChange={(event) => setCreditCost(Number(event.target.value))}
            className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none"
          />
        </label>
        <label className="grid gap-2 md:col-span-2">
          <span className="text-sm text-[var(--ink-soft)]">
            API Key
            <span className="ml-2 text-xs">留空则保留当前密钥</span>
          </span>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={initialConfig.apiKeyConfigured ? "••••••••" : "请输入新的 API Key"}
            className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none"
          />
        </label>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(handleSave)}
        className="mt-5 rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
      >
        {isPending ? "保存中..." : "保存内置渠道"}
      </button>
    </div>
  );
}

export function GenerationAdminCard({ job }: { job: any }) {
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <article className="studio-card flex flex-col xl:flex-row gap-5 p-5 rounded-[1.8rem]">
      {job.images && job.images[0] ? (
        <div className="shrink-0 flex justify-center">
          <img 
            src={job.images[0].url} 
            alt="Thumbnail" 
            className="size-32 xl:size-40 rounded-xl object-cover cursor-pointer hover:scale-105 transition border border-[var(--line)] shadow-sm" 
            onClick={() => setZoomedImage(job.images[0].url)}
          />
        </div>
      ) : (
        <div className="flex size-32 xl:size-40 shrink-0 mx-auto xl:mx-0 items-center justify-center rounded-xl bg-[var(--surface-strong)]/50 text-xs text-[var(--ink-soft)] border border-[var(--line)]">
          暂无图片
        </div>
      )}
      
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-[var(--ink-soft)] mb-2">
            <span className="truncate max-w-[150px]" title={job.user?.email}>{job.user?.email || "未知用户"}</span>
            <span className="shrink-0 rounded-full bg-[var(--surface-strong)] border border-[var(--line)] px-2 py-0.5">
              {job.providerMode === "BUILT_IN" ? "内置渠道" : "自填渠道"}
            </span>
          </div>
          <p className="line-clamp-2 text-sm text-[var(--ink)] leading-relaxed">
            {job.prompt}
          </p>
        </div>
        
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--line)]/50">
          <button 
            type="button" 
            onClick={() => setShowPrompt(true)}
            className="text-xs text-[var(--accent)] hover:underline font-medium"
          >
            完整提示词
          </button>
          <div className="flex items-center gap-3 text-xs text-[var(--ink-soft)]">
            <span className="shrink-0 bg-[var(--surface-strong)] rounded px-1.5 py-0.5">{job.model}</span>
            <span className="shrink-0 font-medium text-[var(--accent-soft)]">-{job.creditsSpent}</span>
          </div>
        </div>
        
        <div className="mt-4 flex items-center justify-end">
          <FeatureToggleButton featured={Boolean(job.featuredAt)} generationId={job.id} />
        </div>
      </div>

      {zoomedImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setZoomedImage(null)}
        >
          <button 
            type="button"
            className="absolute top-6 right-6 text-white/70 transition hover:text-white hover:scale-110"
            onClick={() => setZoomedImage(null)}
            title="关闭"
          >
            <X className="size-8" />
          </button>
          <img 
            src={zoomedImage} 
            alt="Zoomed" 
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}

      {showPrompt && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowPrompt(false)}
        >
          <div 
            className="studio-card relative w-full max-w-2xl rounded-[2rem] p-6 md:p-8 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              type="button"
              className="absolute top-6 right-6 text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
              onClick={() => setShowPrompt(false)}
            >
              <X className="size-6" />
            </button>
            <h3 className="text-xl font-semibold mb-6">完整提示词</h3>
            <p className="whitespace-pre-wrap text-[var(--ink)] leading-relaxed text-sm">
              {job.prompt}
            </p>
            {job.negativePrompt && (
              <div className="mt-6 border-t border-[var(--line)] pt-4">
                <h4 className="text-sm font-medium text-[var(--ink-soft)] mb-2">负向提示词</h4>
                <p className="whitespace-pre-wrap text-[var(--ink)]/80 leading-relaxed text-sm">
                  {job.negativePrompt}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
