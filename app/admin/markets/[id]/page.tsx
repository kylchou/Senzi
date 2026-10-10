import { MarketStatus, ResolutionOutcome } from "@/generated/prisma/enums";
import {
  getAdminMarket,
  listAdminStartups,
  listOrganizationNames,
  MARKET_STATUS_TRANSITIONS,
  termsAreEditable,
} from "@/lib/admin";
import { requireAdminPage } from "@/lib/auth";
import { changeMarketStatusAction, resolveMarketAction, updateMarketAction } from "../../actions";
import { ActionForm } from "../../_components/action-form";
import { Badge, formatUtc, PageHeader, percent, Section, Select, TextArea } from "../../_components/ui";
import { MarketForm } from "../market-form";

const statusVerb: Partial<Record<MarketStatus, string>> = {
  OPEN: "Open for forecasts",
  CLOSED: "Close forecasting",
  CANCELLED: "Cancel market",
};

export default async function AdminMarketPage({ params }: PageProps<"/admin/markets/[id]">) {
  const { id } = await params;
  const admin = await requireAdminPage(`/admin/markets/${id}`);
  const [market, startups, organizations] = await Promise.all([
    getAdminMarket(admin, id),
    listAdminStartups(admin),
    listOrganizationNames(admin),
  ]);

  const totalCredits = market.yesCredits + market.noCredits;
  const resolvable = market.status === MarketStatus.OPEN || market.status === MarketStatus.CLOSED;
  // Cancelling a market with forecasts goes through resolution so stakes get refunded.
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
            <dd className="text-lg font-medium">{percent(market.openingBaseline)}</dd>
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

      {market.resolution && (
        <Section title="Resolution">
          <div className="space-y-2 text-sm">
            <p>
              Outcome <strong>{market.resolution.outcome}</strong> · recorded {formatUtc(market.resolution.resolvedAt)}
              {market.resolution.resolvedBy ? ` by ${market.resolution.resolvedBy.displayName}` : ""} · settlement{" "}
              <Badge>{market.resolution.settlementStatus}</Badge>
            </p>
            <p className="whitespace-pre-wrap">{market.resolution.evidenceSummary}</p>
            <ul className="list-disc pl-5">
              {market.resolution.evidenceUrls.map((url) => (
                <li key={url}>
                  <a className="underline" href={url} target="_blank" rel="noreferrer noopener">{url}</a>
                </li>
              ))}
            </ul>
            {market.resolution.settlementError && (
              <p className="text-rose-700">Settlement error: {market.resolution.settlementError}</p>
            )}
          </div>
        </Section>
      )}

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

      {resolvable && (
        <Section title="Resolve">
          <ActionForm action={resolveMarketAction.bind(null, market.id)} submitLabel="Record resolution" tone="danger">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Criteria: <span className="whitespace-pre-wrap">{market.resolutionCriteria}</span>
            </p>
            <Select
              label="Outcome"
              name="outcome"
              options={Object.values(ResolutionOutcome).map((o) => ({ value: o, label: o }))}
            />
            <TextArea label="Evidence summary" name="evidenceSummary" required hint="How the evidence meets (or fails) the criteria." />
            <TextArea label="Evidence links" name="evidenceUrls" required rows={3} hint="One URL per line." />
            <p className="text-xs text-zinc-500">This can’t be undone. Credit settlement then runs as a separate step (status shows above).</p>
          </ActionForm>
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
