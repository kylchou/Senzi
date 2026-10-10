"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { IntakeMetric } from "@/lib/model/intake";
import { vcFetch } from "@/lib/vc/client";
import { buttonPrimary, inputClass, labelClass } from "./styles";

export function CompanyMetricsForm({ startupId, metrics, demo }: {startupId: string; metrics: IntakeMetric[]; demo: boolean}) {
  const router = useRouter();
  const [metricId, setMetric] = useState(metrics[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [simulated, setSimulated] = useState(demo);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const weekly = metrics.find(m => m.id === metricId)?.kind === "weekly_total";
  return <form className="space-y-3" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setMessage(""); setError(false);
    try {
      await vcFetch(`/api/vc/companies/${startupId}/metrics`, {method: "PUT", json: {observations: [{metricId, value: Number(value), periodStart: weekly ? start : end, periodEnd: end, note, simulated}]}});
      setMessage("Saved privately to your organization. Drafts use it the next time they're estimated, and open markets' model lines pick it up on the next refresh.");
      router.refresh();
    } catch(e) { setError(true); setMessage(e instanceof Error ? e.message : "Save failed"); }
    finally {setBusy(false);}
  }}>
    <p className="text-sm text-slate-500">Sponsor-provided figures are visible only to your firm. Only the question&apos;s own metric affects its baseline. Enter additional dates to build a history.</p>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className={labelClass}>Metric<select className={inputClass} value={metricId} onChange={e=>setMetric(e.target.value)}>{metrics.map(m=><option key={m.id} value={m.id}>{m.label} ({m.unit})</option>)}</select></label>
      <label className={labelClass}>Value<input required className={inputClass} type="number" min="0" max="1000000000000000" step="any" value={value} onChange={e=>setValue(e.target.value)} /></label>
      {weekly && <label className={labelClass}>Period start<input required className={inputClass} type="date" value={start} onChange={e=>setStart(e.target.value)} /></label>}
      <label className={labelClass}>{weekly ? "Period end (seven days inclusive)" : "As-of date"}<input required className={inputClass} type="date" value={end} onChange={e=>setEnd(e.target.value)} /></label>
      <label className={labelClass}>Source note (optional)<input className={inputClass} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={simulated} disabled={demo} onChange={e=>setSimulated(e.target.checked)} />Simulated / demo data</label>
      <button className={buttonPrimary} type="submit">{busy ? "Saving…" : "Save private metric"}</button>
    </fieldset>
    {message && <p role={error ? "alert" : "status"} className={error ? "text-sm text-red-600" : "text-sm"}>{message}</p>}
  </form>;
}
