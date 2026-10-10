import { MarketStatus } from "@/generated/prisma/enums";
import {
  getAdminMarket,
  listAdminStartups,
  listOrganizationNames,
  MARKET_STATUS_TRANSITIONS,
  termsAreEditable,
} from "@/lib/admin";
import { requireAdminPage } from "@/lib/auth";
import { listResolutionProposals } from "@/lib/resolutions";
import { changeMarketStatusAction, updateMarketAction } from "../../actions";
import { ActionForm } from "../../_components/action-form";
import { Badge, formatUtc, PageHeader, percent, Section } from "../../_components/ui";
import { MarketForm } from "../market-form";
import { ResolutionPanel } from "./resolution-panel";

const statusVerb: Partial<Record<MarketStatus, string>> = {
  OPEN: "Open for forecasts",
  CLOSED: "Close forecasting",
  CANCELLED: "Cancel market",
};

export default async function AdminMarketPage({ params }: PageProps<"/admin/markets/[id]">) {
  const { id } = await params;
  const admin = await requireAdminPage(`/admin/markets/${id}`);
  const [market, startups, organizations, proposals] = await Promise.all([
    getAdminMarket(admin, id),
    listAdminStartups(admin),
    listOrganizationNames(admin),
    listResolutionProposals(admin, { marketId: id }),
  ]);

  const totalCredits = market.yesCredits + market.noCredits;
  // Cancelling a market with forecasts goes through a VOID resolution so stakes get refunded.
  const transitions = MARKET_STATUS_TRANSITIONS[market.status].filter(
    (to) => to !== MarketStatus.CANCELLED || market.forecastCount === 0,
  );

  return (
    <>
      <PageHeader title={market.question} />
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <Badge>{market.status}</Badge>
        <span>{market.startup.name}</span>
        <span>{market.visibility.toLowerCase()}{market.organization ? ` · ${market.organization.name}` : ""}</span>
        <span>Deadline {formatUtc(market.closesAt)}</span>
      </div>

      <Section title="Numbers">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-zinc-500">Opening baseline</dt>
            <dd className="text-lg font-medium">
              {market.openingBaseline != null ? percent(market.openingBaseline) : "Not set"}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Community allocation (YES share of credits)</dt>
            <dd className="text-lg font-medium">{totalCredits > 0 ? percent(market.yesCredits / totalCredits) : "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Credits allocated</dt>
            <dd className="text-lg font-medium tabular-nums">{totalCredits.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Forecasts</dt>
            <dd className="text-lg font-medium tabular-nums">{market.forecastCount}</dd>
          </div>
        </dl>
      </Section>

      <ResolutionPanel market={market} resolution={market.resolution} proposals={proposals} viewer={admin} />

      {transitions.length > 0 && (
        <Section title="Status">
          <div className="flex flex-wrap gap-6">
            {transitions.map((to) => (
              <ActionForm
                key={to}
                action={changeMarketStatusAction.bind(null, market.id)}
                submitLabel={statusVerb[to] ?? to}
                tone={to === MarketStatus.CANCELLED ? "danger" : "default"}
              >
                <input type="hidden" name="status" value={to} />
              </ActionForm>
            ))}
          </div>
        </Section>
      )}

      {market.status !== MarketStatus.RESOLVED && market.status !== MarketStatus.CANCELLED && (
        <Section title="Edit">
          <MarketForm
            action={updateMarketAction.bind(null, market.id)}
            market={market}
            startups={startups}
            organizations={organizations}
            termsLocked={!termsAreEditable(market)}
            submitLabel="Save changes"
          />
        </Section>
      )}

      <p className="text-xs text-zinc-500">
        Created {formatUtc(market.createdAt)} · id <code>{market.id}</code>
      </p>
    </>
  );
}
