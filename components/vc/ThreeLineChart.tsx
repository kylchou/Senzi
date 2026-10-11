"use client";

import { useId, useRef, useState } from "react";
import { toChartSeries } from "@/lib/forecasting/history";
import type { EstimatePoint } from "@/lib/vc/types";
import { CROWD_PRICE_LABEL, VERIFIED_PRICE_LABEL } from "@/lib/vc/constants";
import { formatShare } from "@/lib/vc/estimates";
import { formatDateTime } from "@/lib/vc/format";

const LEFT = 45;
const RIGHT = 655;
const WIDTH = 700;

/**
 * Model, crowd and verified-user prices over time. Hovering (or focusing and
 * using the arrow keys) shows all three values at that moment. Price history
 * is supplied by the engine adapter; no trade data enters the model.
 */
export function ThreeLineChart({ marketId, points, baseline }: { marketId: string; points: EstimatePoint[]; baseline: number | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tipId = useId();
  const [active, setActive] = useState<number | null>(null);

  const series = toChartSeries(marketId, points.map((p, sequence) => ({
    marketId, sequence, at: p.at, trigger: "model_update" as const, openingBaseline: baseline,
    model: p.modelValue ?? null, general: p.yesShare, specialized: p.specializedPrice ?? null,
    generalForecasters: p.participantCount, specializedForecasters: 0,
    generalAmount: p.totalCredits, specializedAmount: 0, estimateRuleId: "lmsr", estimateKind: "market_price" as const,
  })));
  const lines = [
    { key: "model" as const, label: "Model", color: "#6366f1" },
    { key: "general" as const, label: CROWD_PRICE_LABEL, color: "#059669" },
    { key: "specialized" as const, label: VERIFIED_PRICE_LABEL, color: "#d97706" },
  ];
  const first = points[0]?.at.getTime() ?? 0;
  const last = points.at(-1)?.at.getTime() ?? first;
  const x = (at: Date) => LEFT + (RIGHT - LEFT) * (at.getTime() - first) / (last - first || 1);
  const y = (v: number) => 190 - 160 * v;

  /** A series' value at point i: its own, or the latest earlier one (prices hold between trades). */
  const valueAt = (key: (typeof lines)[number]["key"], i: number) => {
    for (let j = i; j >= 0; j--) {
      const v = series[key][j]?.value;
      if (v != null) return v;
    }
    return null;
  };

  function nearest(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !points.length) return;
    const svgX = ((clientX - rect.left) / rect.width) * WIDTH;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i].at) - svgX) < Math.abs(x(points[best].at) - svgX)) best = i;
    }
    setActive(best);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!points.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(points.length - 1, Math.max(0, (a ?? (step > 0 ? -1 : points.length)) + step)));
    } else if (e.key === "Escape") {
      setActive(null);
    }
  }

  const hover = active !== null ? points[active] : null;
  const hoverX = hover ? x(hover.at) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300">
        {lines.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: l.color }} />
            {l.label}: <span className="font-medium tabular-nums">{formatShare(valueAt(l.key, points.length - 1), 1)}</span>
          </span>
        ))}
      </div>
      {!points.length ? (
        <p className="text-sm text-slate-500">No market history yet. The model baseline will appear when this question opens.</p>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} 230`}
            role="img"
            aria-label="Model, crowd price and verified-user price history. Focus and use the arrow keys to read values."
            aria-describedby={hover ? tipId : undefined}
            tabIndex={0}
            className="w-full touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            onPointerMove={(e) => nearest(e.clientX)}
            onPointerDown={(e) => nearest(e.clientX)}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
          >
            {[0, 0.5, 1].map((v) => (
              <g key={v}>
                <line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} stroke="currentColor" opacity="0.15" />
                <text x="5" y={y(v) + 4} fill="currentColor" fontSize="11">{v * 100}%</text>
              </g>
            ))}
            {lines.map((l) => {
              // Steps, not diagonals: a price holds until the next trade or model update.
              let connected = false;
              const path = series[l.key]
                .map((p) => {
                  if (p.value === null) { connected = false; return ""; }
                  const command = connected ? `H${x(p.at)} V${y(p.value)}` : `M${x(p.at)},${y(p.value)}`;
                  connected = true;
                  return command;
                })
                .join(" ");
              return (
                <g key={l.key}>
                  <path d={path} fill="none" stroke={l.color} strokeWidth="2" />
                  {series[l.key].filter((p) => p.value !== null).map((p, i) => (
                    <circle key={i} cx={x(p.at)} cy={y(p.value!)} r="2" fill={l.color} />
                  ))}
                </g>
              );
            })}
            {hover && (
              <g pointerEvents="none">
                <line x1={hoverX} x2={hoverX} y1={y(1)} y2={y(0)} stroke="currentColor" opacity="0.35" strokeDasharray="3 3" />
                {lines.map((l) => {
                  const v = valueAt(l.key, active!);
                  return v == null ? null : (
                    <circle key={l.key} cx={hoverX} cy={y(v)} r="4.5" fill={l.color} stroke="white" strokeWidth="2" />
                  );
                })}
              </g>
            )}
            <text x={LEFT} y="218" fill="currentColor" fontSize="11">{points[0].at.toISOString().slice(0, 10)}</text>
            <text x={RIGHT} textAnchor="end" y="218" fill="currentColor" fontSize="11">{points.at(-1)!.at.toISOString().slice(0, 10)}</text>
          </svg>
          {hover && (
            <div
              id={tipId}
              role="tooltip"
              className="pointer-events-none absolute top-0 z-10 w-max min-w-44 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
              style={{
                left: `${(hoverX / WIDTH) * 100}%`,
                // Flip to the left side of the crosshair past the middle, so the tooltip stays inside the chart.
                transform: hoverX > WIDTH / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
              }}
            >
              <p className="mb-1 font-medium text-slate-900 dark:text-slate-100">{formatDateTime(hover.at)}</p>
              <dl className="space-y-0.5">
                {lines.map((l) => (
                  <div key={l.key} className="flex items-center justify-between gap-4">
                    <dt className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: l.color }} />
                      {l.label}
                    </dt>
                    <dd className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatShare(valueAt(l.key, active!), 1)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
      {!series.specialized.some((p) => p.value !== null) && <p className="text-xs text-slate-500">No verified-user data yet.</p>}
      {points.length > 0 && (
        <details className="text-xs">
          <summary>View chart data</summary>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left">
              <thead><tr><th>UTC time</th><th>Model</th><th>Crowd</th><th>Verified users</th></tr></thead>
              <tbody>
                {points.map((p, i) => (
                  <tr key={i}>
                    <td>{p.at.toISOString()}</td>
                    <td>{formatShare(p.modelValue, 1)}</td>
                    <td>{formatShare(p.yesShare, 1)}</td>
                    <td>{formatShare(p.specializedPrice, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
