"use client";

import { Clock3, HardDrive, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { IMAGE_CLEANUP_PREVIEW_LIMIT, type ImageMaintenanceJob } from "@/lib/storage/image-maintenance-types";
import type { ImageManagementOverview } from "@/lib/storage/image-management-types";
import { cn } from "@/lib/utils";
import { STORAGE_JOB_LABELS, STORAGE_MODE_LABELS, STORAGE_REASON_LABELS } from "./constants";
import { useStorageManagement } from "./use-storage-management";
import { formatStorageBytes, storageTimestamp } from "./utils";

type StorageManagerProps = { initialOverview: ImageManagementOverview; initialJob: ImageMaintenanceJob | null };
const inputClass = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] disabled:opacity-50";
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50";

export function StorageManager(props: StorageManagerProps) {
  const state = useStorageManagement(props);
  const { overview, draft, setDraft, job, preview, busy } = state;
  const usage = [
    { label: "已用空间", value: formatStorageBytes(overview.usedBytes), bytes: overview.usedBytes, id: "storage-used" },
    { label: "写入预留", value: formatStorageBytes(overview.reservedBytes), bytes: overview.reservedBytes, id: "storage-reserved" },
    { label: "容量上限", value: formatStorageBytes(overview.policy.limitBytes), bytes: overview.policy.limitBytes, id: "storage-limit" },
    { label: "可清理空间", value: formatStorageBytes(overview.cleanableBytes), bytes: overview.cleanableBytes, id: "storage-cleanable" },
  ];

  return (
    <div className="grid gap-6" data-testid="storage-manager">
      {state.error && <Alert title="操作未完成">{state.error}</Alert>}
      {state.notice && <Alert variant="success">{state.notice}</Alert>}
      {!overview.managedEnabled && <Alert variant="info">当前部署尚未启用图片纳管。请先完成图片存储配置，再开启清理。</Alert>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="图片存储用量">
        {usage.map((stat) => (
          <div key={stat.id} className="studio-card rounded-2xl p-5">
            <p className="text-sm text-[var(--ink-soft)]">{stat.label}</p>
            <output data-testid={stat.id} data-bytes={stat.bytes} className="mt-2 block text-2xl font-semibold tabular-nums text-[var(--ink)]">{stat.value}</output>
          </div>
        ))}
      </section>

      <section className="studio-card rounded-[1.8rem] p-5 md:p-6" aria-labelledby="storage-scope-title">
        <h2 id="storage-scope-title" className="flex items-center gap-2 text-lg font-semibold text-[var(--ink)]"><HardDrive aria-hidden className="size-5" />图片清单</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div><dt className="text-[var(--ink-soft)]">已登记图片</dt><dd className="mt-1 font-medium">{overview.assetCount} 张</dd></div>
          <div><dt className="text-[var(--ink-soft)]">物理文件</dt><dd className="mt-1 font-medium">{overview.objectCount} 份</dd></div>
          <div><dt className="text-[var(--ink-soft)]">受保护空间</dt><dd className="mt-1 font-medium">{formatStorageBytes(overview.protectedBytes)}</dd></div>
          <div><dt className="text-[var(--ink-soft)]">待盘点历史图片</dt><dd className="mt-1 font-medium" data-testid="storage-unmanaged">{overview.unmanagedImageCount} 张</dd></div>
        </dl>
        <p className="mt-4 text-sm leading-6 text-[var(--ink-soft)]">新图片存储于{overview.writeBackend === "local" ? "服务器本地" : "对象存储"}。用量包含已登记的全部副本和写入预留；待盘点图片大小尚未核实，不计入可清理空间。</p>
        <p className="mt-1 text-xs leading-6 text-[var(--ink-soft)]">仅管理生成图片、上传参考图和画布导入图片。视频、缓存、数据库及其他服务器文件不在本页容量统计内。1 GB = 1,000,000,000 字节。</p>
        {overview.locations.length > 0 && <ul className="mt-4 flex flex-wrap gap-2" aria-label="图片存储位置">
          {overview.locations.map((location, index) => <li key={location.id} className="rounded-full bg-[var(--surface-strong)] px-3 py-1.5 text-xs text-[var(--ink-soft)]">{location.provider === "LOCAL" ? "本地" : "对象存储"} {index + 1} · {location.objectCount} 份 · {formatStorageBytes(location.usedBytes)}</li>)}
        </ul>}
      </section>

      <section className="studio-card rounded-[1.8rem] p-5 md:p-6" aria-labelledby="storage-policy-title">
        <h2 id="storage-policy-title" className="flex items-center gap-2 text-xl font-semibold text-[var(--ink)]"><Clock3 aria-hidden className="size-5" />清理策略</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">开启后，后台会按策略处理符合条件的图片。精选、正在使用的素材和画布原图宽限期始终受保护。</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label htmlFor="storage-enabled" className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--line)] p-3 text-sm"><input id="storage-enabled" type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />启用图片清理</label>
          <label htmlFor="storage-quota-cleanup" className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--line)] p-3 text-sm"><input id="storage-quota-cleanup" type="checkbox" checked={draft.quotaCleanupEnabled} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, quotaCleanupEnabled: event.target.checked }))} />容量不足时自动清理</label>
          <label htmlFor="storage-schedule" className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--line)] p-3 text-sm"><input id="storage-schedule" type="checkbox" checked={draft.scheduleEnabled} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, scheduleEnabled: event.target.checked }))} />启用定时清理</label>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div><label htmlFor="storage-limit-gb" className="text-sm font-medium">容量上限（GB）</label><input id="storage-limit-gb" inputMode="decimal" value={draft.limitGb} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, limitGb: event.target.value }))} className={inputClass} /></div>
          <div><label htmlFor="storage-retention-days" className="text-sm font-medium">保留天数</label><input id="storage-retention-days" type="number" min={1} max={3650} value={draft.retentionDays} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, retentionDays: event.target.value }))} className={inputClass} /></div>
          <div><label htmlFor="storage-interval-hours" className="text-sm font-medium">清理间隔（小时）</label><input id="storage-interval-hours" type="number" min={1 / 60} max={8760} step="any" value={draft.intervalHours} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, intervalHours: event.target.value }))} className={inputClass} /></div>
        </div>
        <p className="mt-3 text-xs leading-6 text-[var(--ink-soft)]">定时清理按保留天数筛选；容量不足时可以更早清理普通历史图片。降低上限不会立即删除文件，无法回收足够空间时会暂停新增图片。</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={state.savePolicy} className={cn(buttonClass, "border-transparent bg-[#c25934] text-white hover:bg-[#ad4c2a]")}>保存清理策略</button>
          <button type="button" disabled={busy} onClick={state.reloadPolicy} className={buttonClass}>重新载入策略</button>
          <span className="text-xs text-[var(--ink-soft)]">下次定时清理：{overview.policy.enabled && overview.policy.scheduleEnabled ? storageTimestamp(overview.policy.nextRunAt) : "未启用"}</span>
        </div>
      </section>

      <section className="studio-card rounded-[1.8rem] p-5 md:p-6" aria-labelledby="storage-cleanup-title">
        <h2 id="storage-cleanup-title" className="flex items-center gap-2 text-xl font-semibold text-[var(--ink)]"><Trash2 aria-hidden className="size-5" />一键清理</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">先预览本次范围，再确认删除。生成任务、提示词和计费记录会保留。</p>
        <div className="mt-5 grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div><label htmlFor="storage-cleanup-mode" className="text-sm font-medium">清理范围</label><select id="storage-cleanup-mode" value={state.cleanupMode} disabled={busy} onChange={(event) => state.setCleanupMode(event.target.value as "MANUAL_AGE" | "MANUAL_ALL")} className={inputClass}><option value="MANUAL_AGE">超过指定保留天数</option><option value="MANUAL_ALL">全部可清理历史图片</option></select></div>
          {state.cleanupMode === "MANUAL_AGE" ? <div><label htmlFor="storage-cleanup-days" className="text-sm font-medium">本次保留天数</label><input id="storage-cleanup-days" type="number" min={1} max={3650} value={state.cleanupDays} disabled={busy} onChange={(event) => state.setCleanupDays(event.target.value)} className={inputClass} /></div> : <p className="text-sm leading-6 text-[var(--ink-soft)]">仍保留正在使用、写入或处于宽限期的图片。</p>}
          <button type="button" disabled={busy || !overview.managedEnabled || !overview.policy.enabled} onClick={state.previewCleanup} className={buttonClass}>预览清理</button>
        </div>
        {!overview.policy.enabled && <p className="mt-3 text-sm text-[var(--ink-soft)]">请先保存并启用图片清理策略。</p>}
        {preview && <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-5" role="region" aria-label="清理预览" data-testid="storage-preview">
          <p className="font-semibold text-[var(--ink)]">预计清理 {preview.assetCount} 张图片、{preview.objectCount} 份文件，释放 {formatStorageBytes(preview.estimatedBytes)}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">仅处理本次预览范围；确认前后新增的使用关系会再次检查并跳过。文件删除后无法恢复。</p>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">预览有效期至 {storageTimestamp(preview.expiresAt)}</p>
          {preview.truncated && <p className="mt-2 text-sm text-amber-800">本次仅包含前 {IMAGE_CLEANUP_PREVIEW_LIMIT} 张可清理图片，完成后可再次预览剩余范围。</p>}
          <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy || preview.objectCount === 0} onClick={state.confirmCleanup} className={cn(buttonClass, "border-transparent bg-rose-700 text-white hover:bg-rose-800")}>确认清理</button><button type="button" disabled={busy} onClick={state.clearPreview} className={buttonClass}>取消预览</button></div>
        </div>}
      </section>

      <section className="studio-card rounded-[1.8rem] p-5 md:p-6" aria-labelledby="storage-jobs-title">
        <h2 id="storage-jobs-title" className="flex items-center gap-2 text-xl font-semibold text-[var(--ink)]"><ShieldCheck aria-hidden className="size-5" />清理进度与结果</h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">关闭页面不会中断已提交的任务，重新打开可继续查看结果。</p>
        {job ? <div className="mt-5 rounded-2xl border border-[var(--line)] p-4" data-testid="storage-job" data-job-id={job.id} data-state={job.state}>
          <div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="font-semibold">{STORAGE_MODE_LABELS[job.mode]} · {STORAGE_JOB_LABELS[job.state]}</p><button type="button" disabled={busy} onClick={() => state.loadJob(job.id)} className={buttonClass}><RefreshCw aria-hidden className="size-4" />刷新进度</button></div>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4"><div><dt className="text-[var(--ink-soft)]">实际释放</dt><dd data-testid="storage-job-released" data-bytes={job.releasedBytes} className="mt-1 font-semibold">{formatStorageBytes(job.releasedBytes)}</dd></div><div><dt className="text-[var(--ink-soft)]">成功 / 跳过</dt><dd className="mt-1">{job.completedItems} / {job.skippedItems} 份</dd></div><div><dt className="text-[var(--ink-soft)]">失败待重试</dt><dd className="mt-1">{job.failedItems} 份</dd></div><div><dt className="text-[var(--ink-soft)]">尚待处理</dt><dd className="mt-1">{job.pendingItems} / {job.totalItems} 份</dd></div></dl>
          {job.nextAttemptAt && <p className="mt-3 text-xs text-[var(--ink-soft)]">下次重试：{storageTimestamp(job.nextAttemptAt)}</p>}
          {state.pollError && <div className="mt-3"><Alert title="进度读取暂时失败">{state.pollError}。任务仍在后台处理，请点击“刷新进度”。</Alert></div>}
          {job.items.some((item) => item.reason) && <ul className="mt-4 space-y-1 text-xs text-[var(--ink-soft)]" aria-label="清理处理说明">{job.items.filter((item) => item.reason).map((item) => <li key={item.id}>{STORAGE_REASON_LABELS[item.reason ?? ""] ?? "图片状态暂不允许清理"} · {formatStorageBytes(item.byteLength)}</li>)}</ul>}
          {job.nextCursor && <p className="mt-3 text-xs text-[var(--ink-soft)]">当前展示前 {job.items.length} 项说明，以上汇总包含整个任务。</p>}
          {state.jobActive && <button type="button" disabled={busy} onClick={state.cancelJob} className={cn(buttonClass, "mt-4")}>停止后续清理</button>}
        </div> : <p className="mt-5 text-sm text-[var(--ink-soft)]">尚无清理任务。</p>}
        {overview.recentJobs.length > 0 && <div className="mt-5"><h3 className="text-sm font-medium">最近清理记录</h3><ul className="mt-2 divide-y divide-[var(--line)]">{overview.recentJobs.map((item) => <li key={item.id}><button type="button" disabled={busy} onClick={() => state.loadJob(item.id)} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-sm text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50"><span>{STORAGE_MODE_LABELS[item.mode]} · {STORAGE_JOB_LABELS[item.state]}</span><span>{storageTimestamp(item.createdAt)} · 实际释放 {formatStorageBytes(item.releasedBytes)}</span></button></li>)}</ul></div>}
      </section>
    </div>
  );
}
