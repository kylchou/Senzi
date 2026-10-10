import Link from "next/link";
import { Clock, Users } from "lucide-react";
import { AllocationBar } from "@/components/ui/AllocationBar";
import { MarketStatusBadge } from "@/components/ui/MarketStatusBadge";
import { CardSparkline } from "@/components/ui/CardSparkline";
import { StartupMark } from "@/components/ui/StartupMark";
import { Morph } from "@/components/ui/Transitions";
import { formatDate, formatDeadline, formatShare } from "@/lib/market-view/format";
import type { MarketSummary } from "@/lib/market-view/types";

export function MarketCard({ market }: { market: MarketSummary }) {
  const { allocation, openingBaseline } = market;
  const isLive = market.status === "OPEN";

  return (
    <article className="group relative flex h-full flex-col surface-card card-hover p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <StartupMark name={market.startup.name} logoUrl={market.startup.logoUrl} size="sm" />
          <div className="min-w-0 text-sm leading-tight">
            <p className="truncate font-semibold text-ink-900">{market.startup.name}</p>
            <p className="truncate text-xs text-ink-500">{market.startup.industry}</p>
          </div>
        </div>
        <MarketStatusBadge status={market.status} outcome={market.outcome} closesAt={market.closesAt} />
      </div>

      <Morph name={`market-title-${market.id}`}>
        <h3 className="mt-4 line-clamp-3 font-display text-[17px] font-semibold leading-snug text-ink-900">
          <Link href={`/markets/${market.slug}`} className="after:absolute after:inset-0 after:rounded-[var(--radius-card)]">
            {market.question}
          </Link>
        </h3>
      </Morph>

      <div className="mt-auto pt-5">
        <div className="mb-2.5 flex items-end justify-between gap-2">
          <div>
            <p className="font-display text-3xl font-semibold tracking-tight tabular-nums text-ink-900">
              {allocation.share === null ? "N/A" : formatShare(allocation.share)}
            </p>
            <p className="text-xs text-ink-500">YES allocation</p>
          </div>
          <CardSparkline slug={market.slug} />
          {openingBaseline !== null && (
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums text-ink-700">{formatShare(openingBaseline)}</p>
              <p className="text-xs text-ink-500">Baseline</p>
            </div>
          )}
        </div>
        <AllocationBar share={allocation.share} baseline={openingBaseline} size="sm" />

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100 pt-3 text-xs text-ink-600">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden />
            {isLive ? formatDeadline(market.closesAt) : market.resolvedAt ? `Resolved ${formatDate(market.resolvedAt)}` : `Closed ${formatDate(market.closesAt)}`}
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Users className="size-3.5" aria-hidden />
            {allocation.forecastCount} {allocation.forecastCount === 1 ? "forecast" : "forecasts"}
          </span>
        </div>
      </div>
    </article>
  );
}
