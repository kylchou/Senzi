import Link from "next/link";
import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { StartupSearch } from "@/components/vc/StartupSearch";
import { StartupWatchCard } from "@/components/vc/StartupWatchCard";
import { StatusBadge } from "@/components/vc/StatusBadge";
import { formatShare } from "@/lib/vc/estimates";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

export default async function WatchlistPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePageContext("/vc/watchlists");
  if (!ctx.activeOrg) return <NoWorkspace />;
  const { startup } = await searchParams;
  const selectedId = typeof startup === "string" && startup ? startup : null;
  const view = await getVcServices().watchlists.overview(ctx, selectedId);
  const followedOthers = view.followed.filter((w) => w.startup.id !== view.selected?.startup.id);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Search any startup to see its scraped public signals and open markets. Follow it to get alerts on big moves, deadlines and
          resolutions.
        </p>
      </header>

      <div className="max-w-xl">
        <StartupSearch />
      </div>

      {selectedId && !view.selected && <p className="text-sm text-slate-500">That startup isn&apos;t available.</p>}
      {view.selected && <StartupWatchCard watch={view.selected} canEdit={view.canEdit} />}

      <section aria-labelledby="following-heading" className="space-y-4">
        <h2 id="following-heading" className="text-lg font-semibold">
          Following
        </h2>
        {followedOthers.length === 0 && view.followedStudies.length === 0 && !view.selected?.following ? (
          <p className="text-sm text-slate-500">You&apos;re not following anything yet.</p>
        ) : (
          followedOthers.map((w) => <StartupWatchCard key={w.startup.id} watch={w} canEdit={view.canEdit} />)
        )}

        {view.followedStudies.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Followed questions</h3>
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-900">
              {view.followedStudies.map(({ study, estimate }) => (
                <li key={study.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <Link href={`/vc/studies/${study.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                    {study.question}
                  </Link>
                  <span className="flex items-center gap-3 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                    <StatusBadge status={study.status} />
                    <span>Model {formatShare(estimate?.modelValue ?? study.baselineValue)}</span>
                    <span>Market {formatShare(estimate?.generalPrice ?? null)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
