import { formatDate } from "@/lib/vc/format";
import type { StartupFactView, StartupNewsView } from "@/lib/vc/types";

const BADGE = {
  verified: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900",
  unverified: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
  disputed: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900",
} as const;

const NEWS_LABEL: Record<StartupNewsView["verification"], { text: string; tone: keyof typeof BADGE }> = {
  VERIFIED: { text: "Verified report", tone: "verified" },
  UNVERIFIED: { text: "Unverified report", tone: "unverified" },
  DISPUTED: { text: "Disputed report", tone: "disputed" },
};

function Badge({ tone, children }: { tone: keyof typeof BADGE; children: string }) {
  return <span className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${BADGE[tone]}`}>{children}</span>;
}

function Source({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600">
      {children}
    </a>
  );
}

/** Public facts about a startup, each labelled verified or unverified. */
export function FactList({ facts }: { facts: StartupFactView[] }) {
  if (facts.length === 0) return <p className="text-sm text-slate-500">None recorded.</p>;
  return (
    <ul className="space-y-2.5 text-sm">
      {facts.map((f) => (
        <li key={f.id}>
          <div className="flex items-start justify-between gap-2">
            <span>
              <span className="font-medium">{f.label}:</span> {f.value}
            </span>
            <Badge tone={f.verified ? "verified" : "unverified"}>{f.verified ? "Verified fact" : "Unverified fact"}</Badge>
          </div>
          <span className="block text-xs text-slate-500">
            <Source href={f.sourceUrl}>{f.sourceName}</Source> · as of {formatDate(f.asOf)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** News articles about a startup, each labelled verified, unverified or disputed. */
export function NewsList({ news, emptyText = "None recorded." }: { news: StartupNewsView[]; emptyText?: string }) {
  if (news.length === 0) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <ul className="space-y-2.5 text-sm">
      {news.map((n) => (
        <li key={n.id}>
          <div className="flex items-start justify-between gap-2">
            <Source href={n.url}>
              <span className="font-medium">{n.title}</span>
            </Source>
            <Badge tone={NEWS_LABEL[n.verification].tone}>{NEWS_LABEL[n.verification].text}</Badge>
          </div>
          {n.summary && <p className="mt-0.5 text-slate-600 dark:text-slate-300">{n.summary}</p>}
          <span className="block text-xs text-slate-500">
            {n.publisher} · {formatDate(n.publishedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Public facts and news about a study's startup, each labelled as verified,
 * unverified or disputed so it's never mistaken for an estimate or a forecast.
 */
export function EvidenceList({ facts, news }: { facts: StartupFactView[]; news: StartupNewsView[] }) {
  if (facts.length === 0 && news.length === 0) {
    return <p className="text-sm text-slate-500">No facts or news recorded for this startup yet.</p>;
  }
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Facts</h3>
        <FactList facts={facts} />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">News</h3>
        <NewsList news={news} />
      </div>
    </div>
  );
}
