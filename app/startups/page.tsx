import type { Metadata } from "next";
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
import { CardGridSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { parseStartupParams } from "@/lib/discovery/params";
import { listIndustries, listStartups } from "@/lib/discovery/queries";
import { PageTransition, StreamIn } from "@/components/ui/Transitions";

export const metadata: Metadata = { title: "Startups" };

export default function StartupsPage({ searchParams }: PageProps<"/startups">) {
  return (
    <PageTransition>
      <main id="main" className="flex-1">
        <PageHeader title="Startups" subtitle="Companies with public markets and sourced coverage.">
          <StreamIn fallback={<Skeleton className="h-10 w-full" />}>
            <Filters searchParams={searchParams} />
          </StreamIn>
        </PageHeader>
        <Container className="py-10">
          <StreamIn fallback={<CardGridSkeleton count={6} variant="startup" />}>
            <Results searchParams={searchParams} />
          </StreamIn>
        </Container>
      </main>
    </PageTransition>
  );
}

async function Filters({ searchParams }: Pick<PageProps<"/startups">, "searchParams">) {
  const params = parseStartupParams(await searchParams);
  const industries = await listIndustries();

  return (
    <FilterForm action="/startups">
      <div className="relative flex-1">
        <Label htmlFor="q" className="sr-only">
          Search startups
        </Label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500"
          aria-hidden
        />
        <Input
          id="q"
          name="q"
          type="search"
          placeholder="Search by name or industry"
          defaultValue={params.q}
          className="pl-9"
        />
      </div>
      <div className="flex flex-col gap-1 sm:w-56">
        <Label htmlFor="industry">Industry</Label>
        <Select id="industry" name="industry" defaultValue={params.industry ?? ""}>
          <option value="">All</option>
          {industries.map((industry) => (
            <option key={industry} value={industry}>
              {industry}
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
  const filtered = Boolean(params.q || params.industry);

  return (
    <>
      <p className="mb-5 text-sm text-ink-600" aria-live="polite">
        {result.total} {result.total === 1 ? "startup" : "startups"}
      </p>
      {result.items.length === 0 ? (
        <EmptyState
          illustration="startups"
          title={filtered ? "No matching startups" : "No startups yet"}
          body={filtered ? "Try a different search or industry." : undefined}
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
        params={{ q: params.q, industry: params.industry }}
        isFirstPage={!params.cursor}
        nextCursor={result.nextCursor}
      />
    </>
  );
}
