import Link from "next/link";
import { AlertList } from "@/components/vc/AlertList";
import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { ALERT_TYPE_LABELS } from "@/lib/vc/format";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";
import { ALERT_TYPES, type AlertType } from "@/lib/vc/types";

export default async function AlertsPage({ searchParams }: PageProps<"/vc/alerts">) {
  const ctx = await requirePageContext("/vc/alerts");
  if (!ctx.activeOrg) return <NoWorkspace />;
  const raw = await searchParams;
  const type = ALERT_TYPES.find((t) => t === raw.type) as AlertType | undefined;
  const unreadOnly = raw.unread === "true";
  const alerts = await getVcServices().alerts.list(ctx, { type, unreadOnly, limit: 100 });

  const href = (p: { type?: AlertType | null; unread?: boolean }) => {
    const params = new URLSearchParams();
    const t = p.type === undefined ? type : p.type;
    const u = p.unread === undefined ? unreadOnly : p.unread;
    if (t) params.set("type", t);
    if (u) params.set("unread", "true");
    const qs = params.toString();
    return qs ? `/vc/alerts?${qs}` : "/vc/alerts";
  };
  const chip = (active: boolean) =>
    `rounded-full px-2.5 py-1 ring-1 ring-inset ${
      active ? "bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900" : "ring-slate-300 dark:ring-slate-700"
    }`;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Alerts only include studies you are allowed to see. Movement alerts describe changes in community credit
          allocation, not calibrated probabilities. New alerts also appear in your notifications.
        </p>
      </header>
      <nav aria-label="Filter alerts" className="flex flex-wrap gap-1.5 text-xs">
        <Link href={href({ type: null })} className={chip(!type)} aria-current={!type ? "page" : undefined}>
          All types
        </Link>
        {ALERT_TYPES.map((t) => (
          <Link key={t} href={href({ type: t })} className={chip(type === t)} aria-current={type === t ? "page" : undefined}>
            {ALERT_TYPE_LABELS[t].label}
          </Link>
        ))}
        <span className="mx-1 border-l border-slate-300 dark:border-slate-700" aria-hidden />
        <Link href={href({ unread: !unreadOnly })} className={chip(unreadOnly)} aria-pressed={unreadOnly}>
          Unread only
        </Link>
      </nav>
      <AlertList
        key={`${type ?? "all"}-${unreadOnly}`}
        initialAlerts={alerts}
        emptyText={type || unreadOnly ? "No alerts match these filters." : undefined}
      />
    </div>
  );
}
