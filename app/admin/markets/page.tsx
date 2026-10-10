import Link from "next/link";
import { MarketStatus } from "@/generated/prisma/enums";
import { listAdminMarkets } from "@/lib/admin";
import { requireAdminPage } from "@/lib/auth";
import { Badge, ButtonLink, formatUtc, PageHeader, Table } from "../_components/ui";

export default async function AdminMarketsPage({ searchParams }: PageProps<"/admin/markets">) {
  const admin = await requireAdminPage("/admin/markets");
  const { status: rawStatus } = await searchParams;
  const status = Object.values(MarketStatus).find((s) => s === rawStatus);
  const markets = await listAdminMarkets(admin, { status });

  return (
    <>
      <PageHeader title="Markets" action={<ButtonLink href="/admin/markets/new">New market</ButtonLink>} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/admin/markets" className={!status ? "font-semibold" : "text-zinc-500"}>All</Link>
        {Object.values(MarketStatus).map((s) => (
          <Link key={s} href={`/admin/markets?status=${s}`} className={status === s ? "font-semibold" : "text-zinc-500"}>
            {s.toLowerCase()}
          </Link>
        ))}
      </div>
      <Table head={["Question", "Startup", "Status", "Deadline", "Forecasts", "Settlement"]}>
        {markets.map((m) => (
          <tr key={m.id}>
            <td className="max-w-md py-2 pr-4">
              <Link className="hover:underline" href={`/admin/markets/${m.id}`}>{m.question}</Link>
              {m.visibility !== "PUBLIC" && <span className="ml-2 text-xs text-zinc-500">{m.visibility.toLowerCase()}</span>}
            </td>
            <td className="py-2 pr-4">{m.startup.name}</td>
            <td className="py-2 pr-4"><Badge>{m.status}</Badge></td>
            <td className="whitespace-nowrap py-2 pr-4">{formatUtc(m.closesAt)}</td>
            <td className="py-2 pr-4 tabular-nums">{m.forecastCount}</td>
            <td className="py-2 pr-4">{m.resolution ? <Badge>{m.resolution.settlementStatus}</Badge> : "—"}</td>
          </tr>
        ))}
      </Table>
      {markets.length === 0 && <p className="mt-4 text-sm text-zinc-500">No markets match.</p>}
    </>
  );
}
