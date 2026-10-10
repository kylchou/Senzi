"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { MAX_PRIZE_POOL_CREDITS, MAX_SOURCES } from "@/lib/vc/constants";
import { VcApiError, fieldErrors, vcFetch } from "@/lib/vc/client";
import type { OpeningLinePreview } from "@/lib/vc/services/opening-line";
import type { MetricLink, OpeningLineMetric } from "@/lib/vc/types";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { buttonPrimary, buttonSecondary, errorClass, hintClass, inputClass, labelClass } from "./styles";

/** A startup the model can price questions about, with the outcomes it supports. */
export interface QuestionCatalogEntry {
  startup: { id: string; name: string; slug: string };
  metrics: OpeningLineMetric[];
}

export interface StudyFormInitial {
  id: string;
  version: number;
  startup: { id: string; name: string } | null;
  question: string;
  yesCriteria: string;
  noCriteria: string;
  context: string | null;
  /** The saved link to the model and the metric's label. */
  openingLine: { link: MetricLink | null; metricLabel: string | null };
  deadline: Date | string;
  openToPublic: boolean;
  openToVerified: boolean;
  prizePoolCredits: number;
  sources: { url: string; title: string; publisher: string | null; publishedAt: Date | string | null }[];
}

interface SourceDraft {
  url: string;
  title: string;
  publisher: string;
  publishedAt: string;
}

type Mode = "outcome" | "words";
type Priced = { link: MetricLink; question: string; yesCriteria: string; noCriteria: string };

/** `YYYY-MM-DDTHH:mm` in the browser's local time for datetime-local inputs. */
function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  const off = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - off).toISOString().slice(0, 16);
}

/** Criteria text with a bold YES/NO lead, without repeating it when the template already starts with it. */
function labelled(side: "YES" | "NO", text: string) {
  const rest = text.startsWith(`${side} `) ? text.slice(side.length + 1) : text;
  return (
    <>
      <span className="font-medium">{side}</span> {rest}
    </>
  );
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const sameLink = (a: MetricLink | null, b: MetricLink | null) =>
  !!a && !!b && a.metricId === b.metricId && a.threshold === b.threshold && a.targetDate === b.targetDate;

function Step({ n, title, children, hint }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="flex items-baseline gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
          {n}
        </span>
        {title}
      </legend>
      {hint && <p className={hintClass}>{hint}</p>}
      {children}
    </fieldset>
  );
}

/**
 * Asking a question: pick the company and a binary outcome from dropdowns (the
 * wording comes from a template, so it's always well formed), or describe it
 * in words and let the AI match it to an outcome. The model sets the opening
 * price; the firm chooses who may trade and the prize pool.
 */
export function StudyForm({ initial, catalog }: { initial?: StudyFormInitial; catalog: QuestionCatalogEntry[] }) {
  const router = useRouter();
  const initialLink = initial?.openingLine.link ?? null;

  const [startupId, setStartupId] = useState(initial?.startup?.id ?? "");
  const [deadline, setDeadline] = useState(toLocalInput(initial?.deadline));
  const [mode, setMode] = useState<Mode>(initial && !initialLink ? "words" : "outcome");
  const [draft, setDraft] = useState<MetricLink>(initialLink ?? { metricId: "", threshold: 0, targetDate: "" });
  const [priced, setPriced] = useState<Priced | null>(
    initial && initialLink ? { link: initialLink, question: initial.question, yesCriteria: initial.yesCriteria, noCriteria: initial.noCriteria } : null,
  );
  const [estimate, setEstimate] = useState<OpeningLinePreview["estimate"] | null>(null);
  const [suggestionNote, setSuggestionNote] = useState<string | null>(null);
  const [firmFigureCount, setFirmFigureCount] = useState(0);
  const [question, setQuestion] = useState(initial && !initialLink ? initial.question : "");
  const [yesCriteria, setYes] = useState(initial && !initialLink ? initial.yesCriteria : "");
  const [noCriteria, setNo] = useState(initial && !initialLink ? initial.noCriteria : "");
  const [openToPublic, setOpenToPublic] = useState(initial?.openToPublic ?? true);
  const [openToVerified, setOpenToVerified] = useState(initial?.openToVerified ?? false);
  const [prizePool, setPrizePool] = useState(initial ? String(initial.prizePoolCredits || "") : "");
  const [context, setContext] = useState(initial?.context ?? "");
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
  const [pricing, setPricing] = useState(false);
  const [saving, setSaving] = useState(false);

  const entry = catalog.find((c) => c.startup.id === startupId) ?? null;
  const startupName = entry?.startup.name ?? (initial?.startup?.id === startupId ? initial.startup.name : "this company");
  const metrics = entry?.metrics ?? [];
  const metric = metrics.find((m) => m.id === draft.metricId) ?? null;
  const effectiveLink = { ...draft, threshold: metric && !metric.thresholdLabel ? 1 : draft.threshold };
  const fresh = !!priced && sameLink(priced.link, effectiveLink);

  const startupOptions = useMemo(() => {
    const options = catalog.map((c) => c.startup);
    if (initial?.startup && !options.some((s) => s.id === initial.startup!.id)) {
      options.unshift({ id: initial.startup.id, name: `${initial.startup.name} (no model data)`, slug: "" });
    }
    return options;
  }, [catalog, initial]);

  async function preview(link: MetricLink | null, text: string) {
    setPricing(true);
    setErrors({});
    setFormError(null);
    setSuggestionNote(null);
    try {
      const result = await vcFetch<OpeningLinePreview>("/api/vc/opening-line", {
        method: "POST",
        json: { startupId, question: text, deadline: deadline ? new Date(deadline).toISOString() : "", link },
      });
      setEstimate(result.estimate);
      setSuggestionNote(result.suggestionNote);
      setFirmFigureCount(result.firmFigureCount);
      return result;
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(err instanceof VcApiError ? err.message : "Couldn't reach the model. Try again.");
      return null;
    } finally {
      setPricing(false);
    }
  }

  async function priceOutcome() {
    if (!metric) return;
    const result = await preview(effectiveLink, `Will ${startupName} meet this outcome?`);
    const e = result?.estimate;
    if (e?.link && e.question && e.yesCriteria && e.noCriteria) {
      setPriced({ link: e.link, question: e.question, yesCriteria: e.yesCriteria, noCriteria: e.noCriteria });
    }
  }

  async function matchWords() {
    const result = await preview(null, question);
    const link = result?.estimate.link;
    if (link && result?.suggestion) {
      // The AI found a measurable form: show it as an outcome the firm can check and save.
      setDraft(link);
      setMode("outcome");
      const e = result.estimate;
      if (e.question && e.yesCriteria && e.noCriteria) setPriced({ link, question: e.question, yesCriteria: e.yesCriteria, noCriteria: e.noCriteria });
      setSuggestionNote(result.suggestion.reason);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    if (!startupId) return setErrors({ startupId: "Choose a company" });
    if (!openToPublic && !openToVerified) return setErrors({ openToPublic: "Choose who can trade" });
    if (mode === "outcome" && !fresh) return setFormError("Price the question first, so you can see the opening line it will start at.");

    const wording = mode === "outcome" && priced ? priced : { question, yesCriteria, noCriteria };
    const payload = {
      startupId,
      question: wording.question,
      yesCriteria: wording.yesCriteria,
      noCriteria: wording.noCriteria,
      context: context.trim() || null,
      modelLink: mode === "outcome" && priced ? priced.link : null,
      deadline: deadline ? new Date(deadline).toISOString() : "",
      openToPublic,
      openToVerified,
      prizePoolCredits: prizePool.trim() === "" ? 0 : Number(prizePool),
      sources: sources
        .filter((s) => s.url.trim() || s.title.trim())
        .map((s) => ({ url: s.url.trim(), title: s.title.trim(), publisher: s.publisher.trim() || null, publishedAt: s.publishedAt || null })),
    };

    setSaving(true);
    try {
      if (initial) {
        await vcFetch(`/api/studies/${initial.id}`, { method: "PATCH", json: { ...payload, expectedVersion: initial.version } });
        router.push(`/vc/studies/${initial.id}`);
      } else {
        const created = await vcFetch<{ id: string }>("/api/studies", { method: "POST", json: payload });
        router.push(`/vc/studies/${created.id}`);
      }
      router.refresh();
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(err instanceof VcApiError ? err.message : "Could not save the question");
      setSaving(false);
    }
  }

  const err = (key: string) => (errors[key] ? <p className={errorClass}>{errors[key]}</p> : null);
  const ready = !!startupId && !!deadline;
  const showLine = estimate?.status === "OK";

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      {formError && (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {formError}
        </div>
      )}

      <Step n={1} title="Company" hint="Only companies we collect public data for are listed, so the model can always set an opening price.">
        <div>
          <label htmlFor="startup" className="sr-only">
            Company
          </label>
          <select
            id="startup"
            className={`${inputClass} max-w-sm`}
            value={startupId}
            onChange={(e) => {
              setStartupId(e.target.value);
              setDraft({ metricId: "", threshold: 0, targetDate: draft.targetDate });
              setPriced(null);
              setEstimate(null);
            }}
            aria-invalid={!!errors.startupId}
          >
            <option value="">Choose a company…</option>
            {startupOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {err("startupId")}
        </div>
      </Step>

      <Step n={2} title="Forecast deadline" hint="Trading closes at this time (your local time zone). The question's date must come after it.">
        <div>
          <label htmlFor="deadline" className="sr-only">
            Forecast deadline
          </label>
          <input
            id="deadline"
            type="datetime-local"
            className={`${inputClass} max-w-xs`}
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              setPriced(null);
            }}
            aria-invalid={!!errors.deadline}
          />
          {err("deadline")}
        </div>
      </Step>

      <Step n={3} title="The question">
        <div role="tablist" aria-label="How to ask" className="inline-flex rounded-md border border-slate-300 p-0.5 text-sm dark:border-slate-700">
          {(
            [
              ["outcome", "Pick an outcome"],
              ["words", "Describe it in words"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={`rounded px-3 py-1.5 ${mode === key ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 dark:text-slate-300"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "outcome" ? (
          <div className="space-y-3">
            {!startupId ? (
              <p className={hintClass}>Choose a company first.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <label htmlFor="outcome" className={labelClass}>
                    Outcome
                  </label>
                  <select
                    id="outcome"
                    className={`${inputClass} mt-1`}
                    value={draft.metricId}
                    onChange={(e) => setDraft({ ...draft, metricId: e.target.value })}
                  >
                    <option value="">Choose what to ask about…</option>
                    {metrics.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                {metric?.thresholdLabel && (
                  <div className="sm:col-span-2">
                    <label htmlFor="threshold" className={labelClass}>
                      {metric.thresholdLabel}
                    </label>
                    <input
                      id="threshold"
                      type="number"
                      min={0}
                      step="any"
                      className={`${inputClass} mt-1`}
                      value={draft.threshold || ""}
                      onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })}
                      aria-invalid={!!errors["link.threshold"]}
                    />
                    {err("link.threshold")}
                  </div>
                )}
                {metric && (
                  <div>
                    <label htmlFor="target" className={labelClass}>
                      {metric.dateLabel}
                    </label>
                    <input
                      id="target"
                      type="date"
                      className={`${inputClass} mt-1`}
                      value={draft.targetDate}
                      onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })}
                      aria-invalid={!!errors["link.targetDate"]}
                    />
                    {err("link.targetDate")}
                  </div>
                )}
              </div>
            )}

            {metric && (
              <button
                type="button"
                className={buttonPrimary}
                onClick={priceOutcome}
                disabled={!ready || pricing || !draft.targetDate || (!!metric.thresholdLabel && !(draft.threshold > 0))}
              >
                {pricing ? "Pricing…" : fresh ? "Price again" : "Price this question"}
              </button>
            )}

            {suggestionNote && fresh && <p className={hintClass}>Matched from your words: {suggestionNote}</p>}

            {priced && fresh && (
              <div className="space-y-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
                <p className="font-medium">{priced.question}</p>
                <p>{labelled("YES", priced.yesCriteria)}</p>
                <p>{labelled("NO", priced.noCriteria)}</p>
                {showLine && estimate && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      Opening line: {pct(estimate.probability)}
                      <span className="inline-flex gap-1">
                        {metric?.hasPublicData && <ProvenanceBadge provenance="scraped" />}
                        {firmFigureCount > 0 && <ProvenanceBadge provenance="sponsor_provided" />}
                      </span>
                    </p>
                    <p className="text-xs">
                      Model uncertainty {pct(estimate.low)}–{pct(estimate.high)} · {estimate.confidence} confidence. The model prices it again when
                      forecasting opens.
                    </p>
                  </div>
                )}
                {estimate && !showLine && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                    <p className="font-semibold">Not enough data yet</p>
                    <p className="text-xs">{estimate.notes.at(-1)} You can save it; forecasting opens once the model can price it.</p>
                  </div>
                )}
              </div>
            )}
            {priced && !fresh && metric && <p className={hintClass}>You changed the outcome. Price it again to see the new opening line.</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="question" className={labelClass}>
                YES/NO question
              </label>
              <input
                id="question"
                className={`${inputClass} mt-1`}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Will Stripe's npm downloads pass 4M a week by January?"
                maxLength={300}
                aria-invalid={!!errors.question}
              />
              {err("question")}
            </div>
            <button type="button" className={buttonSecondary} onClick={matchWords} disabled={!ready || pricing || question.trim().length < 5}>
              {pricing ? "Checking…" : "Check with AI"}
            </button>
            <p className={hintClass}>
              The AI checks whether one of {startupName}&apos;s outcomes measures your question and, if so, turns it into a well-formed one the model
              can price.
            </p>
            {suggestionNote && estimate?.status === "NOT_MEASURABLE" && (
              <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-semibold">Not enough data</p>
                <p>{suggestionNote} You can still save it with your own criteria below, but forecasting can&apos;t open until it can be measured.</p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="yes" className={labelClass}>
                  Resolves YES if…
                </label>
                <textarea id="yes" rows={3} className={`${inputClass} mt-1`} value={yesCriteria} onChange={(e) => setYes(e.target.value)} aria-invalid={!!errors.yesCriteria} />
                {err("yesCriteria")}
              </div>
              <div>
                <label htmlFor="no" className={labelClass}>
                  Resolves NO if…
                </label>
                <textarea id="no" rows={3} className={`${inputClass} mt-1`} value={noCriteria} onChange={(e) => setNo(e.target.value)} aria-invalid={!!errors.noCriteria} />
                {err("noCriteria")}
              </div>
            </div>
          </div>
        )}
      </Step>

      <Step n={4} title="Who can trade" hint="Choose one or both.">
        <div className="space-y-2">
          <label className="flex cursor-pointer gap-3 rounded-md border border-slate-200 p-3 has-[:checked]:border-slate-500 dark:border-slate-800">
            <input type="checkbox" className="mt-0.5" checked={openToPublic} onChange={(e) => setOpenToPublic(e.target.checked)} />
            <span>
              <span className="block text-sm font-medium">Public</span>
              <span className="block text-xs text-slate-500">Any retail trader can place a prediction.</span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3 rounded-md border border-slate-200 p-3 has-[:checked]:border-slate-500 dark:border-slate-800">
            <input type="checkbox" className="mt-0.5" checked={openToVerified} onChange={(e) => setOpenToVerified(e.target.checked)} />
            <span>
              <span className="block text-sm font-medium">Verified users of {startupName}</span>
              <span className="block text-xs text-slate-500">
                Only traders who have verified they use the product can place a prediction and see the line.
              </span>
            </span>
          </label>
          {err("openToPublic")}
        </div>
      </Step>

      <Step n={5} title="Prize pool" hint="Credits split among the traders who gain credits on this market, in proportion to what they gained, once it settles.">
        <div className="max-w-xs">
          <label htmlFor="prize" className="sr-only">
            Prize pool (credits)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="prize"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_PRIZE_POOL_CREDITS}
              step={1}
              placeholder="0"
              className={inputClass}
              value={prizePool}
              onChange={(e) => setPrizePool(e.target.value)}
              aria-invalid={!!errors.prizePoolCredits}
            />
            <span className="text-sm text-slate-500">credits</span>
          </div>
          {err("prizePoolCredits")}
        </div>
      </Step>

      <Step n={6} title="Context and sources" hint="Optional. Public information only; never material nonpublic information.">
        <div>
          <label htmlFor="context" className={labelClass}>
            Context
          </label>
          <textarea id="context" rows={3} className={`${inputClass} mt-1`} value={context} onChange={(e) => setContext(e.target.value)} />
          {err("context")}
        </div>
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
      </Step>

      <div className="flex gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <button type="submit" className={buttonPrimary} disabled={saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Save draft"}
        </button>
        <button type="button" className={buttonSecondary} onClick={() => router.back()} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
