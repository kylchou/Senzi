import Link from "next/link";
import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { StartupSearch } from "@/components/vc/StartupSearch";
import { StartupWatchCard } from "@/components/vc/StartupWatchCard";
import { StatusBadge } from "@/components/vc/StatusBadge";
import { db } from "@/lib/db";
import { formatShare } from "@/lib/vc/estimates";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

/**
 * The one place for startups: search any company, see the ones your firm
 * follows (public signals and open markets), or browse them all. Following,
 * company detail and comparisons all start here.
 */
export default async function CompaniesPage() {
  const ctx = await requirePageContext("/vc/companies");
  if (!ctx.activeOrg) return <NoWorkspace />;
  const [view, companies] = await Promise.all([
    getVcServices().watchlists.overview(ctx),
    db.startup.findMany({ where: { isPublished: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" }, take: 200 }),
  ]);
  const followedIds = new Set(view.followed.map((w) => w.startup.id));
  const others = companies.filter((c) => !followedIds.has(c.id));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Companies</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Search any startup for its public signals, open markets and your firm&apos;s research. Follow it to get alerts.
          </p>
        </div>
        <Link href="/vc/compare" className="text-sm underline">
          Compare companies
        </Link>
      </header>

      <div className="max-w-xl">
        <StartupSearch />
      </div>

      <section aria-labelledby="following-heading" className="space-y-4">
        <h2 id="following-heading" className="text-lg font-semibold">
          Following
        </h2>
        {view.followed.length === 0 && view.followedStudies.length === 0 ? (
          <p className="text-sm text-slate-500">You&apos;re not following anything yet. Open a company and choose Follow.</p>
        ) : (
          view.followed.map((w) => <StartupWatchCard key={w.startup.id} watch={w} canEdit={view.canEdit} />)
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

      {others.length > 0 && (
        <section aria-labelledby="all-heading" className="space-y-3">
          <h2 id="all-heading" className="text-lg font-semibold">
            All companies
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/vc/companies/${c.slug}`}
                  className="block rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
