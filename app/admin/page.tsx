import Link from "next/link";
import { getAdminOverview } from "@/lib/admin";
import { requireAdminPage } from "@/lib/auth";
import { PageHeader, Section } from "./_components/ui";

export default async function AdminOverviewPage() {
  const admin = await requireAdminPage("/admin");
  const overview = await getAdminOverview(admin);

  const stats = [
    { label: "Users", value: overview.users },
    { label: "Startups", value: overview.startups },
    { label: "Open markets", value: overview.marketsByStatus.OPEN },
    { label: "Awaiting resolution", value: overview.marketsByStatus.CLOSED },
    { label: "Draft markets", value: overview.marketsByStatus.DRAFT },
    { label: "Resolutions awaiting approval", value: overview.awaitingApproval },
    { label: "Unsettled resolutions", value: overview.pendingSettlements },
  ];

  return (
    <>
      <PageHeader title={`Welcome, ${admin.displayName}`} />
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">{s.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>
      <Section title="Common tasks">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li><Link className="underline" href="/admin/resolutions">Review proposed resolutions</Link></li>
          <li><Link className="underline" href="/admin/markets?status=CLOSED">Resolve closed markets</Link></li>
          <li><Link className="underline" href="/admin/markets/new">Create a market</Link></li>
          <li><Link className="underline" href="/admin/startups/new">Add a startup</Link></li>
        </ul>
      </Section>
    </>
  );
}
