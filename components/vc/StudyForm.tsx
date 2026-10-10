"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { vcFetch } from "@/lib/vc/client";
import type { StudyVisibility } from "@/lib/vc/types";
import type { IntakeMetric } from "@/lib/model/intake";
import type { BaselineResult } from "@/lib/model/types";
import { StartupPicker } from "./StartupPicker";
import { buttonPrimary, buttonSecondary, inputClass, labelClass } from "./styles";
export interface StudyFormInitial {
 id: string; version: number; startup: {id: string; name: string} | null;
 question: string; yesCriteria: string; noCriteria: string; context: string | null;
 baselineValue: number | null; baselineMethodology: string | null; deadline: Date | string;
 visibility: StudyVisibility;
 sources: {url: string; title: string; publisher: string | null; publishedAt: Date | string | null}[];
}
type Preview = { question: {text: string; resolutionSource: {url: string; description: string}}; result: BaselineResult; fields: {yesCriteria: string; noCriteria: string} };
export function StudyForm({ initial }: { initial?: StudyFormInitial }) {
 const router = useRouter();
 const [startup, setStartup] = useState(initial?.startup ?? null);
 const [catalog, setCatalog] = useState<{startup: {slug: string}; questionMetrics: IntakeMetric[]} | null>(null);
 const [metricId, setMetric] = useState("");
 const [threshold, setThreshold] = useState("");
 const [targetDate, setDate] = useState(initial ? new Date(initial.deadline).toISOString().slice(0,10) : "");
 const [context, setContext] = useState(initial?.context ?? "");
 const [visibility, setVisibility] = useState<StudyVisibility>(initial?.visibility ?? "ORGANIZATION");
 const [preview, setPreview] = useState<Preview | null>(null);
 const [error, setError] = useState("");
 const [busy, setBusy] = useState(false);
 useEffect(() => {
   if (!startup) return;
   const abort = new AbortController();
   vcFetch<{startup: {slug: string}; questionMetrics: IntakeMetric[]}>(`/api/vc/companies/${startup.id}/metrics`, {signal: abort.signal}).then(data => {
     setCatalog(data); setMetric(data.questionMetrics[0]?.id ?? "");
   }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
   return () => abort.abort();
 }, [startup]);
 function changed() { setPreview(null); setError(""); }
 const payload = {startupId: startup?.id, target: {metricId, threshold: Number(threshold), targetDate}, context, visibility, ...(initial ? {expectedVersion: initial.version} : {})};
 async function calculate() {
   setBusy(true); setError("");
   try { setPreview(await vcFetch<Preview>("/api/vc/questions/preview", {method:"POST", json:payload})); }
   catch(e) { setError(e instanceof Error ? e.message : "Calculation failed"); }
   finally { setBusy(false); }
 }
 async function save() {
   setBusy(true); setError("");
   try {
     const study = await vcFetch<{id:string}>(initial ? `/api/studies/${initial.id}` : "/api/studies", {method:initial ? "PATCH" : "POST", json:payload});
     router.push(`/vc/studies/${study.id}`); router.refresh();
   } catch(e) { setError(e instanceof Error ? e.message : "Save failed"); }
   finally { setBusy(false); }
 }
 return <form className="max-w-3xl space-y-5" onSubmit={e => {e.preventDefault(); void calculate();}}>
   <p className="text-sm text-slate-500">Choose a measurable question. The model sets its opening price; your firm?s matching metric history can inform it.</p>
   {initial && <p className="text-sm">Re-select the metric and threshold to reprice this draft. Current question: {initial.question}</p>}
   <fieldset disabled={busy} className="space-y-4">
     <StartupPicker value={startup} onChange={s => {setStartup(s); setCatalog(null); setMetric(""); changed();}} />
     {startup && catalog && <>
       <Link className="text-sm underline" href={`/vc/companies/${catalog.startup.slug}`}>View company indicators / enter private metrics</Link>
       {!catalog.questionMetrics.length && <p role="status">This company has no supported question metric yet. Company indicators are still available.</p>}
       <label className={labelClass}>Metric<select required className={inputClass} value={metricId} onChange={e=>{setMetric(e.target.value);changed();}}>{catalog.questionMetrics.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
     </>}
     <div className="grid gap-4 sm:grid-cols-2">
       <label className={labelClass}>Threshold<input className={inputClass} type="number" min="0.000001" step="any" required value={threshold} onChange={e=>{setThreshold(e.target.value);changed();}} /></label>
       <label className={labelClass}>Seven-day window ending (UTC)<input className={inputClass} type="date" required value={targetDate} onChange={e=>{setDate(e.target.value);changed();}} /></label>
     </div>
     <label className={labelClass}>Research context<textarea className={inputClass} maxLength={5000} value={context} onChange={e=>setContext(e.target.value)} /></label>
     <label className={labelClass}>Visibility<select className={inputClass} value={visibility} onChange={e=>setVisibility(e.target.value as StudyVisibility)}><option value="ORGANIZATION">Organization</option><option value="RESTRICTED">Invited participants</option><option value="PUBLIC">Public question</option></select></label>
     <button className={buttonSecondary} disabled={!metricId} type="submit">{busy ? "Working..." : "Calculate model baseline"}</button>
   </fieldset>
   {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
   {preview && <section aria-label="Model preview" className="space-y-3 rounded-lg border p-4">
     <h2 className="font-semibold">{preview.question.text}</h2>
     <p><strong>{preview.result.probability === null ? "Cannot price yet" : (preview.result.probability*100).toFixed(1)+"% model baseline"}</strong>{preview.result.low !== null && ` · ${(preview.result.low*100).toFixed(1)}–${(preview.result.high!*100).toFixed(1)}% model uncertainty`}</p>
     <p className="text-sm">{preview.result.method.description}</p><p className="text-xs">As of {preview.result.asOf}</p>
     <p className="text-sm">YES: {preview.fields.yesCriteria}</p><p className="text-sm">NO: {preview.fields.noCriteria}</p>
     <p className="text-sm">Resolution source (locked on submission): <a className="underline" href={preview.question.resolutionSource.url} target="_blank" rel="noreferrer">{preview.question.resolutionSource.description}</a></p>
     <ul className="text-xs space-y-1">{preview.result.inputsUsed.map((i,n)=><li key={n}>{i.metricId}: {i.points} points · {i.provenance === "sponsor_provided" ? "Sponsor-provided" : "Scraped"}{i.simulated && " · SIMULATED"} · {i.periodStart}–{i.periodEnd}</li>)}{[...preview.result.missing,...preview.result.notes].map((n,i)=><li key={"n"+i}>{n}</li>)}</ul>
     {preview.result.probability === null && <p className="text-sm">Save a draft, then add matching data before submission. There is no manual price override.</p>}
     <button type="button" className={buttonPrimary} disabled={busy} onClick={()=>void save()}>Save draft</button>
   </section>}
 </form>;
}
