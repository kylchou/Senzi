import Link from "next/link";
import { formatShare } from "@/lib/vc/estimates";
import { formatDate } from "@/lib/vc/format";
import type { StartupWatch } from "@/lib/vc/services/watchlists";
import { FollowButton } from "./FollowButton";

const number = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const change = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}%`);

/** One startup: its scraped public signals and the open markets on it this firm can see. */
export function StartupWatchCard({ watch, canEdit }: { watch: StartupWatch; canEdit: boolean }) {
  const { startup, indicators, openMarkets } = watch;
  const rows = indicators.rows.filter((r) => r.value != null);
  return (
    <section
      aria-labelledby={`watch-${startup.id}`}
      className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`watch-${startup.id}`} className="text-lg font-semibold">
            {startup.name}
          </h2>
          {startup.industry && <p className="text-sm text-slate-500 dark:text-slate-400">{startup.industry}</p>}
        </div>
        {canEdit && <FollowButton target={{ type: "STARTUP", startupId: startup.id }} following={watch.following} />}
      </header>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Scraped public signals</h3>
        {indicators.status === "not_tracked" ? (
          <p className="text-sm text-slate-500">We don&apos;t collect public data for this startup yet.</p>
        ) : indicators.status === "unavailable" ? (
          <p className="text-sm text-slate-500">Public signals are temporarily unavailable.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No public signals recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="py-1.5 pr-3 font-medium">Signal</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Value</th>
                  <th className="whitespace-nowrap py-1.5 pr-3 text-right font-medium">4 wk</th>
                  <th className="hidden py-1.5 font-medium sm:table-cell">As of</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.metricId} className="border-b border-slate-100 last:border-0 dark:border-slate-900">
                    <td className="py-1.5 pr-3">
                      {r.sourceUrl ? (
                        <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600">
                          {r.label}
                        </a>
                      ) : (
                        r.label
                      )}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">
                      {number(r.value!)} <span className="hidden text-xs text-slate-500 sm:inline">{r.unit}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{change(r.change4w)}</td>
                    <td className="hidden whitespace-nowrap py-1.5 text-slate-500 sm:table-cell">{r.asOf ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Open markets</h3>
        {openMarkets.length === 0 ? (
          <p className="text-sm text-slate-500">No open markets on {startup.name} right now.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-900">
            {openMarkets.map((m) => {
              const href = m.kind === "study" ? `/vc/studies/${m.study.id}` : m.market.slug ? `/markets/${m.market.slug}` : null;
              const question = m.kind === "study" ? m.study.question : m.market.question;
              const closes = m.kind === "study" ? m.study.deadline : m.market.closesAt;
              const e = m.estimate;
              return (
                <li key={m.kind === "study" ? m.study.id : m.market.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                  <span className="min-w-0 flex-1">
                    {href ? (
                      <Link href={href} className="font-medium hover:underline">
                        {question}
                      </Link>
                    ) : (
                      <span className="font-medium">{question}</span>
                    )}
                    <span className="block text-xs text-slate-500">
                      {m.kind === "study" ? "Research question" : "Community market"}
                      {closes && ` · closes ${formatDate(closes)}`}
                      {e && ` · ${e.participantCount} forecaster${e.participantCount === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-3 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                    <span>Model {formatShare(e?.modelValue ?? e?.openingBaseline?.value ?? null)}</span>
                    <span>Market {formatShare(e?.generalPrice ?? null)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
