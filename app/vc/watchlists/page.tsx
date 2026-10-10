import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { WatchlistManager } from "@/components/vc/WatchlistManager";
import { canProposeInActiveOrg } from "@/lib/vc/permissions";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

export default async function WatchlistsPage() {
  const ctx = await requirePageContext("/vc/watchlists");
  if (!ctx.activeOrg) return <NoWorkspace />;
  const watchlists = await getVcServices().watchlists.list(ctx);
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Watchlists</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Follow startups and studies. Followed items generate alerts for significant movements, deadlines and resolutions.
        </p>
      </header>
      <WatchlistManager watchlists={watchlists} canEdit={canProposeInActiveOrg(ctx)} />
    </div>
  );
}
