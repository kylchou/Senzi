import { formatShare } from "@/lib/vc/estimates";
import { formatDate, formatDateTime, formatIndicatorValue, formatRelativeChange } from "@/lib/vc/format";
import type { StudyModelEvidence } from "@/lib/vc/server/company-model";
import type { StartupNewsView } from "@/lib/vc/types";
import { NewsList } from "./EvidenceList";
import { ProvenanceBadge, SOURCE_NAMES } from "./ProvenanceBadge";

const h3 = "mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500";

function SourceLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600">
      {children}
    </a>
  );
}

type Model = NonNullable<StudyModelEvidence["model"]>;

/** The steps from data to probability, in plain terms. Steps the method didn't produce are skipped. */
function steps(m: Model): React.ReactNode[] {
  const c = m.calc;
  const unit = c.unit ?? "";
  const fmt = (v: number) => formatIndicatorValue(v, unit);
  const out: React.ReactNode[] = [];
  if (c.lastWeek) {
    out.push(
      <>
        <strong>Start from the data.</strong> The latest full week (ending {formatDate(c.lastWeek.windowEnd)}) {c.higherIsBetter ? "came in at" : "averaged"}{" "}
        <strong className="tabular-nums">{fmt(c.lastWeek.total)}</strong>.
      </>,
    );
  }
  if (c.weeklyGrowth != null) {
    out.push(
      <>
        <strong>Fit the trend.</strong> Over the last {c.weeksUsed} weeks it changed by{" "}
        <strong className="tabular-nums">{formatRelativeChange(c.weeklyGrowth)}</strong> a week
        {!c.higherIsBetter && ` (${c.weeklyGrowth < 0 ? "improving" : "slipping"}; a lower rank is better)`}
        {c.npmAdjusted && ", measured against npm-wide downloads so ecosystem-wide jumps don't count as growth"}.
      </>,
    );
  }
  if (c.forecastMedian != null) {
    out.push(
      <>
        <strong>Project to the question&apos;s week.</strong>{" "}
        {c.horizonWeeks != null && `${c.horizonWeeks} week${c.horizonWeeks === 1 ? "" : "s"} ahead, `}
        that points to {c.higherIsBetter ? "about" : "an average of about"} <strong className="tabular-nums">{fmt(c.forecastMedian)}</strong>
        {c.forecastRange80 && (
          <>
            {" "}
            (most likely between {fmt(c.forecastRange80[0])} and {fmt(c.forecastRange80[1])})
          </>
        )}
        .
      </>,
    );
  }
  if (c.threshold != null && m.probability != null) {
    out.push(
      <>
        <strong>Compare with the line.</strong> The question needs{" "}
        <strong className="tabular-nums">{c.higherIsBetter ? `at least ${fmt(c.threshold)}` : `${fmt(c.threshold)} or better`}</strong>. Given that
        projection, the chance of clearing it is{" "}
        {shrunk(c.rawProbability, m.probability) ? (
          <>
            {formatShare(c.rawProbability!)}. We pull estimates toward 50% to avoid overconfidence, which gives{" "}
            <strong className="tabular-nums">{formatShare(m.probability)}</strong>.
          </>
        ) : (
          <strong className="tabular-nums">{formatShare(m.probability)}</strong>
        )}
        {!shrunk(c.rawProbability, m.probability) && "."}
      </>,
    );
  }
  if (out.length === 0 && c.weeksUsed === 0 && m.probability != null) {
    out.push(<>Not enough history yet to fit a trend, so the model stays near 50% until more data arrives.</>);
  }
  return out;
}

/** True when the final value is the raw one moved toward 50% without crossing it, so "pulled toward 50%" is an honest description. */
function shrunk(raw: number | null, final: number) {
  return raw != null && Math.abs(final - 0.5) < Math.abs(raw - 0.5) && (raw - 0.5) * (final - 0.5) >= 0;
}

/**
 * How the model reached its number for this question, and exactly which data
 * it used. Public signals that don't feed the model live in CompanySignalsPanel.
 */
export function ModelCalculationPanel({ evidence }: { evidence: StudyModelEvidence }) {
  const m = evidence.model;
  if (!m) return <p className="text-sm text-slate-500">The model hasn&apos;t run for this question yet.</p>;
  const list = steps(m);
  const c = m.calc;
  const t = c.technical;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatShare(m.probability)}</span>
        {c.metricLabel && c.threshold != null && c.windowEnd && (
          <span className="text-sm text-slate-600 dark:text-slate-300">
            chance that {c.metricLabel} for the 7 days ending {formatDate(c.windowEnd)} is{" "}
            {c.higherIsBetter ? "at least" : "at or better than"} {formatIndicatorValue(c.threshold, c.unit ?? "")}
          </span>
        )}
      </div>

      {list.length > 0 && (
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700 marker:text-slate-400 dark:text-slate-300">
          {list.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}

      <div>
        <h3 className={h3}>Data the model used</h3>
        {m.inputs.length === 0 ? (
          <p className="text-sm text-slate-500">No inputs recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {m.inputs.map((i) => (
              <li key={`${i.metricId}:${i.role}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div>
                  <span className="font-medium">{i.label}</span>
                  <span className="block text-xs text-slate-500">
                    {i.role === "sponsor_fill" ? "Filled weeks the public data lacked" : `${i.points.toLocaleString("en-US")} data points`}
                    {i.periodStart && i.periodEnd && `, ${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}`}
                  </span>
                </div>
                <div className="text-right text-xs text-slate-600 dark:text-slate-300">
                  <ProvenanceBadge provenance={i.provenance} simulated={i.simulated} />
                  <span className="mt-0.5 block">
                    <SourceLink href={i.sourceRef?.url ?? null}>{SOURCE_NAMES[i.source] ?? i.source}</SourceLink>
                    {i.sourceRef?.fetchedAt && <span className="text-slate-500"> · fetched {formatDateTime(i.sourceRef.fetchedAt)}</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">Trades never feed the model. It changes only when new data arrives.</p>
      </div>

      <details className="text-xs text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer text-slate-500">Technical details</summary>
        <p className="mt-2 max-w-2xl">
          Fits a straight-line trend to the log of weekly totals (Theil–Sen, robust to spikes), projects it to the question&apos;s week, and converts the
          distance to the line into a probability.
          {t.bootstrapReplicates != null && ` The band comes from ${t.bootstrapReplicates.toLocaleString("en-US")} refits on resampled data.`}
        </p>
        <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {t.methodName && (
            <div>
              <dt className="inline text-slate-500">Method: </dt>
              <dd className="inline">{t.methodName}{t.methodVersion && ` v${t.methodVersion}`}</dd>
            </div>
          )}
          {m.low != null && m.high != null && (
            <div>
              <dt className="inline text-slate-500">Uncertainty band: </dt>
              <dd className="inline tabular-nums">{formatShare(m.low)}–{formatShare(m.high)}{m.confidence && `, ${m.confidence} confidence`}</dd>
            </div>
          )}
          {c.rawProbability != null && (
            <div>
              <dt className="inline text-slate-500">Before pull toward 50%: </dt>
              <dd className="inline tabular-nums">{formatShare(c.rawProbability)}</dd>
            </div>
          )}
          {c.weeksUsed > 0 && (
            <div>
              <dt className="inline text-slate-500">History fit: </dt>
              <dd className="inline tabular-nums">{c.weeksUsed} weeks, through {formatDate(m.dataThrough)}</dd>
            </div>
          )}
          <div>
            <dt className="inline text-slate-500">Computed: </dt>
            <dd className="inline">{formatDateTime(m.asOf)}</dd>
          </div>
          {t.inputsHash && (
            <div>
              <dt className="inline text-slate-500">Inputs fingerprint: </dt>
              <dd className="inline font-mono" title={t.inputsHash}>{t.inputsHash.slice(0, 12)}</dd>
            </div>
          )}
        </dl>
        {m.notes.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {m.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

/**
 * Everything else known about the company: public signals that aren't this
 * question's model input, the viewer's firm's sponsor-provided figures (kept
 * separate), and related articles.
 */
export function CompanySignalsPanel({ evidence, news }: { evidence: StudyModelEvidence; news: StartupNewsView[] }) {
  const { model, scraped, sponsor } = evidence;
  const used = new Set(model?.inputs.map((i) => i.metricId));
  const tracked = scraped.filter((i) => i.value !== null && !used.has(i.metricId));
  const missing = scraped.filter((i) => i.value === null);

  return (
    <div className="space-y-6">
      <div>
        <h3 className={h3}>Public signals</h3>
        {tracked.length === 0 ? (
          <p className="text-sm text-slate-500">No other public signals collected for this company yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {tracked.map((i) => (
              <li key={i.metricId} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                <span className="font-medium">{i.label}</span>
                <p className="mt-0.5 tabular-nums">
                  {formatIndicatorValue(i.value, i.unit)}
                  {i.change4w != null && <span className="ml-2 text-xs text-slate-500">{formatRelativeChange(i.change4w)} vs 4 weeks earlier</span>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  <SourceLink href={i.sourceUrl}>{SOURCE_NAMES[i.source] ?? i.source}</SourceLink> · as of {formatDate(i.asOf)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {missing.length > 0 && <p className="mt-2 text-xs text-slate-500">Not collected: {missing.map((i) => i.label).join(", ")}.</p>}
      </div>

      {sponsor.length > 0 && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900 dark:bg-violet-950/30">
          <h3 className={h3}>Sponsor-provided by your firm</h3>
          <p className="mb-2 text-xs text-slate-600 dark:text-slate-300">
            Entered by your firm, so you control it. Kept separate from scraped data; it never resolves a question.
          </p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {sponsor.map((i) => (
              <li key={i.metricId} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{i.label}</span>
                  <ProvenanceBadge provenance="sponsor_provided" simulated={i.simulated} />
                </div>
                <p className="tabular-nums">{formatIndicatorValue(i.value, i.unit)}</p>
                <p className="text-xs text-slate-500">As of {formatDate(i.asOf)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className={h3}>Related articles</h3>
        <NewsList news={news} emptyText="No articles recorded for this company yet." />
      </div>
    </div>
  );
}
