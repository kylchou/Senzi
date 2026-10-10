import Link from "next/link";
import type { ReactNode } from "react";
import { ALLOCATION_SHARE_LABEL } from "@/lib/vc/constants";
import { formatPointChange, formatShare } from "@/lib/vc/estimates";
import { formatDate } from "@/lib/vc/format";
import type { CompareColumn, CompareQuestion, StartupComparison } from "@/lib/vc/types";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const MAX_LISTED = 5;

function Row({ label, hint, columns, render }: { label: string; hint?: string; columns: CompareColumn[]; render: (c: CompareColumn) => ReactNode }) {
  return (
    <tr className="border-t border-slate-200 align-top dark:border-slate-800">
      <th scope="row" className="w-44 px-3 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
        {hint && <span className="mt-0.5 block font-normal text-slate-500">{hint}</span>}
      </th>
      {columns.map((c) => (
        <td key={c.startup.id} className="px-3 py-3 text-sm">
          {render(c)}
        </td>
      ))}
    </tr>
  );
}

function QuestionLine({ q }: { q: CompareQuestion }) {
  const title = q.href ? (
    <Link href={q.href} className="hover:underline">
      {q.question}
    </Link>
  ) : (
    q.question
  );
  return (
    <li className="py-1.5">
      <div className="text-sm">{title}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500 dark:text-slate-400">
        {q.kind === "study" && <span className="font-medium text-slate-600 dark:text-slate-300">Study</span>}
        <span title={ALLOCATION_SHARE_LABEL}>{formatShare(q.allocationShare)} YES alloc.</span>
        <span>baseline {formatShare(q.openingBaseline)}</span>
        {q.calibratedProbability != null && <span>calibrated {formatShare(q.calibratedProbability)}</span>}
        {q.change7d != null && <span>{formatPointChange(q.change7d)} 7d</span>}
        <span>{q.forecasters} forecasters</span>
        {q.outcome && <span className="font-medium text-slate-700 dark:text-slate-200">Outcome {q.outcome}</span>}
        {!q.outcome && q.closesAt && <span>closes {formatDate(q.closesAt)}</span>}
      </div>
    </li>
  );
}

function QuestionList({ items, empty }: { items: CompareQuestion[]; empty: string }) {
  if (items.length === 0) return <p className="text-slate-500">{empty}</p>;
  return (
    <>
      <p className="text-xs font-medium tabular-nums text-slate-500">{items.length} total</p>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.slice(0, MAX_LISTED).map((q) => (
          <QuestionLine key={q.marketId} q={q} />
        ))}
      </ul>
      {items.length > MAX_LISTED && <p className="text-xs text-slate-500">+{items.length - MAX_LISTED} more</p>}
    </>
  );
}

function score(v: number | null) {
  return v == null ? "—" : v.toFixed(3);
}

/** Side-by-side comparison. Rows are aligned so each measure is read across startups. */
export function CompareView({ comparison }: { comparison: StartupComparison }) {
  const { columns } = comparison;
  const indicatorLabels = [...new Set(columns.flatMap((c) => c.indicators.rows.map((r) => r.label)))];

  return (
    <div className="space-y-4">
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[720px] table-fixed border-collapse rounded-lg bg-white dark:bg-slate-950">
          <thead>
            <tr>
              <th className="w-44" />
              {columns.map((c) => (
                <th key={c.startup.id} scope="col" className="px-3 py-3 text-left align-bottom">
                  <Link href={`/startups/${c.startup.slug}`} className="text-base font-semibold hover:underline">
                    {c.startup.name}
                  </Link>
                  {c.startup.industry && <span className="block text-xs font-normal text-slate-500">{c.startup.industry}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row
              label="Open questions"
              hint="Allocation share, opening baseline, and calibrated probability are separate measures."
              columns={columns}
              render={(c) => <QuestionList items={c.open} empty="No open questions." />}
            />
            <Row
              label="Awaiting resolution"
              columns={columns}
              render={(c) => <QuestionList items={c.closed} empty="None." />}
            />
            <Row
              label="Resolved"
              columns={columns}
              render={(c) => <QuestionList items={c.resolved} empty="No resolved questions yet." />}
            />
            <Row
              label="YES rate"
              hint="Share of resolved questions that resolved YES, with a 95% interval."
              columns={columns}
              render={({ trackRecord: t }) =>
                t.yesRate == null ? (
                  "—"
                ) : (
                  <span className="tabular-nums">
                    {formatShare(t.yesRate)} ({t.yes}/{t.decided})
                    {t.yesRateInterval && (
                      <span className="block text-xs text-slate-500">
                        {formatShare(t.yesRateInterval[0])}–{formatShare(t.yesRateInterval[1])}
                      </span>
                    )}
                  </span>
                )
              }
            />
            <Row
              label="Brier score"
              hint="Lower is better. Compares each number with the resolved outcome."
              columns={columns}
              render={({ trackRecord: t }) => (
                <dl className="space-y-0.5 text-xs tabular-nums">
                  <div>
                    <dt className="inline text-slate-500">Opening baseline: </dt>
                    <dd className="inline">{score(t.baselineBrier)}</dd>
                  </div>
                  <div>
                    <dt className="inline text-slate-500">Final allocation share: </dt>
                    <dd className="inline">{score(t.allocationShareBrier)}</dd>
                  </div>
                  {t.limitations.map((l) => (
                    <p key={l} className="text-slate-500">
                      {l}
                    </p>
                  ))}
                </dl>
              )}
            />
            {indicatorLabels.length === 0 ? (
              <Row
                label="Public indicators"
                columns={columns}
                render={(c) => (
                  <span className="text-slate-500">
                    {c.indicators.status === "unavailable" ? "Indicators are temporarily unavailable." : "Not tracked by the model yet."}
                  </span>
                )}
              />
            ) : (
              indicatorLabels.map((label) => (
                <Row
                  key={label}
                  label={label}
                  hint="Public indicator"
                  columns={columns}
                  render={(c) => {
                    const r = c.indicators.rows.find((x) => x.label === label);
                    if (!r) return <span className="text-slate-500">{c.indicators.status === "ok" ? "—" : "Not tracked"}</span>;
                    if (r.value == null) return <span className="text-slate-500">{r.missingReason ?? "No data"}</span>;
                    return (
                      <span className="tabular-nums">
                        {compact.format(r.value)} {r.unit}
                        <span className="block text-xs text-slate-500">
                          {r.change4w != null && `${r.change4w >= 0 ? "+" : "−"}${Math.abs(r.change4w * 100).toFixed(0)}% vs 4 weeks earlier · `}
                          as of {r.asOf ?? "—"}
                          {r.sourceUrl && (
                            <>
                              {" · "}
                              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                                source
                              </a>
                            </>
                          )}
                        </span>
                      </span>
                    );
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500 dark:text-slate-400">
        {comparison.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
