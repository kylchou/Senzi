import { toChartSeries } from "@/lib/forecasting/history";
import type { EstimatePoint } from "@/lib/vc/types";
import { CROWD_PRICE_LABEL, VERIFIED_PRICE_LABEL } from "@/lib/vc/constants";
import { formatShare } from "@/lib/vc/estimates";

/** Price history is supplied by the engine adapter. No trade data enters the model. */
export function ThreeLineChart({ marketId, points, baseline }: {marketId: string; points: EstimatePoint[]; baseline: number | null}) {
  const series = toChartSeries(marketId, points.map((p, sequence) => ({
    marketId, sequence, at: p.at, trigger: "model_update" as const, openingBaseline: baseline,
    model: p.modelValue ?? null, general: p.yesShare, specialized: p.specializedPrice ?? null,
    generalForecasters: p.participantCount, specializedForecasters: 0,
    generalAmount: p.totalCredits, specializedAmount: 0, estimateRuleId: "lmsr", estimateKind: "market_price" as const,
  })));
  const lines = [{key: "model" as const, label: "Model", color: "#6366f1"}, {key: "general" as const, label: CROWD_PRICE_LABEL, color: "#059669"}, {key: "specialized" as const, label: VERIFIED_PRICE_LABEL, color: "#d97706"}];
  const first = points[0]?.at.getTime() ?? 0;
  const last = points.at(-1)?.at.getTime() ?? first;
  const x = (at: Date) => 45 + 610 * (at.getTime()-first) / (last-first || 1);
  const y = (v: number) => 190 - 160*v;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300">{lines.map(l=><span key={l.key} className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{backgroundColor:l.color}}/>{l.label}: <span className="font-medium tabular-nums">{formatShare(series[l.key].at(-1)?.value,1)}</span></span>)}</div>
    {!points.length ? <p className="text-sm text-slate-500">No market history yet. The model baseline will appear when this question opens.</p> : <svg viewBox="0 0 700 230" role="img" aria-label="Model, crowd price and verified-user price history" className="w-full">
      {[0,.5,1].map(v=><g key={v}><line x1="45" x2="655" y1={y(v)} y2={y(v)} stroke="currentColor" opacity="0.15"/><text x="5" y={y(v)+4} fill="currentColor" fontSize="11">{v*100}%</text></g>)}
      {lines.map(l=>{
        let connected = false;
        const path = series[l.key].map(p=>{if(p.value===null){connected=false;return "";} const command=connected ? "L" : "M"; connected=true; return `${command}${x(p.at)},${y(p.value)}`;}).join(" ");
        return <g key={l.key}><path d={path} fill="none" stroke={l.color} strokeWidth="2"/>{series[l.key].filter(p=>p.value!==null).map((p,i)=><circle key={i} cx={x(p.at)} cy={y(p.value!)} r="2" fill={l.color}><title>{l.label}: {formatShare(p.value,1)} · {p.at.toISOString()}</title></circle>)}</g>;
      })}
      <text x="45" y="218" fill="currentColor" fontSize="11">{points[0].at.toISOString().slice(0,10)}</text><text x="655" textAnchor="end" y="218" fill="currentColor" fontSize="11">{points.at(-1)!.at.toISOString().slice(0,10)}</text>
    </svg>}
    {!series.specialized.some(p=>p.value!==null) && <p className="text-xs text-slate-500">No verified-user data yet.</p>}
    {points.length > 0 && <details className="text-xs"><summary>View chart data</summary><div className="overflow-auto max-h-64"><table className="w-full text-left"><thead><tr><th>UTC time</th><th>Model</th><th>Crowd</th><th>Verified users</th></tr></thead><tbody>{points.map((p,i)=><tr key={i}><td>{p.at.toISOString()}</td><td>{formatShare(p.modelValue,1)}</td><td>{formatShare(p.yesShare,1)}</td><td>{formatShare(p.specializedPrice,1)}</td></tr>)}</tbody></table></div></details>}
  </div>;
}
