import type { Metadata } from "next";
import { io } from "next/cache";
import { Search } from "lucide-react";
import { MarketCard } from "@/components/MarketCard";
import { StartupCard } from "@/components/StartupCard";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input, Label } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CardGridSkeleton } from "@/components/ui/Skeleton";
import { parseSearchQuery } from "@/lib/discovery/params";
import { searchAll } from "@/lib/discovery/queries";
import { PageTransition, StreamIn } from "@/components/ui/Transitions";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <PageTransition>
      <main id="main" className="flex-1">
        <PageHeader title="Search">
          <StreamIn fallback={<SearchForm />}>
            <RoutedSearchForm searchParams={searchParams} />
          </StreamIn>
        </PageHeader>
        <Container className="space-y-14 py-10">
          <StreamIn fallback={<CardGridSkeleton count={3} />}>
            <Results searchParams={searchParams} />
          </StreamIn>
        </Container>
      </main>
    </PageTransition>
  );
}

function SearchForm({ q }: { q?: string }) {
  return (
    <form action="/search" method="get" role="search" className="flex gap-3">
      <div className="relative flex-1">
        <Label htmlFor="q" className="sr-only">
          Search markets and startups
        </Label>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-500"
          aria-hidden
        />
        <Input
          id="q"
          name="q"
          type="search"
          placeholder="Markets and startups"
          defaultValue={q}
          className="h-12 rounded-full pl-11 text-base"
        />
      </div>
      <Button type="submit" size="lg">
        Search
      </Button>
    </form>
  );
}

async function RoutedSearchForm({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  return <SearchForm q={parseSearchQuery(await searchParams)} />;
}

async function Results({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  const q = parseSearchQuery(await searchParams);
  if (!q) return <EmptyState illustration="search" title="Search markets and startups" body="Try a company name, industry, or milestone." />;

  await io();
  const results = await searchAll(q);
  if (results.markets.length === 0 && results.startups.length === 0) {
    return <EmptyState illustration="search" title={`No results for "${q}"`} body="Try a different word or check the spelling." />;
  }

  return (
    <>
      {results.markets.length > 0 && (
        <section>
          <SectionHeading
            title="Markets"
            href={`/markets?q=${encodeURIComponent(q)}`}
            linkLabel="All matching markets"
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.markets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        </section>
      )}
      {results.startups.length > 0 && (
        <section>
          <SectionHeading
            title="Startups"
            href={`/startups?q=${encodeURIComponent(q)}`}
            linkLabel="All matching startups"
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.startups.map((startup) => (
              <StartupCard key={startup.slug} startup={startup} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
