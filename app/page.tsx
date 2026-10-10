import Link from "next/link";
import { io } from "next/cache";
import { ArrowRight, Briefcase, CircleCheck, Users } from "lucide-react";
import { HeroDemo } from "@/components/home/HeroDemo";
import { StartHere } from "@/components/home/StartHere";
import { MarketCard } from "@/components/MarketCard";
import { NewsFeed } from "@/components/NewsFeed";
import { StartupCard } from "@/components/StartupCard";
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

const chip = "rounded-full px-3 py-1 text-xs font-semibold";

/** The six-step story, each with a small illustrative visual (not live data). */
const story = [
  {
    title: "A measurable question",
    body: "Find a startup and a YES/NO question about what it does next.",
    visual: (
      <div className="w-56 rounded-xl bg-ink-50 p-3 text-xs text-ink-700">
        <p className="font-semibold text-ink-900">Will ExampleAI reach 10k users by Dec 31?</p>
      </div>
    ),
  },
  {
    title: "Check the details",
    body: "Read the deadline, what counts as YES or NO, and the sources that will settle it. No surprises at the end.",
    visual: (
      <dl className="grid w-56 grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-ink-50 p-3 text-xs">
        <dt className="text-ink-600">Closes</dt>
        <dd className="font-semibold text-ink-900">Dec 31</dd>
        <dt className="text-ink-600">YES if</dt>
        <dd className="font-semibold text-ink-900">10,000+ MAU</dd>
        <dt className="text-ink-600">Source</dt>
        <dd className="font-semibold text-ink-900">Public reports</dd>
      </dl>
    ),
  },
  {
    title: "Make your forecast",
    body: "Spend virtual credits on YES or NO. Disagreeing with the crowd is how you add information.",
    visual: (
      <div className="flex gap-2">
        <span className={`${chip} bg-red-600 text-white`}>YES · 50</span>
        <span className={`${chip} bg-ink-900 text-surface`}>NO · 25</span>
        <span className={`${chip} bg-red-600 text-white`}>YES · 100</span>
      </div>
    ),
  },
  {
    title: "Compare with everyone",
    body: "See your estimate next to the market probability, which reflects everyone's credits together.",
    visual: (
      <div className="w-48 text-xs text-ink-600">
        <div className="relative h-2 rounded-full bg-ink-100">
          <div className="absolute inset-y-0 left-0 w-[52%] rounded-full bg-red-500" />
          <div className="absolute -top-1 left-[70%] h-4 w-1 rounded-full bg-ink-900" />
        </div>
        <p className="mt-2">Market 52% · You 70%</p>
      </div>
    ),
  },
  {
    title: "The market moves",
    body: "Each forecast moves the market probability, and every change is saved, so you can see how expectations shifted.",
    visual: (
      <svg viewBox="0 0 160 48" className="h-12 w-40" role="img" aria-label="Example line rising from 30% to 52%">
        <path d="M4 40 L36 34 L68 36 L100 22 L132 18 L156 12" fill="none" className="stroke-red-500" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="156" cy="12" r="4" className="fill-red-500" />
      </svg>
    ),
  },
  {
    title: "Checked against the outcome",
    body: "After the deadline, two admins check the result against the original criteria and evidence, then shares pay out.",
    visual: (
      <span className={`${chip} inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200`}>
        <CircleCheck className="size-3.5" aria-hidden /> Resolved YES · evidence attached
      </span>
    ),
  },
];

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
              Allocate virtual credits on measurable startup milestones and see where the community stands.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 motion-safe:animate-[home-rise_900ms_220ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
              <ButtonLink href="/markets" variant="accent" size="lg">
                Explore markets <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="/how-it-works" variant="outline" size="lg">
                How it works
              </ButtonLink>
            </div>
            <div className="mt-5">
              <StartHere />
            </div>
            <StreamIn fallback={<div className="mt-8 h-5" />}>
              <HeroStats />
            </StreamIn>
            <div className="mt-10 w-full max-w-md motion-safe:animate-[home-rise_900ms_380ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
              <HeroDemo />
            </div>
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
              <p className="mt-3 text-ink-600">From a measurable question to a checked outcome.</p>
            </div>
            <ol className="relative mx-auto grid max-w-4xl gap-5 before:absolute before:bottom-6 before:left-6 before:top-6 before:w-px before:bg-gradient-to-b before:from-red-500/50 before:via-ink-300 before:to-transparent sm:before:left-8">
              {story.map((item, i) => (
                <li key={item.title} className="home-reveal relative grid grid-cols-[3rem_1fr] gap-4 sm:grid-cols-[4rem_1fr]">
                  <span className="relative z-10 grid size-12 place-items-center rounded-full bg-surface font-display text-lg font-bold text-red-700 shadow-[var(--shadow-card)] ring-1 ring-hairline sm:size-16 sm:text-xl">
                    {i + 1}
                  </span>
                  <div className="surface-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                    <div className="max-w-md">
                      <h3 className="font-display text-lg font-semibold text-ink-900">{item.title}</h3>
                      <p className="mt-1 text-sm text-ink-600">{item.body}</p>
                    </div>
                    <div className="shrink-0">{item.visual}</div>
                  </div>
                </li>
              ))}
            </ol>
            <p className="home-reveal mt-10 text-center">
              <Link href="/how-it-works" className="inline-flex items-center gap-1 font-semibold text-red-700 hover:underline">
                Try it on a practice market <ArrowRight className="size-4" aria-hidden />
              </Link>
            </p>
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

        {/* Who it's for. Public copy only; no private research appears here. */}
        <Container className="home-reveal grid gap-4 pt-12 sm:pt-16 md:grid-cols-2">
          <div className="surface-card p-6 sm:p-8">
            <Users className="size-6 text-red-700" aria-hidden />
            <h3 className="mt-3 font-display text-xl font-semibold text-ink-900">For forecasters</h3>
            <p className="mt-2 text-sm text-ink-600">
              Browse startups, forecast open questions, and track how your calls hold up once outcomes are verified.
            </p>
            <Link href="/markets" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-800 hover:underline">
              Browse markets <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="surface-card p-6 sm:p-8">
            <Briefcase className="size-6 text-red-700" aria-hidden />
            <h3 className="mt-3 font-display text-xl font-semibold text-ink-900">For VC teams</h3>
            <p className="mt-2 text-sm text-ink-600">
              Firms can run private research studies, follow startups, and save reports, visible only to their own members.
            </p>
            <Link href="/vc" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-800 hover:underline">
              Open Intelligence <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </Container>

        <Container className="home-reveal pb-4 pt-12 text-center sm:pt-16">
          <h2 className="text-3xl font-bold text-ink-900 sm:text-4xl">Start forecasting</h2>
          <p className="mx-auto mt-3 max-w-md text-ink-600">Every account starts with virtual credits. They have no cash value.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/how-it-works" variant="outline" size="lg">
              Try the tutorial
            </ButtonLink>
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
