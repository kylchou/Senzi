"use client";

import { useState } from "react";
import { VcApiError, fieldErrors, vcFetch } from "@/lib/vc/client";
import type { OpeningLinePreview } from "@/lib/vc/services/opening-line";
import type { FirmObservation, MetricLink, OpeningLineMetric } from "@/lib/vc/types";
import { buttonPrimary, buttonSecondary, errorClass, hintClass, inputClass, labelClass } from "./styles";

/** What the form saves: the confirmed measurable form of the question, or none. */
export interface OpeningLineValue {
  link: MetricLink | null;
  observations: FirmObservation[];
}

/** The wording the model priced, adopted by the form when the firm confirms a link. */
export interface PricedWording {
  question: string;
  yesCriteria: string;
  noCriteria: string;
}

interface Props {
  startupId: string | null;
  question: string;
  /** datetime-local value from the form. */
  deadline: string;
  value: OpeningLineValue;
  /** Label of the saved link's metric, when editing an existing study. */
  savedMetricLabel?: string | null;
  onChange: (value: OpeningLineValue, wording: PricedWording | null) => void;
  error?: string;
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function Callout({ tone, title, children }: { tone: "ok" | "warn"; title: string; children?: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
      : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100";
  return (
    <div role="status" className={`rounded-md border p-3 text-sm ${cls}`}>
      <p className="font-semibold">{title}</p>
      {children}
    </div>
  );
}

/**
 * The model sets the opening line; nobody types odds. The firm types an
 * open-ended question, the AI proposes how to measure it with the startup's
 * data, the firm confirms, and the model prices it, or says there isn't
 * enough data, in which case forecasting can't open.
 */
export function OpeningLinePanel({ startupId, question, deadline, value, savedMetricLabel, onChange, error }: Props) {
  const [preview, setPreview] = useState<OpeningLinePreview | null>(null);
  const [draft, setDraft] = useState<MetricLink | null>(value.link);
  const [observations, setObservations] = useState<FirmObservation[]>(value.observations);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  /** What the shown estimate was computed from; edits after that make it stale. */
  const [ranWith, setRanWith] = useState<string | null>(null);

  const ready = !!startupId && question.trim().length >= 5 && !!deadline;
  const metrics: OpeningLineMetric[] = preview?.metrics ?? [];
  const metric = metrics.find((m) => m.id === draft?.metricId) ?? null;
  const estimate = preview?.estimate ?? null;
  const current = JSON.stringify([draft, observations.filter((o) => o.metricId === draft?.metricId)]);
  const stale = !!preview && ranWith !== current;
  const confirmed =
    !!value.link &&
    !!draft &&
    value.link.metricId === draft.metricId &&
    value.link.threshold === draft.threshold &&
    value.link.targetDate === draft.targetDate &&
    JSON.stringify(value.observations) === JSON.stringify(observations);

  async function run(link: MetricLink | null) {
    if (!ready) return;
    setLoading(true);
    setRequestError(null);
    setFieldError({});
    try {
      const result = await vcFetch<OpeningLinePreview>("/api/vc/opening-line", {
        method: "POST",
        json: {
          startupId,
          question,
          deadline: new Date(deadline).toISOString(),
          link,
          observations: link ? observations.filter((o) => o.metricId === link.metricId) : [],
        },
      });
      setPreview(result);
      const ranLink = result.estimate.link ?? link;
      setDraft(ranLink);
      setRanWith(JSON.stringify([ranLink, link ? observations.filter((o) => o.metricId === link.metricId) : []]));
    } catch (err) {
      setFieldError(fieldErrors(err));
      setRequestError(err instanceof VcApiError ? err.message : "Couldn't reach the model. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function confirm() {
    if (!draft || !estimate?.question || stale) return;
    const kept = observations.filter((o) => o.metricId === draft.metricId);
    onChange(
      { link: draft, observations: kept },
      { question: estimate.question, yesCriteria: estimate.yesCriteria!, noCriteria: estimate.noCriteria! },
    );
  }

  function unlink() {
    setDraft(null);
    setPreview(null);
    onChange({ link: null, observations: [] }, null);
  }

  function setObservation(i: number, patch: Partial<FirmObservation>) {
    setObservations((all) => all.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  }

  function addObservation() {
    if (!draft) return;
    const today = new Date().toISOString().slice(0, 10);
    setObservations((all) => [...all, { metricId: draft.metricId, value: 0, periodStart: today, periodEnd: today, note: "" }]);
  }

  return (
    <div className="space-y-3">
      <p className={hintClass}>
        The opening line is set by our model from the startup&apos;s data, not typed in. Describe your question above, then let the model
        estimate it. If no data measures the question, you can still save and submit it, but forecasting can&apos;t open until the model
        has enough data.
      </p>

      {value.link && !preview && (
        <Callout tone="ok" title="Linked to the model">
          <p className="mt-1">
            Measured with {savedMetricLabel ?? value.link.metricId}: at least {value.link.threshold.toLocaleString("en-US")} by{" "}
            {value.link.targetDate}. The model re-estimates when you save and again when forecasting opens.
          </p>
        </Callout>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonPrimary} disabled={!ready || loading} onClick={() => run(draft && preview ? draft : value.link)}>
          {loading ? "Estimating…" : preview ? "Re-estimate" : "Estimate opening line"}
        </button>
        {!ready && <span className="self-center text-xs text-slate-500">Choose a startup, type the question and set the deadline first.</span>}
        {(value.link || draft) && (
          <button type="button" className={buttonSecondary} onClick={unlink} disabled={loading}>
            Remove link
          </button>
        )}
      </div>

      {requestError && <p className={errorClass}>{requestError}</p>}
      {error && <p className={errorClass}>{error}</p>}

      {preview && (
        <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          {preview.suggestion && (
            <p className="text-sm">
              <span className="font-medium">Suggested measurement:</span> {preview.suggestion.reason}
            </p>
          )}

          {estimate?.status === "NOT_MEASURABLE" && (
            <Callout tone="warn" title="Not enough data">
              <p className="mt-1">{preview.suggestionNote ?? "None of the model's metrics for this startup measures this question."}</p>
              <p className="mt-1">You can save it as is, but forecasting can&apos;t open without a model opening line.</p>
            </Callout>
          )}

          {(draft || estimate?.status === "NOT_MEASURABLE") && metrics.length > 0 && (
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-3">
                {draft ? "Measured as" : "Measure it with a metric instead"}
              </legend>
              <div>
                <label htmlFor="ol-metric" className={labelClass}>
                  Metric
                </label>
                <select
                  id="ol-metric"
                  className={`${inputClass} mt-1`}
                  value={draft?.metricId ?? ""}
                  onChange={(e) =>
                    setDraft((d) =>
                      e.target.value
                        ? { metricId: e.target.value, threshold: d?.threshold ?? 0, targetDate: d?.targetDate ?? "" }
                        : null,
                    )
                  }
                >
                  <option value="">Choose…</option>
                  {metrics.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.hasPublicData ? "" : " (your figures)"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ol-threshold" className={labelClass}>
                  At least ({metric?.unit ?? "value"})
                </label>
                <input
                  id="ol-threshold"
                  type="number"
                  min={0}
                  step="any"
                  className={`${inputClass} mt-1`}
                  value={draft?.threshold || ""}
                  disabled={!draft}
                  onChange={(e) => setDraft((d) => d && { ...d, threshold: Number(e.target.value) })}
                  aria-invalid={!!fieldError["link.threshold"]}
                />
                {fieldError["link.threshold"] && <p className={errorClass}>{fieldError["link.threshold"]}</p>}
              </div>
              <div>
                <label htmlFor="ol-target" className={labelClass}>
                  {metric?.kind === "weekly_total" ? "Week ending" : "As of"}
                </label>
                <input
                  id="ol-target"
                  type="date"
                  className={`${inputClass} mt-1`}
                  value={draft?.targetDate ?? ""}
                  disabled={!draft}
                  onChange={(e) => setDraft((d) => d && { ...d, targetDate: e.target.value })}
                  aria-invalid={!!fieldError["link.targetDate"]}
                />
                {fieldError["link.targetDate"] && <p className={errorClass}>{fieldError["link.targetDate"]}</p>}
              </div>
            </fieldset>
          )}

          {draft && metric && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your firm&apos;s figures (optional, private)</p>
              <p className={hintClass}>
                {metric.hasPublicData
                  ? "Public data already feeds this metric. Add weeks it doesn't cover, if you have them."
                  : "This metric has no public data. Add at least three dated figures spanning four weeks."}{" "}
                Only your firm sees these; they never resolve the question.
              </p>
              {observations
                .map((o, i) => ({ o, i }))
                .filter(({ o }) => o.metricId === draft.metricId)
                .map(({ o, i }) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[10rem_10rem_1fr_auto]">
                    <input
                      aria-label={`Figure ${i + 1} date`}
                      type="date"
                      className={inputClass}
                      value={o.periodEnd}
                      onChange={(e) =>
                        setObservation(i, {
                          periodEnd: e.target.value,
                          periodStart: metric.kind === "weekly_total" && e.target.value ? addDays(e.target.value, -6) : e.target.value,
                        })
                      }
                    />
                    <input
                      aria-label={`Figure ${i + 1} value`}
                      type="number"
                      min={0}
                      step="any"
                      className={inputClass}
                      value={o.value || ""}
                      onChange={(e) => setObservation(i, { value: Number(e.target.value) })}
                    />
                    <input
                      aria-label={`Figure ${i + 1} note`}
                      placeholder="Source note (optional)"
                      className={inputClass}
                      value={o.note}
                      onChange={(e) => setObservation(i, { note: e.target.value })}
                    />
                    <button type="button" className={buttonSecondary} onClick={() => setObservations((all) => all.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </div>
                ))}
              <button type="button" className={buttonSecondary} onClick={addObservation}>
                Add a figure
              </button>
            </div>
          )}

          {estimate?.status === "OK" && draft && (
            <Callout tone="ok" title={`Model opening line: ${pct(estimate.probability)}`}>
              <p className="mt-1">
                Model uncertainty {pct(estimate.low)}–{pct(estimate.high)} · {estimate.confidence} confidence
              </p>
              <p className="mt-1 text-xs">{estimate.methodology}</p>
              {estimate.question && (
                <p className="mt-2">
                  <span className="font-medium">Worded as priced:</span> {estimate.question}
                </p>
              )}
            </Callout>
          )}

          {estimate?.status === "INSUFFICIENT_DATA" && draft && (
            <Callout tone="warn" title="Not enough data">
              <ul className="mt-1 list-disc pl-5">
                {estimate.notes.slice(-2).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <p className="mt-1">You can link it anyway; forecasting opens once the model has enough data.</p>
            </Callout>
          )}

          {draft && estimate?.question && estimate.status !== "NOT_MEASURABLE" && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={buttonPrimary} onClick={confirm} disabled={confirmed || loading || stale}>
                {confirmed ? "Using this measurement" : "Use this measurement"}
              </button>
              <span className="text-xs text-slate-500">
                {stale
                  ? "You changed the measurement. Re-estimate to see its opening line."
                  : "Your question and criteria are reworded to exactly what the model priced."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
