import Link from "next/link";
import { io } from "next/cache";
import { ArrowRight } from "lucide-react";
import { MarketCard } from "@/components/MarketCard";
import { NewsFeed } from "@/components/NewsFeed";
import { StartupCard } from "@/components/StartupCard";
import { AllocationBar } from "@/components/ui/AllocationBar";
import { SignInCta } from "@/components/ui/AuthControls";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CardGridSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { listFeaturedStartups } from "@/lib/discovery/queries";
import { formatDeadline, formatShare } from "@/lib/market-view/format";
import { getPublicCounts, listFeaturedMarkets } from "@/lib/market-view/queries";
import { safe } from "@/lib/market-view/safe";
import { listNews } from "@/lib/news/queries";
import { PageTransition, StreamIn } from "@/components/ui/Transitions";

const steps = [
  { title: "Pick a question", body: "Every market asks a measurable YES or NO question about a startup milestone." },
  { title: "Allocate credits", body: "Place virtual credits on the outcome you expect. No real money involved." },
  {
    title: "Track the outcome",
    body: "Follow community movement and see results once verified evidence settles each market.",
  },
];

const measures = [
  {
    name: "Opening baseline",
    body: "The starting estimate set when a market opens, with its method.",
    swatch: "border-t-2 border-dashed border-ink-500",
  },
  {
    name: "YES allocation",
    body: "Share of credits on YES. Not a probability.",
    swatch: "h-1.5 rounded-full bg-red-500",
  },
  {
    name: "Calibrated probability",
    body: "Model estimate from forecasting accuracy, when available.",
    swatch: "h-0.5 rounded-full bg-ink-900",
  },
  { name: "Outcome", body: "The verified result, recorded with evidence.", swatch: "h-1.5 rounded-full bg-ink-300" },
];

export default function HomePage() {
  return (
    <PageTransition>
      <main id="main" className="flex-1">
        <section className="relative overflow-hidden bg-night text-white">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_top_right,black_20%,transparent_70%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-red-500/20 blur-3xl"
          />
          <Container className="relative grid items-center gap-12 py-20 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <h1 className="text-4xl font-extrabold leading-[1.05] sm:text-6xl">
                Forecast what startups do <span className="text-red-500">next.</span>
              </h1>
              <p className="mt-5 max-w-lg text-lg text-mist-300">
                Allocate virtual credits on measurable startup milestones and see where the community stands.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/markets" variant="accent" size="lg">
                  Explore markets <ArrowRight className="size-4" aria-hidden />
                </ButtonLink>
                <SignInCta variant="inverse">Sign in</SignInCta>
              </div>
              <StreamIn fallback={<div className="mt-10 h-14" />}>
                <HeroStats />
              </StreamIn>
            </div>
            <StreamIn fallback={<Skeleton className="hidden h-64 rounded-2xl bg-white/5 lg:block" />}>
              <Spotlight />
            </StreamIn>
          </Container>
        </section>

        <Container className="py-16 sm:py-20">
          <SectionHeading eyebrow="Live" title="Open markets" href="/markets" />
          <StreamIn fallback={<CardGridSkeleton count={6} />}>
            <OpenMarkets />
          </StreamIn>
        </Container>

        <section className="border-y border-ink-200 bg-ink-50">
          <Container className="grid gap-12 py-16 sm:py-20 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="How it works" title="Three steps" />
              <ol className="space-y-6">
                {steps.map((step, index) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="font-display text-3xl font-extrabold leading-none text-red-500 tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="font-display font-semibold text-ink-900">{step.title}</h3>
                      <p className="mt-1 text-sm text-ink-600">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <SectionHeading eyebrow="Reading the numbers" title="What each figure means" />
              <ul className="grid gap-3 sm:grid-cols-2">
                {measures.map((measure) => (
                  <li key={measure.name} className="rounded-[var(--radius-card)] border border-ink-200 bg-surface p-5">
                    <span aria-hidden className={`block w-8 ${measure.swatch}`} />
                    <h3 className="mt-3 font-display font-semibold text-ink-900">{measure.name}</h3>
                    <p className="mt-1 text-sm text-ink-600">{measure.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </Container>
        </section>

        <Container className="grid gap-16 py-16 sm:py-20 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <SectionHeading title="Startups" href="/startups" />
            <StreamIn fallback={<CardGridSkeleton count={4} variant="startup" className="lg:grid-cols-2" />}>
              <FeaturedStartups />
            </StreamIn>
          </div>
          <div>
            <SectionHeading title="News" />
            <StreamIn fallback={<Skeleton className="h-96 rounded-[var(--radius-card)]" />}>
              <LatestNews />
            </StreamIn>
          </div>
        </Container>

        <Container>
          <div className="relative overflow-hidden rounded-3xl bg-night px-6 py-12 text-center text-white sm:px-12">
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-24 left-1/2 h-48 w-2/3 -translate-x-1/2 rounded-full bg-red-500/25 blur-3xl"
            />
            <h2 className="relative text-3xl font-bold sm:text-4xl">Start forecasting</h2>
            <p className="relative mx-auto mt-3 max-w-md text-mist-300">Every account starts with virtual credits.</p>
            <div className="relative mt-6">
              <SignInCta
                signedIn={
                  <ButtonLink href="/markets" variant="accent" size="lg">
                    Explore markets
                  </ButtonLink>
                }
              >
                Sign in
              </SignInCta>
            </div>
          </div>
        </Container>
      </main>
    </PageTransition>
  );
}

async function HeroStats() {
  await io();
  const counts = await safe(getPublicCounts);
  if (!counts.data) return null;
  return (
    <dl className="mt-10 flex gap-10">
      <div>
        <dt className="text-xs text-mist-400">Open markets</dt>
        <dd className="font-display text-2xl font-bold tabular-nums">{counts.data.openMarkets}</dd>
      </div>
      <div>
        <dt className="text-xs text-mist-400">Startups tracked</dt>
        <dd className="font-display text-2xl font-bold tabular-nums">{counts.data.startups}</dd>
      </div>
    </dl>
  );
}

async function Spotlight() {
  await io();
  const markets = await safe(() => listFeaturedMarkets(1));
  const market = markets.data?.[0];
  if (!market) return null;

  return (
    <Link
      href={`/markets/${market.slug}`}
      className="group block rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur transition-colors hover:border-white/20 hover:bg-white/[0.07]"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-500">Most active</p>
      <p className="mt-1 text-sm text-mist-300">{market.startup.name}</p>
      <p className="mt-3 font-display text-xl font-semibold leading-snug">{market.question}</p>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <p className="font-display text-4xl font-bold tabular-nums">{formatShare(market.allocation.share)}</p>
          <p className="text-xs text-mist-400">YES allocation</p>
        </div>
        {market.openingBaseline !== null && (
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums text-mist-200">{formatShare(market.openingBaseline)}</p>
            <p className="text-xs text-mist-400">Baseline</p>
          </div>
        )}
      </div>
      <AllocationBar share={market.allocation.share} baseline={market.openingBaseline} tone="dark" className="mt-3" />
      <p className="mt-4 text-xs text-mist-400">
        {formatDeadline(market.closesAt)} · {market.allocation.forecastCount} forecasts
      </p>
    </Link>
  );
}

async function OpenMarkets() {
  await io();
  const markets = await safe(() => listFeaturedMarkets(6));
  if (markets.failed) return <ErrorState body="Markets could not load. Try again shortly." />;
  if (markets.data.length === 0) {
    return <EmptyState title="No open markets yet" body="New questions appear here as soon as they open." />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {markets.data.map((market) => (
        <MarketCard key={market.id} market={market} />
      ))}
    </div>
  );
}

async function FeaturedStartups() {
  await io();
  const startups = await safe(() => listFeaturedStartups(4));
  if (startups.failed) return <ErrorState body="Startups could not load. Try again shortly." />;
  if (startups.data.length === 0) return <EmptyState title="No startups yet" />;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {startups.data.map((startup) => (
        <StartupCard key={startup.slug} startup={startup} />
      ))}
    </div>
  );
}

async function LatestNews() {
  await io();
  const news = await safe(() => listNews({ limit: 5 }));
  if (news.failed) return <ErrorState body="News could not load. Try again shortly." />;
  return <NewsFeed items={news.data} />;
}
