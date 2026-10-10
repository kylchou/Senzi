import Link from "next/link";
import { AlertTriangle, ArrowUpRight, BadgeCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/market-view/format";
import type { NewsItemView } from "@/lib/market-view/types";

/** Verified facts and reported claims are labeled differently (NewsItem.verification). */
export function VerificationLabel({ verification }: { verification: NewsItemView["verification"] }) {
  if (verification === "VERIFIED") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-red-700">
        <BadgeCheck className="size-3.5" aria-hidden />
        Verified
      </span>
    );
  }
  if (verification === "DISPUTED") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-ink-900">
        <AlertTriangle className="size-3.5" aria-hidden />
        Disputed
      </span>
    );
  }
  return <span className="text-ink-500">Reported</span>;
}

export function NewsFeed({
  items,
  showStartup = true,
  emptyTitle = "No news yet",
}: {
  items: NewsItemView[];
  showStartup?: boolean;
  emptyTitle?: string;
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} body="Sourced coverage appears here once published." />;
  }

  return (
    <ul className="divide-y divide-ink-100 rounded-[var(--radius-card)] border border-ink-200 bg-white">
      {items.map((item) => (
        <li key={item.id} className="group relative p-5 transition-colors hover:bg-ink-50">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            <span className="font-semibold text-ink-700">{item.publisher}</span>
            <span aria-hidden>·</span>
            <time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time>
            <span aria-hidden>·</span>
            <VerificationLabel verification={item.verification} />
            {showStartup && item.startup && (
              <>
                <span aria-hidden>·</span>
                <Link href={`/startups/${item.startup.slug}`} className="relative z-10 font-medium text-ink-700 hover:underline">
                  {item.startup.name}
                </Link>
              </>
            )}
          </div>
          <h3 className="mt-1.5 font-semibold leading-snug text-ink-900">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1 after:absolute after:inset-0"
            >
              {item.title}
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-ink-400 transition-colors group-hover:text-red-500" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </h3>
          {item.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-600">{item.summary}</p>}
        </li>
      ))}
    </ul>
  );
}
