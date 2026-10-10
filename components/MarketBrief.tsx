import { CheckCircle2, CircleSlash, Scale } from "lucide-react";
import { AllocationBar } from "@/components/ui/AllocationBar";
import { ExternalLink } from "@/components/ui/ExternalLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { formatCredits, formatDate, formatRelative, formatShare } from "@/lib/market-view/format";
import type { MarketDetail } from "@/lib/market-view/types";

function Stat({ label, tip, value, note }: { label: string; tip: React.ReactNode; value: string; note: string }) {
  return (
    <div className="bg-surface p-5">
      <div className="flex items-center gap-1 text-xs font-medium text-ink-600">
        {label}
        <InfoTip label={`About ${label.toLowerCase()}`}>{tip}</InfoTip>
      </div>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink-900 sm:text-3xl">{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{note}</p>
    </div>
  );
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Key figures and resolution criteria. Each figure is labeled for what it measures. */
export function MarketBrief({ market }: { market: MarketDetail }) {
  const { allocation, resolution } = market;

  return (
    <div className="space-y-6">
      {resolution && (
        <div className="flex items-start gap-3 rounded-[var(--radius-card)] bg-ink-900 p-5 text-surface">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-red-500" aria-hidden />
          <div className="min-w-0">
            <p className="font-display text-lg font-bold">
              {resolution.outcome === "VOID" ? "Resolved as void" : `Resolved ${resolution.outcome}`}
            </p>
            <p className="text-sm text-ink-300">Verified outcome, {formatDate(resolution.resolvedAt)}.</p>
            <p className="mt-2 text-sm text-ink-200">{resolution.evidenceSummary}</p>
            {resolution.evidenceUrls.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {resolution.evidenceUrls.map((url) => (
                  <li key={url}>
                    <ExternalLink href={url} className="text-surface decoration-surface/30">
                      {hostname(url)}
                    </ExternalLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-ink-200 bg-surface">
        {/* 1px gaps over an ink background draw the dividers at every breakpoint. */}
        <div className="grid grid-cols-2 gap-px bg-ink-100 sm:grid-cols-4">
          <Stat
            label="YES allocation"
            value={formatShare(allocation.share)}
            note={market.updatedAt ? `Updated ${formatRelative(market.updatedAt)}` : "No forecasts yet"}
            tip="Share of virtual credits placed on YES. Shows where forecasters put credits. Not a probability."
          />
          <Stat
            label="Calibrated"
            value={formatShare(market.calibratedProbability)}
            note={market.calibratedProbability === null ? "Not yet available" : "From the forecasting engine"}
            tip="Probability of YES from the forecasting engine, shown only once its calibration report supports it. Separate from the community allocation."
          />
          <Stat
            label="Opening baseline"
            value={formatShare(market.openingBaseline)}
            note={market.openingBaseline === null ? "Not set" : "Set at open"}
            tip={
              market.baselineMethodology ??
              "Starting estimate set before any forecasts, with its method. Not a community figure."
            }
          />
          <Stat
            label="Forecasts"
            value={formatCredits(allocation.forecastCount)}
            note={
              market.forecasterCount !== null
                ? `${formatCredits(market.forecasterCount)} ${market.forecasterCount === 1 ? "forecaster" : "forecasters"}`
                : `${formatCredits(allocation.yesCredits + allocation.noCredits)} credits`
            }
            tip="Forecasts placed on this market and the number of unique forecasters."
          />
        </div>
        <div className="border-t border-ink-100 px-5 py-4">
          <AllocationBar share={allocation.share} baseline={market.openingBaseline} />
          <div className="mt-2 flex justify-between text-xs tabular-nums text-ink-600">
            <span>
              <span className="font-semibold text-ink-900">YES</span> {formatCredits(allocation.yesCredits)} credits
            </span>
            <span>
              {formatCredits(allocation.noCredits)} credits <span className="font-semibold text-ink-900">NO</span>
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-ink-200 p-5">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-red-700">
            <Scale className="size-4" aria-hidden /> Resolves YES if
          </p>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-800">{market.yesCriteria}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-ink-200 p-5">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-600">
            <CircleSlash className="size-4" aria-hidden /> Resolves NO if
          </p>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-800">{market.noCriteria}</p>
        </div>
      </div>
      {market.resolvesBy && !resolution && (
        <p className="text-sm text-ink-600">Expected resolution by {formatDate(market.resolvesBy)}.</p>
      )}
    </div>
  );
}
