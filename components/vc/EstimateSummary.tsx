import { formatShare, formatPointChange, type BaselineView, type Freshness } from "@/lib/vc/estimates";
import { formatDateTime } from "@/lib/vc/format";
import type { MarketEstimate } from "@/lib/vc/types";
export function EstimateSummary({baseline, estimate, freshness}: {baseline: BaselineView; estimate: MarketEstimate | null; freshness: Freshness}) {
 const model = estimate?.modelValue ?? baseline.value;
 const general = estimate?.generalPrice;
 const verified = estimate?.specializedPrice;
 return <div className="space-y-3">
   <dl className="grid gap-3 sm:grid-cols-3">{[
     {label:"Model prediction",value:formatShare(model,1),note:"Independent of trades; updated only from matching metric data."},
     {label:"General LMSR price",value:formatShare(general,1),note:"Market-maker price from all trades."},
     {label:"Verified-user LMSR price",value:formatShare(verified,1),note:verified == null ? "No verified-user data yet." : "Replay of verified users' trades."},
   ].map(m=><div className="rounded border p-3" key={m.label}><dt className="text-xs">{m.label}</dt><dd className="text-2xl font-semibold">{m.value}</dd><dd className="text-xs text-slate-500">{m.note}</dd></div>)}</dl>
   <p className="text-sm">Model - general: {formatPointChange(model != null && general != null ? model-general : null)} · Verified - general: {formatPointChange(verified != null && general != null ? verified-general : null)}</p>
   <p className="text-xs">Opening baseline: {formatShare(baseline.value,1)}. {baseline.methodology}</p>
   <p className="text-xs">{estimate?.participantCount ?? 0} traders{(estimate?.participantCount ?? 0) < 10 && " · Low participation"} · As of {formatDateTime(freshness.asOf)}{freshness.isStale && " · Estimate may be out of date"}</p>
 </div>;
}
