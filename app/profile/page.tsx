import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, FlaskConical, ShieldCheck } from "lucide-react";
import { EditProfile } from "@/components/profile/EditProfile";
import { ProfileDashboard, type DashboardData, type PositionRow } from "@/components/profile/ProfileDashboard";
import { SignInCta } from "@/components/ui/AuthControls";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { PositionView } from "@/lib/forecasting/portfolio";
import { portfolioForUser } from "@/lib/forecasting/server/api";
import { formatDate } from "@/lib/market-view/format";
import { safe } from "@/lib/market-view/safe";
import { getCurrentUserProfile } from "@/lib/users";
import { listVerifiedStartups } from "@/lib/product-verification";

export const metadata: Metadata = { title: "Profile", robots: { index: false } };

/** Ledger reasons in plain words. */
const ACTIVITY: Record<string, string> = {
  signup_grant: "Welcome credits",
  forecast_stake: "Forecast placed",
  forecast_stake_reversal: "Forecast reversed",
  forecast_payout: "Payout",
  forecast_refund_void: "Refund (question voided)",
  admin_grant: "Credits from Senzi",
  admin_adjustment: "Balance correction",
  achievement_reward: "Achievement reward",
};

export default function ProfilePage() {
  return (
    <main id="main" className="flex-1">
      <Container className="py-8 sm:py-12">
        <Suspense fallback={<ProfileSkeleton />}>
          <Profile />
        </Suspense>
      </Container>
    </main>
  );
}

async function Profile() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="surface-card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-2xl font-bold text-ink-900">Your profile</h1>
        <p className="mt-2 text-ink-600">Sign in to see your virtual credits, forecasts, and results.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <SignInCta>Sign in</SignInCta>
          <ButtonLink href="/how-it-works" variant="outline" size="lg">
            Try the tutorial
          </ButtonLink>
        </div>
      </div>
    );
  }

  const loaded = await safe(() => Promise.all([portfolioForUser(user), getCurrentUserProfile(user), listVerifiedStartups(user.id)]));
  if (loaded.failed) {
    return <ErrorState body="Your profile couldn't load. Try again shortly." />;
  }
  const [p, me, verifiedFor] = loaded.data;
  const positions = [...p.active, ...p.awaitingResolution, ...p.resolved, ...p.cancelled];
  const slugs = new Map(
    (await db.market.findMany({ where: { id: { in: [...new Set(positions.map((x) => x.marketId))] } }, select: { id: true, slug: true } })).map(
      (m) => [m.id, m.slug],
    ),
  );
  const row = (pos: PositionView): PositionRow => {
    const slug = slugs.get(pos.marketId);
    return {
      id: pos.forecastId,
      question: pos.question,
      href: slug ? `/markets/${slug}` : null,
      side: pos.side,
      amount: pos.amount,
      shares: typeof pos.fill?.shares === "number" ? pos.fill.shares : null,
      entry: pos.entry.generalBefore,
      now: pos.current?.general ?? null,
      result: pos.result,
      net: pos.net,
      acceptedAt: pos.acceptedAt.toISOString(),
    };
  };
  const data: DashboardData = {
    balance: p.balance,
    netResult: p.totals.netResult,
    won: p.totals.won,
    lost: p.totals.lost,
    voided: p.totals.void,
    inPlay: p.totals.activeStake + p.totals.awaitingResolutionStake,
    open: p.active.map(row),
    awaiting: p.awaitingResolution.map(row),
    settled: [...p.resolved, ...p.cancelled].map(row),
    activity: p.history.map((h) => ({
      id: h.ledgerTransactionId,
      label: ACTIVITY[h.reason] ?? h.reason.replace(/_/g, " "),
      question: h.question,
      delta: h.delta,
      balanceAfter: h.balanceAfter,
      at: new Date(h.at).toISOString(),
    })),
  };

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          {me.avatarUrl ? (
            <Image src={me.avatarUrl} alt="" width={64} height={64} className="size-16 shrink-0 rounded-full ring-1 ring-hairline" unoptimized />
          ) : (
            <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-ink-900 font-display text-2xl font-bold text-surface">
              {me.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">Profile</p>
            <h1 className="truncate text-3xl font-bold text-ink-900">{me.displayName}</h1>
            <p className="text-sm text-ink-600">
              {me.username ? `@${me.username} · ` : ""}Joined {formatDate(me.createdAt)}
            </p>
            {me.bio && <p className="mt-2 max-w-xl text-sm text-ink-700">{me.bio}</p>}
            {verifiedFor.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-ink-600">
                <ShieldCheck className="size-4 text-emerald-600" aria-hidden /> Verified user of
                {verifiedFor.map((s, i) => (
                  <Link key={s.slug} href={`/verify/${s.slug}`} className="font-semibold text-ink-900 hover:underline">
                    {s.name}
                    {i < verifiedFor.length - 1 ? "," : ""}
                  </Link>
                ))}
              </p>
            )}
            <div className="mt-3">
              <EditProfile displayName={me.displayName} username={me.username} bio={me.bio} />
            </div>
          </div>
        </div>
        <ButtonLink href="/markets" variant="accent">
          Find a forecast <ArrowRight className="size-4" aria-hidden />
        </ButtonLink>
      </header>

      <p className="text-sm text-ink-600">Credits are virtual and have no cash value. They can&apos;t be bought or cashed out.</p>

      {positions.length === 0 && (
        <EmptyState
          illustration="markets"
          title="No forecasts yet"
          body="Pick a question to make your first forecast, or practice first with fake credits."
        />
      )}

      <ProfileDashboard data={data} />

      <p className="flex items-center gap-2 text-sm text-ink-600">
        <FlaskConical className="size-4" aria-hidden /> Want to try something without spending credits?{" "}
        <Link href="/how-it-works#practice" className="font-semibold text-ink-800 hover:underline">
          Practice mode
        </Link>
      </p>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div role="status" aria-label="Loading your profile" className="space-y-6">
      <Skeleton className="h-16 w-72 rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-[var(--radius-card)]" />
    </div>
  );
}
