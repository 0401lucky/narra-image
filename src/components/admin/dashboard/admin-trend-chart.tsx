"use client";

import { useId, useMemo, useState } from "react";

import type { AdminDashboardTrendPoint } from "@/lib/server/admin-overview";
import { cn } from "@/lib/utils";
import { AdminTabs, type AdminTabOption } from "../ui/admin-tabs";

type TrendMetricMode = "generations" | "credits";

type AdminTrendChartProps = {
  points: AdminDashboardTrendPoint[];
};

const METRIC_TABS: AdminTabOption<TrendMetricMode>[] = [
  { label: "生成任务量", value: "generations" },
  { label: "积分消耗量", value: "credits" },
];

export function AdminTrendChart({ points }: AdminTrendChartProps) {
  const gradientId = useId();
  const [mode, setMode] = useState<TrendMetricMode>("generations");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const chartStats = useMemo(() => {
    const values = points.map((p) =>
      mode === "generations" ? p.total : p.creditsSpent,
    );
    const maxVal = Math.max(4, ...values);
    const totalSum = values.reduce((acc, v) => acc + v, 0);
    const totalFailed = points.reduce((acc, p) => acc + p.failed, 0);
    return { maxVal, totalFailed, totalSum, values };
  }, [mode, points]);

  const width = 640;
  const height = 210;
  const padLeft = 36;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 32;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const coords = useMemo(() => {
    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    return points.map((point, index) => {
      const value = mode === "generations" ? point.total : point.creditsSpent;
      const ratio = value / chartStats.maxVal;
      const x = padLeft + index * stepX;
      const y = padTop + innerH - ratio * innerH;
      return { point, value, x, y };
    });
  }, [chartStats.maxVal, innerH, innerW, mode, points]);

  const linePath = useMemo(() => {
    if (coords.length === 0) return "";
    return coords
      .map((c, idx) => `${idx === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(" ");
  }, [coords]);

  const areaPath = useMemo(() => {
    if (coords.length === 0) return "";
    const first = coords[0];
    const last = coords[coords.length - 1];
    const baseY = padTop + innerH;
    return `${linePath} L ${last.x.toFixed(1)} ${baseY} L ${first.x.toFixed(1)} ${baseY} Z`;
  }, [coords, innerH, linePath]);

  const activeCoord =
    hoverIdx !== null ? coords[hoverIdx] : coords[coords.length - 1];

  return (
    <section className="studio-card p-5 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)] sm:text-lg">
            近 7 日运营趋势
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ink-soft)] sm:text-sm">
            {mode === "generations"
              ? `7 日累计提交 ${chartStats.totalSum.toLocaleString("zh-CN")} 次任务（失败 ${chartStats.totalFailed} 次）`
              : `7 日累计结算消耗 ${chartStats.totalSum.toLocaleString("zh-CN")} 积分`}
          </p>
        </div>

        <AdminTabs
          ariaLabel="趋势指标切换"
          layoutId="dashboard-trend-tabs"
          options={METRIC_TABS}
          value={mode}
          onChange={setMode}
        />
      </div>

      {activeCoord ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[#faf7f1] px-3.5 py-2 text-xs">
          <span className="font-mono font-semibold text-[var(--ink)]">
            日期 {activeCoord.point.dateKey}
          </span>
          {mode === "generations" ? (
            <div className="flex flex-wrap items-center gap-3 font-mono">
              <span className="text-[var(--ink)]">
                总计 <strong>{activeCoord.point.total}</strong>
              </span>
              <span className="text-emerald-700">
                成功 <strong>{activeCoord.point.succeeded}</strong>
              </span>
              <span
                className={cn(
                  activeCoord.point.failed > 0
                    ? "font-semibold text-rose-600"
                    : "text-[var(--ink-soft)]",
                )}
              >
                失败 <strong>{activeCoord.point.failed}</strong>
              </span>
            </div>
          ) : (
            <span className="font-mono font-semibold text-[#b54722]">
              当日消耗 {activeCoord.point.creditsSpent.toLocaleString("zh-CN")} 积分
            </span>
          )}
        </div>
      ) : null}

      <div className="mt-4 w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="近 7 日运营趋势折线图"
          className="h-52 w-full min-w-[420px] select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c85a32" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#c85a32" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((step) => {
            const y = padTop + innerH - step * innerH;
            const tickVal = Math.round(step * chartStats.maxVal);
            return (
              <g key={step}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  stroke="rgba(54, 35, 18, 0.08)"
                  strokeDasharray="4 4"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-[#7c6a5a] font-mono text-[10px]"
                >
                  {tickVal}
                </text>
              </g>
            );
          })}

          {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
          {linePath ? (
            <path
              d={linePath}
              fill="none"
              stroke="#c85a32"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {coords.map((c, idx) => {
            const isHovered = hoverIdx === idx;
            return (
              <g
                key={c.point.dateKey}
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(idx)}
              >
                {isHovered ? (
                  <line
                    x1={c.x}
                    x2={c.x}
                    y1={padTop}
                    y2={padTop + innerH}
                    stroke="rgba(200, 90, 50, 0.35)"
                    strokeWidth={1}
                  />
                ) : null}
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={isHovered ? 5.5 : 4}
                  fill={isHovered ? "#c85a32" : "#ffffff"}
                  stroke="#c85a32"
                  strokeWidth={2.2}
                />
                <text
                  x={c.x}
                  y={height - 10}
                  textAnchor="middle"
                  className={cn(
                    "font-mono text-[11px]",
                    isHovered ? "fill-[#21170f] font-semibold" : "fill-[#7c6a5a]",
                  )}
                >
                  {c.point.label}
                </text>
                <rect
                  x={c.x - 28}
                  y={padTop}
                  width={56}
                  height={innerH + 24}
                  fill="transparent"
                />
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
