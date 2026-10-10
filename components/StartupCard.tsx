import Link from "next/link";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { StartupMark } from "@/components/ui/StartupMark";
import { formatStage } from "@/lib/market-view/format";
import type { StartupSummary } from "@/lib/market-view/types";

export function StartupCard({ startup }: { startup: StartupSummary }) {
  return (
    <article className="group relative flex h-full flex-col surface-card card-hover p-5">
      <div className="flex items-start gap-3">
        <StartupMark name={startup.name} logoUrl={startup.logoUrl} />
        <div className="min-w-0">
          <h3 translate="no" className="truncate font-display text-base font-semibold text-ink-900">
            <Link href={`/startups/${startup.slug}`} className="after:absolute after:inset-0 after:rounded-[var(--radius-card)]">
              {startup.name}
            </Link>
          </h3>
          <p className="text-xs text-ink-500">
            {startup.industry} · {formatStage(startup.stage)}
          </p>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-ink-700">{startup.tagline}</p>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4 text-xs text-ink-600">
        {startup.headquarters && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden />
            {startup.headquarters}
          </span>
        )}
        {startup.foundedYear && <span>Founded {startup.foundedYear}</span>}
        {startup.openMarketCount > 0 && (
          <Badge tone="live" className="ml-auto">
            {`${startup.openMarketCount} open ${startup.openMarketCount === 1 ? "market" : "markets"}`}
          </Badge>
        )}
      </div>
    </article>
  );
}
