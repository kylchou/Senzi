import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatPointChange, formatShare } from "@/lib/market-view/format";
import type { MarketMove } from "@/lib/market-view/insights";
import { StartupMark } from "./StartupMark";

/** Compact list of the markets whose market probability moved most. */
export function BiggestMoves({ moves }: { moves: MarketMove[] }) {
  return (
    <ul className="surface-card divide-y divide-ink-100 overflow-hidden">
      {moves.map(({ market, from, to, delta }) => {
        const Icon = delta >= 0 ? ArrowUpRight : ArrowDownRight;
        return (
          <li key={market.id}>
            <Link
              href={`/markets/${market.slug}`}
              className="group flex items-center gap-4 px-5 py-4 transition-colors duration-200 hover:bg-ink-50"
            >
              <StartupMark name={market.startup.name} logoUrl={market.startup.logoUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-900">{market.question}</span>
                <span className="block text-xs tabular-nums text-ink-500">
                  {market.startup.name} · Market probability {formatShare(from)} to {formatShare(to)}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-ink-800 transition-transform duration-200 group-hover:translate-x-0.5">
                <Icon className="size-3.5 text-red-500" aria-hidden />
                {formatPointChange(delta)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
