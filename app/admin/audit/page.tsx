import Link from "next/link";
import { listAuditLogs } from "@/lib/admin";
import { requireAdminPage } from "@/lib/auth";
import { formatUtc, PageHeader, Table } from "../_components/ui";

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const admin = await requireAdminPage("/admin/audit");
  const { cursor } = await searchParams;
  const page = await listAuditLogs(admin, {
    cursor: typeof cursor === "string" ? cursor : undefined,
    limit: 50,
  });

  return (
    <>
      <PageHeader title="Audit log" />
      <Table head={["When", "Action", "Entity", "Actor", "Details"]}>
        {page.items.map((entry) => (
          <tr key={entry.id} className="align-top">
            <td className="whitespace-nowrap py-2 pr-4">{formatUtc(entry.createdAt)}</td>
            <td className="py-2 pr-4 font-mono text-xs">{entry.action}</td>
            <td className="py-2 pr-4 font-mono text-xs">
              {entry.entityType}
              <div className="text-zinc-400">{entry.entityId}</div>
            </td>
            <td className="py-2 pr-4 font-mono text-xs">{entry.actorId ?? "system"}</td>
            <td className="max-w-sm py-2 pr-4">
              {entry.data ? (
                <pre className="whitespace-pre-wrap break-all text-xs text-zinc-600 dark:text-zinc-400">
                  {JSON.stringify(entry.data, null, 1)}
                </pre>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
      {page.nextCursor && (
        <Link className="mt-4 inline-block text-sm underline" href={`/admin/audit?cursor=${page.nextCursor}`}>
          Older entries
        </Link>
      )}
    </>
  );
}
