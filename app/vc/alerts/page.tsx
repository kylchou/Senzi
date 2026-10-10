import { AlertList } from "@/components/vc/AlertList";
import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

export default async function AlertsPage() {
  const ctx = await requirePageContext("/vc/alerts");
  if (!ctx.activeOrg) return <NoWorkspace />;
  const alerts = await getVcServices().alerts.list(ctx, { limit: 100 });
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Alerts only include studies you are allowed to see. Movement alerts describe changes in community credit
          allocation, not calibrated probabilities.
        </p>
      </header>
      <AlertList initialAlerts={alerts} />
    </div>
  );
}
