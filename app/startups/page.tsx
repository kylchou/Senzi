import type { Metadata } from "next";
import { Suspense } from "react";
import { io } from "next/cache";
import { Search } from "lucide-react";
import { StartupCard } from "@/components/StartupCard";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input, Label, Select } from "@/components/ui/Field";
import { FilterForm } from "@/components/ui/FilterForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { parseStartupParams } from "@/lib/discovery/params";
import { listSectors, listStartups } from "@/lib/discovery/queries";

export const metadata: Metadata = { title: "Startups" };

export default function StartupsPage({ searchParams }: PageProps<"/startups">) {
  return (
    <main id="main" className="flex-1">
      <PageHeader title="Startups" subtitle="Companies with public markets and sourced coverage.">
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

async function Filters({ searchParams }: Pick<PageProps<"/startups">, "searchParams">) {
  const params = parseStartupParams(await searchParams);
  const sectors = await listSectors();

  return (
    <FilterForm action="/startups">
      <div className="relative flex-1">
        <Label htmlFor="q" className="sr-only">
          Search startups
        </Label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" aria-hidden />
        <Input id="q" name="q" type="search" placeholder="Search by name or sector" defaultValue={params.q} className="pl-9" />
      </div>
      <div className="flex flex-col gap-1 sm:w-56">
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
      <Button type="submit" className="sm:self-end">
        Search
      </Button>
    </FilterForm>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/startups">, "searchParams">) {
  const params = parseStartupParams(await searchParams);
  await io();
  const result = await listStartups(params);
  const filtered = Boolean(params.q || params.sector);

  return (
    <>
      <p className="mb-5 text-sm text-ink-600" aria-live="polite">
        {result.total} {result.total === 1 ? "startup" : "startups"}
      </p>
      {result.items.length === 0 ? (
        <EmptyState
          title={filtered ? "No matching startups" : "No startups yet"}
          body={filtered ? "Try a different search or sector." : undefined}
          action={
            filtered ? (
              <ButtonLink href="/startups" variant="outline" size="sm">
                Clear filters
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((startup) => (
            <StartupCard key={startup.slug} startup={startup} />
          ))}
        </div>
      )}
      <Pagination
        basePath="/startups"
        params={{ q: params.q, sector: params.sector }}
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
        <Skeleton key={index} className="h-44 rounded-[var(--radius-card)]" />
      ))}
    </div>
  );
}
