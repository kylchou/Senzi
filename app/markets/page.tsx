import type { Metadata } from "next";
import { Suspense } from "react";
import { io } from "next/cache";
import { Search } from "lucide-react";
import { MarketCard } from "@/components/MarketCard";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input, Label, Select } from "@/components/ui/Field";
import { FilterForm } from "@/components/ui/FilterForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { parseMarketParams } from "@/lib/discovery/params";
import { listSectors } from "@/lib/discovery/queries";
import { listMarkets } from "@/lib/market-view/queries";

export const metadata: Metadata = { title: "Markets" };

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
    <main id="main" className="flex-1">
      <PageHeader title="Markets" subtitle="YES or NO questions on measurable startup milestones.">
        <Suspense fallback={<Skeleton className="h-10 w-full" />}>
          <Filters searchParams={searchParams} />
        </Suspense>
      </PageHeader>
      <Container className="py-10">
        <Suspense fallback={<ResultsSkeleton />}>
          <Results searchParams={searchParams} />
        </Suspense>
      </Container>
    </main>
  );
}

async function Filters({ searchParams }: Pick<PageProps<"/markets">, "searchParams">) {
  const params = parseMarketParams(await searchParams);
  const sectors = await listSectors();

  return (
    <FilterForm action="/markets">
      <div className="relative flex-1">
        <Label htmlFor="q" className="sr-only">
          Search markets
        </Label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" aria-hidden />
        <Input id="q" name="q" type="search" placeholder="Search questions or startups" defaultValue={params.q} className="pl-9" />
      </div>
      <div className="grid grid-cols-3 gap-3 sm:flex">
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={params.status ?? ""}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sector">Sector</Label>
          <Select id="sector" name="sector" defaultValue={params.sector ?? ""}>
            <option value="">All</option>
            {sectors.map((sector) => (
              <option key={sector} value={sector}>
                {sector}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sort">Sort</Label>
          <Select id="sort" name="sort" defaultValue={params.sort}>
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <Button type="submit" className="sm:self-end">
        Search
      </Button>
    </FilterForm>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/markets">, "searchParams">) {
  const params = parseMarketParams(await searchParams);
  await io();
  const result = await listMarkets(params);
  const filtered = Boolean(params.q || params.status || params.sector);

  return (
    <>
      <p className="mb-5 text-sm text-ink-600" aria-live="polite">
        {result.total} {result.total === 1 ? "market" : "markets"}
      </p>
      {result.items.length === 0 ? (
        <EmptyState
          title={filtered ? "No matching markets" : "No markets yet"}
          body={filtered ? "Try a different search or filter." : "New questions appear here as soon as they open."}
          action={
            filtered ? (
              <ButtonLink href="/markets" variant="outline" size="sm">
                Clear filters
              </ButtonLink>
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
          sector: params.sector,
          sort: params.sort === "closing" ? undefined : params.sort,
        }}
        isFirstPage={!params.cursor}
        nextCursor={result.nextCursor}
      />
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-60 rounded-[var(--radius-card)]" />
      ))}
    </div>
  );
}
