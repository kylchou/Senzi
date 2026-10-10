import Link from "next/link";
import { listAdminStartups } from "@/lib/admin";
import { requireAdminPage } from "@/lib/auth";
import { ButtonLink, PageHeader, Table } from "../_components/ui";

export default async function AdminStartupsPage() {
  const admin = await requireAdminPage("/admin/startups");
  const startups = await listAdminStartups(admin);

  return (
    <>
      <PageHeader title="Startups" action={<ButtonLink href="/admin/startups/new">New startup</ButtonLink>} />
      <Table head={["Name", "Industry", "Stage", "Markets", "Status"]}>
        {startups.map((s) => (
          <tr key={s.id}>
            <td className="py-2 pr-4">
              <Link className="font-medium underline-offset-2 hover:underline" href={`/admin/startups/${s.id}`}>
                {s.name}
              </Link>
            </td>
            <td className="py-2 pr-4">{s.industry}</td>
            <td className="py-2 pr-4">{s.stage.replace(/_/g, " ")}</td>
            <td className="py-2 pr-4 tabular-nums">{s.marketCount}</td>
            <td className="py-2 pr-4">{s.isPublished ? "Published" : "Hidden"}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
