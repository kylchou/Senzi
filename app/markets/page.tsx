import type { Metadata } from "next";
import { io } from "next/cache";
import { Search } from "lucide-react";
import { MarketCard } from "@/components/MarketCard";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input, Label, Select } from "@/components/ui/Field";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { ClearFiltersLink, FilterForm } from "@/components/ui/FilterForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { CardGridSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { parseMarketParams } from "@/lib/discovery/params";
import { listIndustries } from "@/lib/discovery/queries";
import { listMarkets } from "@/lib/market-view/queries";
import { PageTransition, StreamIn } from "@/components/ui/Transitions";

export const metadata: Metadata = {
  title: "Markets",
  description: "YES or NO questions on measurable startup milestones, with community allocation shares, opening baselines, and deadlines.",
};

const statusOptions = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "CLOSED", label: "Closed" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CANCELLED", label: "Cancelled" },
];

const sortOptions = [
  { value: "closing", label: "Closing soon" },
  { value: "active", label: "Most forecasts" },
  { value: "newest", label: "Newest" },
];

export default function MarketsPage({ searchParams }: PageProps<"/markets">) {
  return (
    <PageTransition>
      <main id="main" className="flex-1">
        <PageHeader title="Markets" subtitle="YES or NO questions on measurable startup milestones.">
          <StreamIn fallback={<Skeleton className="h-10 w-full" />}>
            <Filters searchParams={searchParams} />
          </StreamIn>
        </PageHeader>
        <Container className="py-10">
          <StreamIn fallback={<CardGridSkeleton count={6} />}>
            <Results searchParams={searchParams} />
          </StreamIn>
        </Container>
      </main>
    </PageTransition>
  );
}

async function Filters({ searchParams }: Pick<PageProps<"/markets">, "searchParams">) {
  const params = parseMarketParams(await searchParams);
  const industries = await listIndustries();

  return (
    <FilterForm action="/markets" className="sm:flex-col sm:items-stretch">
      <ChipGroup name="status" label="Status" options={statusOptions} value={params.status ?? ""} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Label htmlFor="q" className="sr-only">
            Search markets
          </Label>
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-500"
            aria-hidden
          />
          <Input
            id="q"
            name="q"
            type="search"
            placeholder="Search questions or startups"
            defaultValue={params.q}
            className="h-11 rounded-full pl-10"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <Label htmlFor="industry" className="sr-only">
            Industry
          </Label>
          <Select
            id="industry"
            name="industry"
            defaultValue={params.industry ?? ""}
            className="h-11 rounded-full sm:w-44"
          >
            <option value="">All industries</option>
            {industries.map((industry) => (
              <option key={industry} value={industry}>
                {industry}
              </option>
            ))}
          </Select>
          <Label htmlFor="sort" className="sr-only">
            Sort
          </Label>
          <Select id="sort" name="sort" defaultValue={params.sort} className="h-11 rounded-full sm:w-44">
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" size="lg" className="h-11">
          Search
        </Button>
      </div>
    </FilterForm>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/markets">, "searchParams">) {
  const params = parseMarketParams(await searchParams);
  await io();
  const result = await listMarkets(params);
  const filtered = Boolean(params.q || params.status || params.industry);

  return (
    <>
      <p className="mb-5 text-sm text-ink-600" aria-live="polite">
        {result.total} {result.total === 1 ? "market" : "markets"}
      </p>
      {result.items.length === 0 ? (
        <EmptyState
          illustration="markets"
          title={filtered ? "No matching markets" : "No markets yet"}
          body={filtered ? "Try a different search or filter." : "New questions appear here as soon as they open."}
          action={
            filtered ? (
              <ClearFiltersLink path="/markets" className={buttonStyles({ variant: "outline", size: "sm" })}>
                Clear filters
              </ClearFiltersLink>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}
      <Pagination
        basePath="/markets"
        params={{
          q: params.q,
          status: params.status,
          industry: params.industry,
          sort: params.sort === "closing" ? undefined : params.sort,
        }}
        isFirstPage={!params.cursor}
        nextCursor={result.nextCursor}
      />
    </>
  );
}
