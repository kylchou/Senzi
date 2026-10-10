import type { Metadata } from "next";
import { io } from "next/cache";
import { NewsFeed } from "@/components/NewsFeed";
import { buttonStyles } from "@/components/ui/Button";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { Label, Select } from "@/components/ui/Field";
import { ClearFiltersLink, FilterForm } from "@/components/ui/FilterForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageTransition, StreamIn } from "@/components/ui/Transitions";
import { parseNewsParams, type NewsQuery } from "@/lib/discovery/params";
import { listIndustries } from "@/lib/discovery/queries";
import { formatDate } from "@/lib/market-view/format";
import type { NewsItemView } from "@/lib/market-view/types";
import { listNewsPage } from "@/lib/news/queries";

export const metadata: Metadata = {
  title: "News",
  description: "Sourced coverage of startups on Senzi, labeled verified or reported.",
};

const verificationOptions = [
  { value: "", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "reported", label: "Reported" },
];

export default function NewsPage({ searchParams }: PageProps<"/news">) {
  return (
    <PageTransition>
      <main id="main" className="flex-1">
        <PageHeader
          title="News"
          subtitle="Sourced coverage of startups on Senzi. Verified items were checked against the source."
        >
          <StreamIn fallback={<FiltersView params={parseNewsParams({})} industries={[]} />}>
            <Filters searchParams={searchParams} />
          </StreamIn>
        </PageHeader>
        <Container className="max-w-3xl py-10">
          <StreamIn fallback={<Skeleton className="h-96 rounded-[var(--radius-card)]" />}>
            <Results searchParams={searchParams} />
          </StreamIn>
        </Container>
      </main>
    </PageTransition>
  );
}

async function Filters({ searchParams }: Pick<PageProps<"/news">, "searchParams">) {
  const params = parseNewsParams(await searchParams);
  const industries = await listIndustries();
  return <FiltersView params={params} industries={industries} />;
}

/** The filter form. Also rendered with defaults while loading, so the page does not shift. */
function FiltersView({ params, industries }: { params: NewsQuery; industries: string[] }) {
  return (
    <FilterForm action="/news" className="sm:items-center">
      <ChipGroup
        name="verification"
        label="Verification"
        options={verificationOptions}
        value={params.verification ?? ""}
      />
      <div className="flex items-center gap-2 sm:ml-auto">
        <Label htmlFor="industry" className="shrink-0">
          Industry
        </Label>
        <Select id="industry" name="industry" defaultValue={params.industry ?? ""} className="rounded-full sm:w-48">
          <option value="">All</option>
          {industries.map((industry) => (
            <option key={industry} value={industry}>
              {industry}
            </option>
          ))}
        </Select>
      </div>
    </FilterForm>
  );
}

/** Groups items by publication day, newest first. */
function byDay(items: NewsItemView[]): [string, NewsItemView[]][] {
  const groups = new Map<string, NewsItemView[]>();
  for (const item of items) {
    const day = formatDate(item.publishedAt);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return [...groups.entries()];
}

async function Results({ searchParams }: Pick<PageProps<"/news">, "searchParams">) {
  const params = parseNewsParams(await searchParams);
  await io();
  const page = await listNewsPage(params);
  const filtered = Boolean(params.verification || params.industry);

  if (page.items.length === 0) {
    return (
      <EmptyState
        illustration="news"
        title={filtered ? "No matching news" : "No news yet"}
        body={filtered ? "Try a different filter." : "Sourced coverage appears here once published."}
        action={
          filtered ? (
            <ClearFiltersLink path="/news" className={buttonStyles({ variant: "outline", size: "sm" })}>
              Clear filters
            </ClearFiltersLink>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <p className="mb-6 text-sm text-ink-600" aria-live="polite">
        {page.total} {page.total === 1 ? "story" : "stories"}
      </p>
      <div className="space-y-8">
        {byDay(page.items).map(([day, items]) => (
          <section key={day} aria-label={day}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{day}</h2>
            <NewsFeed items={items} />
          </section>
        ))}
      </div>
      <Pagination
        basePath="/news"
        params={{ verification: params.verification, industry: params.industry }}
        isFirstPage={!params.cursor}
        nextCursor={page.nextCursor}
      />
    </>
  );
}
