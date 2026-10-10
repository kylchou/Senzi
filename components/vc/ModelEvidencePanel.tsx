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

/**
 * Answers "why is the model at X%?": the inputs the latest model run used,
 * every public signal with its source and fetch time, the viewer's firm's
 * sponsor-provided figures (kept separate), and related articles.
 */
export function ModelEvidencePanel({ evidence, news }: { evidence: StudyModelEvidence; news: StartupNewsView[] }) {
  const { model, scraped, sponsor } = evidence;
  const used = new Set(model?.inputs.map((i) => i.metricId));
  const tracked = scraped.filter((i) => i.value !== null);
  const missing = scraped.filter((i) => i.value === null);

  return (
    <div className="space-y-6">
      <div>
        {model ? (
          <p className="text-sm text-slate-700 dark:text-slate-300">
            The model puts this at <strong className="tabular-nums">{formatShare(model.probability)}</strong>
            {model.low != null && model.high != null && (
              <>
                {" "}
                (uncertainty band {formatShare(model.low)}–{formatShare(model.high)}
                {model.confidence && `, ${model.confidence} confidence`})
              </>
            )}
            , using data through {formatDate(model.dataThrough)}. Computed {formatDateTime(model.asOf)} with {model.method}. Trades never feed it.
          </p>
        ) : (
          <p className="text-sm text-slate-500">The model hasn&apos;t run for this question yet, so there are no recorded inputs.</p>
        )}
        {model && model.notes.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600 dark:text-slate-300">
            {model.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      {model && (
        <div>
          <h3 className={h3}>Inputs this model used</h3>
          {model.inputs.length === 0 ? (
            <p className="text-sm text-slate-500">No inputs recorded{model.missing.length ? `. Missing: ${model.missing.join(", ")}` : "."}</p>
          ) : (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs text-slate-500">
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="px-4 py-1.5 font-medium sm:px-2">Data</th>
                    <th className="px-2 py-1.5 font-medium">Provenance</th>
                    <th className="px-2 py-1.5 font-medium">Used</th>
                    <th className="px-4 py-1.5 font-medium sm:px-2">Source · fetched</th>
                  </tr>
                </thead>
                <tbody>
                  {model.inputs.map((i) => (
                    <tr key={`${i.metricId}:${i.role}`} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-900">
                      <td className="px-4 py-2 font-medium sm:px-2">{i.label}</td>
                      <td className="px-2 py-2">
                        <ProvenanceBadge provenance={i.provenance} simulated={i.simulated} />
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-600 dark:text-slate-300">
                        {i.role === "sponsor_fill" ? "Filled weeks the public data lacked" : "Fit the trend"} · {i.points} points
                        {i.periodStart && i.periodEnd && <span className="block">{formatDate(i.periodStart)} – {formatDate(i.periodEnd)}</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300 sm:px-2">
                        <SourceLink href={i.sourceRef?.url ?? null}>{SOURCE_NAMES[i.source] ?? i.source}</SourceLink>
                        <span className="block text-slate-500">{i.sourceRef?.fetchedAt ? formatDateTime(i.sourceRef.fetchedAt) : "fetch time not recorded"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div>
        <h3 className={h3}>Public signals for this company</h3>
        <p className="mb-2 text-xs text-slate-500">
          Scraped from public sources. Signals marked &quot;model input&quot; feed this question&apos;s model; the rest are context.
        </p>
        {tracked.length === 0 ? (
          <p className="text-sm text-slate-500">No public signals collected for this company yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {tracked.map((i) => (
              <li key={i.metricId} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{i.label}</span>
                  {used.has(i.metricId) && (
                    <span className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[11px] font-medium text-white dark:bg-slate-100 dark:text-slate-900">Model input</span>
                  )}
                </div>
                <p className="mt-0.5 tabular-nums">
                  {formatIndicatorValue(i.value, i.unit)}
                  {i.change4w != null && <span className="ml-2 text-xs text-slate-500">{formatRelativeChange(i.change4w)} vs 4 weeks earlier</span>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  <SourceLink href={i.sourceUrl}>{SOURCE_NAMES[i.source] ?? i.source}</SourceLink> · as of {formatDate(i.asOf)} · fetched{" "}
                  {formatDateTime(i.fetchedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {missing.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">Not collected: {missing.map((i) => i.label).join(", ")}.</p>
        )}
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
                <p className="text-xs text-slate-500">
                  As of {formatDate(i.asOf)} · entered {formatDateTime(i.fetchedAt)}
                </p>
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
