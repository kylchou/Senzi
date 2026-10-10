import { getAdminStartup, listAdminMarkets } from "@/lib/admin";
import { requireAdminPage } from "@/lib/auth";
import { updateStartupAction } from "../../actions";
import { Badge, ButtonLink, PageHeader, Section } from "../../_components/ui";
import { StartupForm } from "../startup-form";
import Link from "next/link";

export default async function EditStartupPage({ params }: PageProps<"/admin/startups/[id]">) {
  const { id } = await params;
  const admin = await requireAdminPage(`/admin/startups/${id}`);
  const [startup, markets] = await Promise.all([
    getAdminStartup(admin, id),
    listAdminMarkets(admin, { startupId: id }),
  ]);

  return (
    <>
      <PageHeader
        title={startup.name}
        action={<ButtonLink href={`/admin/markets/new?startupId=${startup.id}`}>New market</ButtonLink>}
      />
      <Section title="Details">
        <StartupForm action={updateStartupAction.bind(null, startup.id)} startup={startup} submitLabel="Save" />
      </Section>
      <Section title={`Markets (${markets.length})`}>
        <ul className="space-y-2 text-sm">
          {markets.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <Badge>{m.status}</Badge>
              <Link className="hover:underline" href={`/admin/markets/${m.id}`}>
                {m.question}
              </Link>
            </li>
          ))}
          {markets.length === 0 && <li className="text-zinc-500">No markets yet.</li>}
        </ul>
      </Section>
    </>
  );
}
