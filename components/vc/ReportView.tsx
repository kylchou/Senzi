import { formatPointChange, formatShare } from "@/lib/vc/estimates";
import { formatDate, formatDateTime, STATUS_LABELS, VISIBILITY_LABELS } from "@/lib/vc/format";
import { describeCalibration } from "@/lib/vc/reports";
import type { StudyReport } from "@/lib/vc/types";
import { TrendChart } from "./TrendChart";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-slate-200 pt-4 dark:border-slate-800">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
      <div className="text-sm text-slate-800 dark:text-slate-200">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[12rem_1fr] gap-2 py-0.5 max-sm:grid-cols-1">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Printable rendering of a study report. Each measurement is labeled with what it is. */
export function ReportView({ report }: { report: StudyReport }) {
  const r = report;
  return (
    <article className="space-y-5">
      <header>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {r.organization.name} · Generated {formatDateTime(r.generatedAt)} · {STATUS_LABELS[r.study.status]} ·{" "}
          {VISIBILITY_LABELS[r.study.visibility].label}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{r.study.question}</h1>
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {r.disclaimer}
        </p>
      </header>

      <Block title="Research question">
        <dl>
          <Row label="Startup">{r.study.startup?.name ?? "—"}</Row>
          <Row label="Forecast deadline">{formatDate(r.study.deadline)}</Row>
          <Row label="Resolves YES if">{r.study.yesCriteria}</Row>
          <Row label="Resolves NO if">{r.study.noCriteria}</Row>
          {r.study.context && <Row label="Context">{r.study.context}</Row>}
        </dl>
      </Block>

      <Block title="Measurements">
        <dl>
          <Row label="Opening baseline (reference)">
            {formatShare(r.baseline.value)}
            {r.baseline.methodology && <p className="text-xs text-slate-500">Method: {r.baseline.methodology}</p>}
          </Row>
          <Row label="Community YES allocation share">
            {r.communityEstimate ? (
              <>
                {formatShare(r.communityEstimate.yesAllocationShare, 1)}
                <p className="text-xs text-slate-500">
                  {r.communityEstimate.yesCredits.toLocaleString()} YES / {r.communityEstimate.noCredits.toLocaleString()} NO virtual
                  credits · as of {formatDateTime(r.communityEstimate.asOf)} · not a calibrated probability
                </p>
              </>
            ) : (
              "No forecasts yet"
            )}
          </Row>
          <Row label="Calibrated probability">
            {r.calibratedProbability
              ? `${formatShare(r.calibratedProbability.value, 1)}${describeCalibration(r.calibratedProbability)}`
              : "Not available — insufficient resolved history"}
          </Row>
          <Row label="Participation">
            {r.participation ? `${r.participation.participantCount} participants · ${r.participation.forecastCount} forecasts` : "—"}
          </Row>
        </dl>
      </Block>

      <Block title="Historical trend">
        <dl className="mb-3">
          <Row label="Change since open">{formatPointChange(r.trend.changeSinceOpen)}</Row>
          <Row label="Change, last 7 days">{formatPointChange(r.trend.change7d)}</Row>
          <Row label="Range">{r.trend.range ? `${formatShare(r.trend.range.min)} – ${formatShare(r.trend.range.max)}` : "—"}</Row>
        </dl>
        <TrendChart points={r.trend.points} baseline={r.baseline.value} />
      </Block>

      {r.resolution && (
        <Block title="Resolution (verified outcome)">
          <dl>
            <Row label="Outcome">{r.resolution.outcome}</Row>
            <Row label="Resolved">{formatDate(r.resolution.resolvedAt)}</Row>
            {r.resolution.evidenceSummary && <Row label="Evidence">{r.resolution.evidenceSummary}</Row>}
            {r.resolution.evidenceUrls.map((url) => (
              <Row key={url} label="Evidence link">
                <a href={url} rel="noopener noreferrer nofollow" target="_blank" className="break-all underline">
                  {url}
                </a>
              </Row>
            ))}
          </dl>
        </Block>
      )}

      <Block title="Sources">
        {r.sources.length === 0 ? (
          <p className="text-slate-500">No sources recorded.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            {r.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} rel="noopener noreferrer nofollow" target="_blank" className="underline">
                  {s.title}
                </a>
                {s.publisher && ` — ${s.publisher}`}
                {s.publishedAt && `, ${formatDate(s.publishedAt)}`}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Uncertainty">
        <ul className="list-disc space-y-1 pl-5">
          {(r.uncertainty.length ? r.uncertainty : ["No specific uncertainty flags."]).map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      </Block>

      <Block title="Limitations">
        <ul className="list-disc space-y-1 pl-5">
          {r.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Block>

      <Block title="Timeline">
        <ol className="space-y-1">
          {r.timeline.map((t, i) => (
            <li key={i}>
              <span className="text-slate-500">{formatDateTime(t.at)}</span> — {t.action} → {STATUS_LABELS[t.toStatus]}
              {t.reason && <span className="text-slate-500"> ({t.reason})</span>}
            </li>
          ))}
        </ol>
      </Block>
    </article>
  );
}
