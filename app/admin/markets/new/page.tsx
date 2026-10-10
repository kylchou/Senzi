import { listAdminStartups, listOrganizationNames } from "@/lib/admin";
import { requireAdminPage } from "@/lib/auth";
import { createMarketAction } from "../../actions";
import { PageHeader } from "../../_components/ui";
import { MarketForm } from "../market-form";

export default async function NewMarketPage({ searchParams }: PageProps<"/admin/markets/new">) {
  const admin = await requireAdminPage("/admin/markets/new");
  const { startupId } = await searchParams;
  const [startups, organizations] = await Promise.all([listAdminStartups(admin), listOrganizationNames(admin)]);

  return (
    <>
      <PageHeader title="New market" />
      {startups.length === 0 ? (
        <p className="text-sm text-zinc-500">Add a startup first.</p>
      ) : (
        <MarketForm
          action={createMarketAction}
          startups={startups}
          organizations={organizations}
          defaultStartupId={typeof startupId === "string" ? startupId : undefined}
          submitLabel="Create market"
        />
      )}
    </>
  );
}
