import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { io } from "next/cache";
import { CalendarClock, ChevronRight } from "lucide-react";
import { ForecastPanel } from "@/components/ForecastPanel";
import { MarketBrief } from "@/components/MarketBrief";
import { MarketMovement } from "@/components/MarketMovement";
import { NewsFeed } from "@/components/NewsFeed";
import { ProbabilityChart } from "@/components/ProbabilityChart";
import { Container } from "@/components/ui/Container";
import { ExternalLink } from "@/components/ui/ExternalLink";
import { MarketStatusBadge } from "@/components/ui/MarketStatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { StartupMark } from "@/components/ui/StartupMark";
import { shareMovement } from "@/lib/market-view/chart";
import { formatDateTime, formatDeadline, isPastDeadline, requestTime } from "@/lib/market-view/format";
import { getMarket, getMarketHistory } from "@/lib/market-view/queries";

export async function generateMetadata({ params }: PageProps<"/markets/[slug]">): Promise<Metadata> {
  const market = await getMarket((await params).slug).catch(() => null);
  return { title: market?.question ?? "Market" };
}

export default function MarketPage({ params }: PageProps<"/markets/[slug]">) {
  return (
    <main id="main" className="flex-1">
      <Container className="py-8 sm:py-10">
        <Suspense fallback={<MarketSkeleton />}>
          <MarketView params={params} />
        </Suspense>
      </Container>
    </main>
  );
}

async function MarketView({ params }: Pick<PageProps<"/markets/[slug]">, "params">) {
  const { slug } = await params;
  await io();
  const market = await getMarket(slug);
  if (!market) notFound();

  const history = await getMarketHistory(market.id);
  const now = requestTime();
  const isOpen = market.status === "OPEN" && !isPastDeadline(market.closesAt, new Date(now));
  // Closed markets stop the history line at close or resolution instead of today.
  const chartEnd = isOpen ? now : Math.min(now, Date.parse(market.resolvedAt ?? market.closesAt));

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1 text-sm text-ink-500">
        <Link href="/markets" className="hover:text-ink-900">
          Markets
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <Link href={`/startups/${market.startup.slug}`} className="truncate hover:text-ink-900">
          {market.startup.name}
        </Link>
      </nav>

      <header className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/startups/${market.startup.slug}`} className="flex items-center gap-2.5 hover:opacity-80">
            <StartupMark name={market.startup.name} logoUrl={market.startup.logoUrl} size="sm" />
            <span className="text-sm font-semibold text-ink-900">{market.startup.name}</span>
          </Link>
          <span className="text-sm text-ink-500">{market.category ?? market.startup.sector}</span>
          <MarketStatusBadge status={market.status} outcome={market.outcome} closesAt={market.closesAt} />
        </div>
        <h1 className="mt-4 text-3xl font-bold leading-tight text-ink-900 sm:text-4xl">{market.question}</h1>
        {market.description && <p className="mt-3 text-ink-700">{market.description}</p>}
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-ink-600">
          <CalendarClock className="size-4" aria-hidden />
          <span>
            Deadline <time dateTime={market.closesAt}>{formatDateTime(market.closesAt)}</time>
            {isOpen && <span className="text-ink-500"> ({formatDeadline(market.closesAt, new Date(now))})</span>}
          </span>
        </p>
      </header>

      {/* On small screens the forecast panel sits right after the key figures. */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <MarketBrief market={market} />
        </div>

        <aside className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <ForecastPanel marketId={market.id} isOpen={isOpen} />
          <p className="mt-3 px-1 text-xs leading-relaxed text-ink-500">
            Forecasts are research signals, not guarantees or investment advice.
          </p>
        </aside>

        <div className="min-w-0 space-y-8 lg:col-start-1 lg:row-start-2">
          <section aria-labelledby="history-heading" className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 id="history-heading" className="font-display text-lg font-bold text-ink-900">
                Community allocation over time
              </h2>
              <MarketMovement movement={shareMovement(history, 7, chartEnd)} />
            </div>
            <ProbabilityChart history={history} openingBaseline={market.openingBaseline} now={chartEnd} />
          </section>

          <section aria-labelledby="coverage-heading">
            <h2 id="coverage-heading" className="mb-3 font-display text-lg font-bold text-ink-900">
              Sources and coverage
            </h2>
            <NewsFeed items={market.coverage} showStartup={false} emptyTitle="No linked coverage yet" />
          </section>

          <section aria-labelledby="startup-heading" className="rounded-[var(--radius-card)] bg-ink-50 p-5">
            <h2 id="startup-heading" className="font-display text-lg font-bold text-ink-900">
              About {market.startup.name}
            </h2>
            <p className="mt-1 text-sm text-ink-700">{market.startup.tagline}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <Link
                href={`/startups/${market.startup.slug}`}
                className="font-semibold text-ink-900 underline decoration-ink-300 underline-offset-4 hover:decoration-red-500"
              >
                Startup profile
              </Link>
              {market.startup.website && <ExternalLink href={market.startup.website}>Website</ExternalLink>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function MarketSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-8 h-10 w-3/4" />
      <Skeleton className="mt-3 h-5 w-1/2" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-[var(--radius-card)]" />
          <Skeleton className="h-80 rounded-[var(--radius-card)]" />
        </div>
        <Skeleton className="h-96 rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}
