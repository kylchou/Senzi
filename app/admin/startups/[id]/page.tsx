import Link from "next/link";
import { SourceLicense, SourceType } from "@/generated/prisma/enums";
import { getAdminStartup, listAdminMarkets } from "@/lib/admin";
import { listStartupFacts } from "@/lib/admin-content";
import { requireAdminPage } from "@/lib/auth";
import { createFactAction, deleteFactAction, setFactVerifiedAction, updateStartupAction } from "../../actions";
import { ActionForm } from "../../_components/action-form";
import { Badge, ButtonLink, Field, formatUtc, PageHeader, Section, Select, Table } from "../../_components/ui";
import { StartupForm } from "../startup-form";

export default async function EditStartupPage({ params }: PageProps<"/admin/startups/[id]">) {
  const { id } = await params;
  const admin = await requireAdminPage(`/admin/startups/${id}`);
  const [startup, markets, facts] = await Promise.all([
    getAdminStartup(admin, id),
    listAdminMarkets(admin, { startupId: id }),
    listStartupFacts(admin, id),
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
      <Section title={`Facts (${facts.length})`}>
        <p className="mb-4 text-sm text-zinc-500">
          Shown on the public startup page. Only mark a fact verified after checking it against its source.
        </p>
        {facts.length > 0 && (
          <Table head={["Fact", "Source", "As of", "Status", ""]}>
            {facts.map((fact) => (
              <tr key={fact.id} className="align-top">
                <td className="py-2 pr-4">
                  <span className="font-medium">{fact.label}:</span> {fact.value}
                </td>
                <td className="py-2 pr-4">
                  <a className="underline" href={fact.sourceUrl} target="_blank" rel="noreferrer noopener">
                    {fact.sourceName}
                  </a>
                </td>
                <td className="whitespace-nowrap py-2 pr-4">{formatUtc(fact.asOf)}</td>
                <td className="py-2 pr-4">
                  <Badge>{fact.verified ? "VERIFIED" : "UNVERIFIED"}</Badge>
                </td>
                <td className="space-y-2 py-2 pr-4">
                  <ActionForm
                    action={setFactVerifiedAction.bind(null, fact.id)}
                    submitLabel={fact.verified ? "Unverify" : "Verify"}
                  >
                    <input type="hidden" name="verified" value={fact.verified ? "false" : "true"} />
                  </ActionForm>
                  <ActionForm action={deleteFactAction.bind(null, fact.id)} submitLabel="Delete" tone="danger" />
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-medium">Add a fact</h3>
          <ActionForm action={createFactAction.bind(null, startup.id)} submitLabel="Add fact">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Label" name="label" required placeholder="Total funding" />
              <Field label="Value" name="value" required placeholder="$212M" />
              <Field label="Source name" name="sourceName" required placeholder="Company press release" />
              <Field label="Source URL" name="sourceUrl" type="url" required />
              <Field label="As of (UTC)" name="asOf" type="datetime-local" required />
              <Select
                label="Source type"
                name="sourceType"
                defaultValue="COMPANY_ANNOUNCEMENT"
                options={Object.values(SourceType).map((v) => ({ value: v, label: v.replace(/_/g, " ").toLowerCase() }))}
              />
              <Select
                label="What we may do with it"
                name="license"
                defaultValue="LINK_ONLY"
                options={Object.values(SourceLicense).map((v) => ({ value: v, label: v.replace(/_/g, " ").toLowerCase() }))}
              />
            </div>
            <Field label="I checked this against the source (verified)" name="verified" type="checkbox" />
          </ActionForm>
        </div>
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
