import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { io } from "next/cache";
import { ArrowRight, Pencil } from "lucide-react";
import { MarketCard } from "@/components/MarketCard";
import { NewsFeed } from "@/components/NewsFeed";
import { StartupCard } from "@/components/StartupCard";
import { HowItWorksTutorial } from "@/components/tutorial/HowItWorksTutorial";
import { AllocationBar } from "@/components/ui/AllocationBar";
import { SignInCta } from "@/components/ui/AuthControls";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { listFeaturedStartups } from "@/lib/discovery/queries";
import { formatDeadline, formatShare } from "@/lib/market-view/format";
import { getPublicCounts, listFeaturedMarkets } from "@/lib/market-view/queries";
import { safe } from "@/lib/market-view/safe";
import { listNews } from "@/lib/news/queries";

const measures = [
  { name: "Opening baseline", body: "The starting estimate set when a market opens, with its method.", swatch: "border-t-2 border-dashed border-ink-500" },
  { name: "YES allocation", body: "Share of credits on YES. Not a probability.", swatch: "h-1.5 rounded-full bg-red-500" },
  { name: "Calibrated probability", body: "Model estimate from forecasting accuracy, when available.", swatch: "h-0.5 rounded-full bg-ink-900" },
  { name: "Outcome", body: "The verified result, recorded with evidence.", swatch: "h-1.5 rounded-full bg-ink-300" },
];

export default function HomePage() {
  return (
    <main id="main" className="flex-1">
      {/* Hero: the wordmark is the focal point; the dark band fades into the page below. */}
      <section
        id="top"
        className="relative scroll-mt-16 overflow-hidden bg-[linear-gradient(to_bottom,var(--color-ink-900)_0%,var(--color-ink-900)_80%,var(--color-ink-800)_88%,var(--color-ink-50)_100%)] text-white"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center_30%,black_10%,transparent_65%)]"
        />
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-24 size-[36rem] -translate-x-1/2 rounded-full bg-red-500/20 blur-3xl motion-safe:animate-[home-glow_9s_ease-in-out_infinite]" />
        <div aria-hidden className="pointer-events-none absolute -left-40 top-1/3 size-80 rounded-full bg-red-600/10 blur-3xl" />

        <Container className="relative flex flex-col items-center pb-28 pt-20 text-center sm:pb-36 sm:pt-28">
          <Image
            src="/senzi-logo.png"
            alt="Senzi"
            width={1385}
            height={395}
            priority
            className="h-auto w-[min(78vw,560px)] drop-shadow-[0_8px_40px_rgb(255_44_44/0.25)] motion-safe:animate-[home-rise_900ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
          />
          <h1 className="mt-8 text-2xl font-bold leading-tight text-white sm:text-4xl motion-safe:animate-[home-rise_900ms_120ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
            Forecast what startups do <span className="text-red-500">next.</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-ink-300 sm:text-lg motion-safe:animate-[home-rise_900ms_220ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
            Put virtual credits behind measurable startup milestones and see where the community stands. No real money, ever.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3 motion-safe:animate-[home-rise_900ms_320ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
            <ButtonLink href="/#explore" variant="accent" size="lg">
              Explore markets <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href="/#tutorial" variant="inverse" size="lg">
              <Pencil className="size-4" aria-hidden /> How it works
            </ButtonLink>
          </div>
          <Suspense fallback={<div className="mt-10 h-14" />}>
            <HeroStats />
          </Suspense>

          <div className="mt-14 w-full max-w-xl text-left">
            <Suspense fallback={<Skeleton className="h-56 rounded-2xl bg-white/5" />}>
              <Spotlight />
            </Suspense>
          </div>
        </Container>
      </section>

      <section id="explore" className="scroll-mt-16 bg-[linear-gradient(to_bottom,var(--color-ink-50),var(--color-white)_30%)]">
        <Container className="home-reveal py-16 sm:py-20">
          <SectionHeading eyebrow="Live" title="Open markets" href="/markets" linkLabel="All markets" />
          <Suspense fallback={<CardGridSkeleton count={6} />}>
            <OpenMarkets />
          </Suspense>
        </Container>
      </section>

      <section
        id="how-it-works"
        className="relative scroll-mt-16 overflow-x-clip bg-[linear-gradient(to_bottom,var(--color-white),var(--color-ink-50)_18%,var(--color-ink-50)_82%,var(--color-white))]"
      >
        <div aria-hidden className="pointer-events-none absolute -right-40 top-20 size-96 rounded-full bg-red-500/[0.07] blur-3xl" />
        <Container className="relative py-16 sm:py-24">
          <div className="home-reveal mx-auto mb-10 max-w-2xl text-center">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-red-700">How it works</p>
            <h2 className="text-3xl font-bold text-ink-900 sm:text-4xl">Do it with us, once</h2>
            <p className="mt-3 text-ink-600">
              Forecast on a practice market, step by step. It uses a made-up startup and practice credits, so nothing touches your account.
            </p>
          </div>
          <HowItWorksTutorial />

          <div className="home-reveal mt-20">
            <SectionHeading eyebrow="Reading the numbers" title="What each figure means" />
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {measures.map((measure) => (
                <li key={measure.name} className="rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-lift)]">
                  <span aria-hidden className={`block w-8 ${measure.swatch}`} />
                  <h3 className="mt-3 font-display font-semibold text-ink-900">{measure.name}</h3>
                  <p className="mt-1 text-sm text-ink-600">{measure.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section id="startups" className="scroll-mt-16">
        <Container className="home-reveal grid gap-16 py-16 sm:py-20 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <SectionHeading title="Startups" href="/startups" />
            <Suspense fallback={<CardGridSkeleton count={4} className="sm:grid-cols-2 lg:grid-cols-2" />}>
              <FeaturedStartups />
            </Suspense>
          </div>
          <div>
            <SectionHeading title="News" />
            <Suspense fallback={<Skeleton className="h-96 rounded-[var(--radius-card)]" />}>
              <LatestNews />
            </Suspense>
          </div>
        </Container>
      </section>

      <Container className="home-reveal pb-4">
        <div className="relative overflow-hidden rounded-3xl bg-[radial-gradient(ellipse_at_bottom,var(--color-ink-800),var(--color-ink-900)_70%)] px-6 py-14 text-center text-white sm:px-12">
          <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/2 h-48 w-2/3 -translate-x-1/2 rounded-full bg-red-500/25 blur-3xl" />
          <h2 className="relative text-3xl font-bold sm:text-4xl">Start forecasting</h2>
          <p className="relative mx-auto mt-3 max-w-md text-ink-300">Every account starts with virtual credits. They have no cash value.</p>
          <div className="relative mt-6 flex flex-wrap justify-center gap-3">
            <SignInCta
              signedIn={
                <ButtonLink href="/markets" variant="accent" size="lg">
                  Explore markets
                </ButtonLink>
              }
            >
              Sign in
            </SignInCta>
            <ButtonLink href="/#tutorial" variant="inverse" size="lg">
              Try the walkthrough
            </ButtonLink>
          </div>
        </div>
      </Container>
    </main>
  );
}

function CardGridSkeleton({ count, className }: { count: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${className ?? ""}`}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-56 rounded-[var(--radius-card)]" />
      ))}
    </div>
  );
}

async function HeroStats() {
  await io();
  const counts = await safe(getPublicCounts);
  if (!counts.data) return null;
  return (
    <dl className="mt-10 flex justify-center gap-10 motion-safe:animate-[home-rise_900ms_420ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
      <div>
        <dt className="text-xs text-ink-400">Open markets</dt>
        <dd className="font-display text-2xl font-bold tabular-nums">{counts.data.openMarkets}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-400">Startups tracked</dt>
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
      <p className="mt-1 text-sm text-ink-300">{market.startup.name}</p>
      <p className="mt-3 font-display text-xl font-semibold leading-snug">{market.question}</p>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <p className="font-display text-4xl font-bold tabular-nums">{formatShare(market.allocation.share)}</p>
          <p className="text-xs text-ink-400">YES allocation</p>
        </div>
        {market.openingBaseline !== null && (
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums text-ink-200">{formatShare(market.openingBaseline)}</p>
            <p className="text-xs text-ink-400">Baseline</p>
          </div>
        )}
      </div>
      <AllocationBar share={market.allocation.share} baseline={market.openingBaseline} tone="dark" className="mt-3" />
      <p className="mt-4 text-xs text-ink-400">
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
