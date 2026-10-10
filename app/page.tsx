import { io } from "next/cache";
import { ArrowRight } from "lucide-react";
import { MarketCard } from "@/components/MarketCard";
import { NewsFeed } from "@/components/NewsFeed";
import { StartupCard } from "@/components/StartupCard";
import { HowItWorksTutorial } from "@/components/tutorial/HowItWorksTutorial";
import { BiggestMoves } from "@/components/ui/BiggestMoves";
import { HeroGreeting } from "@/components/ui/HeroGreeting";
import { SignInCta } from "@/components/ui/AuthControls";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Secondary } from "@/components/ui/a11y/Secondary";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CardGridSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { listFeaturedStartups } from "@/lib/discovery/queries";
import { requestTime } from "@/lib/market-view/format";
import { getPublicCounts, listBiggestMoves, listFeaturedMarkets } from "@/lib/market-view/queries";
import { safe } from "@/lib/market-view/safe";
import { listNews } from "@/lib/news/queries";
import { PageTransition, StreamIn } from "@/components/ui/Transitions";

export default function HomePage() {
  return (
    <PageTransition>
      <main id="main" className="flex-1">
        {/* Sits on the page itself (no framed card) and follows the light or dark theme. */}
        <section
          id="top"
          data-focus-plain=""
          className="relative scroll-mt-6 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,color-mix(in_srgb,var(--color-red-500)_6%,transparent),transparent)]"
        >
          <Container className="flex flex-col items-center pb-14 pt-20 text-center sm:pb-20 sm:pt-28">
            <HeroGreeting />
            <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] text-ink-900 sm:text-6xl motion-safe:animate-[home-rise_900ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
              Forecast what startups do <span className="text-red-500">next.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-ink-600 sm:text-lg motion-safe:animate-[home-rise_900ms_120ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
              Allocate virtual credits on measurable startup milestones and see where the community stands. No real
              money, ever.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 motion-safe:animate-[home-rise_900ms_220ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
              <ButtonLink href="/markets" variant="accent" size="lg">
                Explore markets <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="/#tutorial" variant="outline" size="lg">
                How it works
              </ButtonLink>
            </div>
            <StreamIn fallback={<div className="mt-8 h-5" />}>
              <HeroStats />
            </StreamIn>
          </Container>
        </section>

        <Container id="explore" className="home-reveal scroll-mt-6 pb-16 pt-4 sm:pb-20">
          <SectionHeading title="Open markets" href="/markets" />
          <StreamIn fallback={<CardGridSkeleton count={6} />}>
            <OpenMarkets />
          </StreamIn>
        </Container>

        <StreamIn fallback={null}>
          <Moves />
        </StreamIn>

        <section id="how-it-works" className="scroll-mt-6">
          <Container className="py-16 sm:py-20">
            <div className="home-reveal mx-auto mb-10 max-w-2xl text-center">
              <h2 className="text-3xl font-bold text-ink-900 sm:text-4xl">How it works</h2>
              <p className="mt-3 text-ink-600">
                Forecast on a practice market, step by step. Nothing touches your account.
              </p>
            </div>
            <HowItWorksTutorial />
          </Container>
        </section>

        <Container id="startups" className="scroll-mt-6">
          <Secondary label="startups and news" className="py-8" bodyClassName="home-reveal grid gap-16 py-8 sm:py-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <SectionHeading title="Startups" href="/startups" />
            <StreamIn fallback={<CardGridSkeleton count={4} variant="startup" className="lg:grid-cols-2" />}>
              <FeaturedStartups />
            </StreamIn>
          </div>
          <div>
            <SectionHeading title="News" href="/news" />
            <StreamIn fallback={<Skeleton className="h-96 rounded-[var(--radius-card)]" />}>
              <LatestNews />
            </StreamIn>
          </div>
          </Secondary>
        </Container>

        <Container className="home-reveal pb-4 pt-12 text-center sm:pt-16">
          <h2 className="text-3xl font-bold text-ink-900 sm:text-4xl">Start forecasting</h2>
          <p className="mx-auto mt-3 max-w-md text-ink-600">Every account starts with virtual credits. They have no cash value.</p>
          <div className="mt-6 flex justify-center">
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
    <p className="mt-8 text-sm text-ink-500 motion-safe:animate-[home-rise_900ms_320ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
      <strong className="font-semibold tabular-nums text-ink-900">{counts.data.openMarkets}</strong> open markets
      <span aria-hidden className="mx-2.5 text-ink-300">·</span>
      <strong className="font-semibold tabular-nums text-ink-900">{counts.data.startups}</strong> startups tracked
    </p>
  );
}

/** Hidden entirely when nothing moved, so the homepage never shows an empty block. */
async function Moves() {
  await io();
  const result = await safe(() => listBiggestMoves(requestTime(), 4));
  if (!result.data || result.data.moves.length === 0) return null;
  return (
    <Container className="pb-16 sm:pb-20">
      <Secondary label="biggest moves">
      <SectionHeading
        title={result.data.days === 7 ? "Biggest moves this week" : "Biggest moves this month"}
        href="/markets?sort=active"
        linkLabel="Most forecasts"
      />
      <BiggestMoves moves={result.data.moves} />
      </Secondary>
    </Container>
  );
}

async function OpenMarkets() {
  await io();
  const markets = await safe(() => listFeaturedMarkets(6));
  if (markets.failed) return <ErrorState body="Markets could not load. Try again shortly." />;
  if (markets.data.length === 0) {
    return (
      <EmptyState
        illustration="markets"
        title="No open markets yet"
        body="New questions appear here as soon as they open."
      />
    );
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
  if (startups.data.length === 0) return <EmptyState illustration="startups" title="No startups yet" />;
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
