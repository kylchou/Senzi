import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { io } from "next/cache";
import { BadgeCheck, ChevronRight, MapPin } from "lucide-react";
import { MarketCard } from "@/components/MarketCard";
import { NewsFeed } from "@/components/NewsFeed";
import { Badge } from "@/components/ui/Badge";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExternalLink } from "@/components/ui/ExternalLink";
import { Skeleton } from "@/components/ui/Skeleton";
import { StartupMark } from "@/components/ui/StartupMark";
import { getStartupProfile } from "@/lib/discovery/queries";
import { formatDate, formatStage } from "@/lib/market-view/format";

export async function generateMetadata({ params }: PageProps<"/startups/[slug]">): Promise<Metadata> {
  const startup = await getStartupProfile((await params).slug).catch(() => null);
  return { title: startup?.name ?? "Startup" };
}

export default function StartupPage({ params }: PageProps<"/startups/[slug]">) {
  return (
    <main id="main" className="flex-1">
      <Suspense fallback={<ProfileSkeleton />}>
        <StartupView params={params} />
      </Suspense>
    </main>
  );
}

async function StartupView({ params }: Pick<PageProps<"/startups/[slug]">, "params">) {
  const { slug } = await params;
  await io();
  const startup = await getStartupProfile(slug);
  if (!startup) notFound();

  const open = startup.markets.filter((market) => market.status === "OPEN");
  const past = startup.markets.filter((market) => market.status !== "OPEN");
  const details = [
    { label: "Industry", value: startup.industry },
    { label: "Stage", value: formatStage(startup.stage) },
    { label: "Founded", value: startup.foundedYear?.toString() },
    { label: "Headquarters", value: startup.headquarters },
  ].filter((detail): detail is { label: string; value: string } => Boolean(detail.value));

  return (
    <>
      <div className="border-b border-ink-200 bg-ink-50">
        <Container className="py-8 sm:py-10">
          <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1 text-sm text-ink-500">
            <Link href="/startups" className="hover:text-ink-900">
              Startups
            </Link>
            <ChevronRight className="size-3.5" aria-hidden />
            <span className="truncate text-ink-700">{startup.name}</span>
          </nav>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <StartupMark name={startup.name} logoUrl={startup.logoUrl} size="lg" />
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">{startup.name}</h1>
              <p className="mt-1 text-ink-700">{startup.tagline}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-600">
                <Badge>{startup.industry}</Badge>
                <span>{formatStage(startup.stage)}</span>
                {startup.headquarters && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden />
                    {startup.headquarters}
                  </span>
                )}
                {startup.websiteUrl && <ExternalLink href={startup.websiteUrl}>Website</ExternalLink>}
              </div>
            </div>
          </div>
        </Container>
      </div>

      <Container className="grid gap-12 py-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-12">
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="mb-3 font-display text-xl font-bold text-ink-900">
              About
            </h2>
            <p className="whitespace-pre-line leading-relaxed text-ink-700">{startup.description}</p>
          </section>

          <section aria-labelledby="open-heading">
            <h2 id="open-heading" className="mb-4 font-display text-xl font-bold text-ink-900">
              Open markets
            </h2>
            {open.length === 0 ? (
              <EmptyState title="No open markets" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {open.map((market) => (
                  <MarketCard key={market.id} market={market} />
                ))}
              </div>
            )}
          </section>

          {past.length > 0 && (
            <section aria-labelledby="past-heading">
              <h2 id="past-heading" className="mb-4 font-display text-xl font-bold text-ink-900">
                Forecast history
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {past.map((market) => (
                  <MarketCard key={market.id} market={market} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-12">
          <section aria-labelledby="details-heading">
            <h2 id="details-heading" className="mb-4 font-display text-xl font-bold text-ink-900">
              Details
            </h2>
            <dl className="divide-y divide-ink-100 rounded-[var(--radius-card)] border border-ink-200 bg-surface">
              {details.map((detail) => (
                <div key={detail.label} className="flex justify-between gap-4 px-5 py-3.5 text-sm">
                  <dt className="text-ink-600">{detail.label}</dt>
                  <dd className="text-right font-semibold text-ink-900">{detail.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="facts-heading">
            <h2 id="facts-heading" className="mb-1 font-display text-xl font-bold text-ink-900">
              Public information
            </h2>
            <p className="mb-4 text-xs text-ink-500">Each item links to its source.</p>
            {startup.facts.length === 0 ? (
              <EmptyState title="No sourced information yet" />
            ) : (
              <dl className="divide-y divide-ink-100 rounded-[var(--radius-card)] border border-ink-200 bg-surface">
                {startup.facts.map((fact) => (
                  <div key={`${fact.label}-${fact.sourceUrl}`} className="px-5 py-4">
                    <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
                      {fact.label}
                      {fact.verified ? (
                        <span className="inline-flex items-center gap-0.5 text-red-700">
                          <BadgeCheck className="size-3.5" aria-hidden />
                          Verified
                        </span>
                      ) : (
                        <span className="text-ink-500">Reported</span>
                      )}
                    </dt>
                    <dd className="mt-0.5 font-semibold text-ink-900">{fact.value}</dd>
                    <dd className="mt-1 text-xs text-ink-500">
                      <ExternalLink href={fact.sourceUrl} className="font-normal text-ink-600">
                        {fact.sourceName}
                      </ExternalLink>{" "}
                      · as of {formatDate(fact.asOf)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section aria-labelledby="news-heading">
            <h2 id="news-heading" className="mb-4 font-display text-xl font-bold text-ink-900">
              News
            </h2>
            <NewsFeed items={startup.news} showStartup={false} />
          </section>
        </div>
      </Container>
    </>
  );
}

function ProfileSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="border-b border-ink-200 bg-ink-50">
        <Container className="space-y-4 py-12">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-16 w-80" />
        </Container>
      </div>
      <Container className="grid gap-12 py-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-96 rounded-[var(--radius-card)]" />
        <Skeleton className="h-64 rounded-[var(--radius-card)]" />
      </Container>
    </div>
  );
}
