"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BASELINE_EXPLAINER, MAX_SOURCES } from "@/lib/vc/constants";
import { VcApiError, fieldErrors, vcFetch } from "@/lib/vc/client";
import { VISIBILITY_LABELS } from "@/lib/vc/format";
import { STUDY_VISIBILITIES, type StudyVisibility } from "@/lib/vc/types";
import { StartupPicker } from "./StartupPicker";
import { buttonPrimary, buttonSecondary, errorClass, hintClass, inputClass, labelClass } from "./styles";

export interface StudyFormInitial {
  id: string;
  version: number;
  startup: { id: string; name: string } | null;
  question: string;
  yesCriteria: string;
  noCriteria: string;
  context: string | null;
  baselineValue: number | null;
  baselineMethodology: string | null;
  deadline: Date | string;
  visibility: StudyVisibility;
  sources: { url: string; title: string; publisher: string | null; publishedAt: Date | string | null }[];
}

interface SourceDraft {
  url: string;
  title: string;
  publisher: string;
  publishedAt: string;
}

/** `YYYY-MM-DDTHH:mm` in the browser's local time for datetime-local inputs. */
function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  const off = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - off).toISOString().slice(0, 16);
}

/** 0.355 → "35.5", without floating-point noise like "35.49999999". */
function toPercentText(fraction: number): string {
  return String(Number((fraction * 100).toPrecision(10)));
}

export function StudyForm({ initial }: { initial?: StudyFormInitial }) {
  const router = useRouter();
  const [startup, setStartup] = useState(initial?.startup ?? null);
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [yesCriteria, setYes] = useState(initial?.yesCriteria ?? "");
  const [noCriteria, setNo] = useState(initial?.noCriteria ?? "");
  const [context, setContext] = useState(initial?.context ?? "");
  const initialBaseline = initial?.baselineValue != null ? toPercentText(initial.baselineValue) : "";
  const [baseline, setBaseline] = useState(initialBaseline);
  const [methodology, setMethodology] = useState(initial?.baselineMethodology ?? "");
  const [deadline, setDeadline] = useState(toLocalInput(initial?.deadline));
  const [visibility, setVisibility] = useState<StudyVisibility>(initial?.visibility ?? "ORGANIZATION");
  const [sources, setSources] = useState<SourceDraft[]>(
    initial?.sources.map((s) => ({
      url: s.url,
      title: s.title,
      publisher: s.publisher ?? "",
      publishedAt: s.publishedAt ? new Date(s.publishedAt).toISOString().slice(0, 10) : "",
    })) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    if (!startup) {
      setErrors({ startupId: "Choose a startup" });
      return;
    }
    const baselineNum = baseline.trim() === "" ? null : Number(baseline) / 100;
    // When editing, leave the stored baseline untouched unless the field was changed.
    const baselineChanged = !initial || baseline.trim() !== initialBaseline;
    const payload = {
      startupId: startup.id,
      question,
      yesCriteria,
      noCriteria,
      context: context.trim() || null,
      ...(baselineChanged && { baselineValue: baselineNum }),
      baselineMethodology: methodology.trim() || null,
      deadline: deadline ? new Date(deadline).toISOString() : "",
      visibility,
      sources: sources
        .filter((s) => s.url.trim() || s.title.trim())
        .map((s) => ({
          url: s.url.trim(),
          title: s.title.trim(),
          publisher: s.publisher.trim() || null,
          publishedAt: s.publishedAt || null,
        })),
    };

    setSubmitting(true);
    try {
      if (initial) {
        await vcFetch(`/api/studies/${initial.id}`, {
          method: "PATCH",
          json: { ...payload, expectedVersion: initial.version },
        });
        router.push(`/vc/studies/${initial.id}`);
      } else {
        const created = await vcFetch<{ id: string }>("/api/studies", { method: "POST", json: payload });
        router.push(`/vc/studies/${created.id}`);
      }
      router.refresh();
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(err instanceof VcApiError ? err.message : "Could not save the study");
      setSubmitting(false);
    }
  }

  const err = (key: string) =>
    errors[key] ? (
      <p id={`err-${key}`} className={errorClass}>
        {errors[key]}
      </p>
    ) : null;
  const aria = (key: string) => ({
    "aria-invalid": !!errors[key],
    "aria-describedby": errors[key] ? `err-${key}` : undefined,
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {formError && (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {formError}
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">Research question</legend>
        <StartupPicker value={startup} onChange={setStartup} error={errors.startupId} />
        <div>
          <label htmlFor="question" className={labelClass}>
            YES/NO question
          </label>
          <input
            id="question"
            className={`${inputClass} mt-1`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Will Acme announce a Series B of at least $20M by June 30, 2027?"
            maxLength={300}
            required
            {...aria("question")}
          />
          <p className={hintClass}>Make it measurable from public information, with a clear date.</p>
          {err("question")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="yes" className={labelClass}>
              Resolves YES if…
            </label>
            <textarea id="yes" rows={3} className={`${inputClass} mt-1`} value={yesCriteria} onChange={(e) => setYes(e.target.value)} {...aria("yesCriteria")} />
            {err("yesCriteria")}
          </div>
          <div>
            <label htmlFor="no" className={labelClass}>
              Resolves NO if…
            </label>
            <textarea id="no" rows={3} className={`${inputClass} mt-1`} value={noCriteria} onChange={(e) => setNo(e.target.value)} {...aria("noCriteria")} />
            {err("noCriteria")}
          </div>
        </div>
        <div>
          <label htmlFor="context" className={labelClass}>
            Context <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea id="context" rows={4} className={`${inputClass} mt-1`} value={context} onChange={(e) => setContext(e.target.value)} {...aria("context")} />
          <p className={hintClass}>Publicly available background only. Do not include material nonpublic information.</p>
          {err("context")}
        </div>
        <div>
          <label htmlFor="deadline" className={labelClass}>
            Forecast deadline
          </label>
          <input
            id="deadline"
            type="datetime-local"
            className={`${inputClass} mt-1 max-w-xs`}
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            {...aria("deadline")}
          />
          <p className={hintClass}>Forecasting closes at this time (your local time zone).</p>
          {err("deadline")}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">Opening baseline</legend>
        <p className={hintClass}>{BASELINE_EXPLAINER} Required before submitting for review.</p>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <div>
            <label htmlFor="baseline" className={labelClass}>
              Baseline (%)
            </label>
            <input
              id="baseline"
              type="number"
              inputMode="decimal"
              step="any"
              min={1}
              max={99}
              className={`${inputClass} mt-1`}
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
              {...aria("baselineValue")}
            />
            {err("baselineValue")}
          </div>
          <div>
            <label htmlFor="method" className={labelClass}>
              Methodology
            </label>
            <textarea
              id="method"
              rows={3}
              className={`${inputClass} mt-1`}
              value={methodology}
              onChange={(e) => setMethodology(e.target.value)}
              placeholder="e.g. Base rate of Series B within 18 months of Series A for comparable SaaS companies (source: …)"
              {...aria("baselineMethodology")}
            />
            {err("baselineMethodology")}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">Visibility</legend>
        {STUDY_VISIBILITIES.map((v) => (
          <label key={v} className="flex cursor-pointer gap-3 rounded-md border border-slate-200 p-3 has-[:checked]:border-slate-500 dark:border-slate-800 dark:has-[:checked]:border-slate-400">
            <input type="radio" name="visibility" value={v} checked={visibility === v} onChange={() => setVisibility(v)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{VISIBILITY_LABELS[v].label}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{VISIBILITY_LABELS[v].description}</span>
            </span>
          </label>
        ))}
        {visibility === "RESTRICTED" && (
          <p className={hintClass}>Invite participants from the study page after saving.</p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">Sources</legend>
        <p className={hintClass}>Public links supporting the question and baseline.</p>
        {sources.map((s, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-2">
            <input aria-label={`Source ${i + 1} title`} placeholder="Title" className={inputClass} value={s.title} onChange={(e) => setSources((all) => all.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <input aria-label={`Source ${i + 1} URL`} placeholder="https://" type="url" className={inputClass} value={s.url} onChange={(e) => setSources((all) => all.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <input aria-label={`Source ${i + 1} publisher`} placeholder="Publisher (optional)" className={inputClass} value={s.publisher} onChange={(e) => setSources((all) => all.map((x, j) => (j === i ? { ...x, publisher: e.target.value } : x)))} />
            <div className="flex gap-2">
              <input aria-label={`Source ${i + 1} publication date`} type="date" className={inputClass} value={s.publishedAt} onChange={(e) => setSources((all) => all.map((x, j) => (j === i ? { ...x, publishedAt: e.target.value } : x)))} />
              <button type="button" className={buttonSecondary} onClick={() => setSources((all) => all.filter((_, j) => j !== i))} aria-label={`Remove source ${i + 1}`}>
                Remove
              </button>
            </div>
            {(errors[`sources.${i}.url`] || errors[`sources.${i}.title`]) && (
              <p className={`${errorClass} sm:col-span-2`}>{errors[`sources.${i}.url`] ?? errors[`sources.${i}.title`]}</p>
            )}
          </div>
        ))}
        {sources.length < MAX_SOURCES && (
          <button type="button" className={buttonSecondary} onClick={() => setSources((all) => [...all, { url: "", title: "", publisher: "", publishedAt: "" }])}>
            Add source
          </button>
        )}
      </fieldset>

      <div className="flex gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <button type="submit" className={buttonPrimary} disabled={submitting}>
          {submitting ? "Saving…" : initial ? "Save changes" : "Save draft"}
        </button>
        <button type="button" className={buttonSecondary} onClick={() => router.back()} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
