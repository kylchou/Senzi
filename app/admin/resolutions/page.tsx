import Link from "next/link";
import { requireAdminPage } from "@/lib/auth";
import { listResolutionProposals } from "@/lib/resolutions";
import { formatUtc, PageHeader, Table } from "../_components/ui";

export default async function AdminResolutionsPage() {
  const admin = await requireAdminPage("/admin/resolutions");
  const pending = await listResolutionProposals(admin, { status: "PROPOSED" });

  return (
    <>
      <PageHeader title="Resolutions awaiting approval" />
      <p className="mb-4 text-sm text-zinc-500">
        Each proposal needs a second admin. Open the market to review the evidence and approve or reject it.
      </p>
      <Table head={["Market", "Proposed outcome", "Proposed by", "When"]}>
        {pending.map((p) => (
          <tr key={p.id}>
            <td className="max-w-md py-2 pr-4">
              <Link className="hover:underline" href={`/admin/markets/${p.market.id}`}>{p.market.question}</Link>
              {p.correctsId && <span className="ml-2 text-xs text-amber-700">correction</span>}
            </td>
            <td className="py-2 pr-4 font-medium">{p.outcome}</td>
            <td className="py-2 pr-4">
              {p.proposedBy.displayName}
              {p.proposedById === admin.id && <span className="ml-1 text-xs text-zinc-500">(you)</span>}
            </td>
            <td className="whitespace-nowrap py-2 pr-4">{formatUtc(p.proposedAt)}</td>
          </tr>
        ))}
      </Table>
      {pending.length === 0 && <p className="mt-4 text-sm text-zinc-500">Nothing waiting.</p>}
    </>
  );
}
