import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowRight, Clock, ShieldCheck } from "lucide-react";
import { AccessCodeForm, ScreenshotForm } from "@/components/verify/VerifyForms";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Skeleton } from "@/components/ui/Skeleton";
import { requireUserPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/market-view/format";
import { PUBLIC_MARKET_WHERE, PUBLIC_STARTUP_WHERE } from "@/lib/permissions";
import { productVerificationStatus } from "@/lib/product-verification";
import { redeemCodeAction, submitScreenshotAction } from "./actions";

export const metadata: Metadata = { title: "Verify you're a user", robots: { index: false } };

export default function VerifyPage({ params, searchParams }: PageProps<"/verify/[slug]">) {
  return (
    <main id="main" className="flex-1">
      <Container className="py-10 sm:py-14">
        <Suspense fallback={<Skeleton className="h-96 rounded-[var(--radius-card)]" />}>
          <Verify params={params} searchParams={searchParams} />
        </Suspense>
      </Container>
    </main>
  );
}

async function Verify({ params, searchParams }: Pick<PageProps<"/verify/[slug]">, "params" | "searchParams">) {
  const { slug } = await params;
  const { next } = await searchParams;
  const here = `/verify/${slug}`;
  const user = await requireUserPage(here);

  const startup = await db.startup.findFirst({ where: { slug, ...PUBLIC_STARTUP_WHERE }, select: { id: true, name: true, slug: true } });
  if (!startup) notFound();

  const [status, markets] = await Promise.all([
    productVerificationStatus(user.id, startup.id),
    db.market.findMany({
      where: { AND: [PUBLIC_MARKET_WHERE, { startupId: startup.id, verifiedUsersOnly: true }] },
      orderBy: { closesAt: "asc" },
      select: { slug: true, question: true },
    }),
  ]);
  // After verifying, go back to the market that sent them here.
  const returnTo = typeof next === "string" && next.startsWith("/markets/") ? next : here;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-red-700">Verified users</p>
        <h1 className="text-3xl font-bold text-ink-900">
          {status.verified ? `You're a verified ${startup.name} user` : `Do you use ${startup.name}?`}
        </h1>
        <p className="mt-2 text-ink-600">
          Some markets are only for people who actually use a product, because their view of it is worth seeing separately.
          Verified users can trade on them, and their forecasts make up the Verified Users line on every {startup.name} market.
        </p>
      </header>

      {status.verified ? (
        <div className="surface-card flex items-start gap-3 p-6">
          <ShieldCheck className="mt-0.5 size-6 shrink-0 text-emerald-600" aria-hidden />
          <div>
            <p className="font-semibold text-ink-900">Verified on {formatDate(status.verified.createdAt.toISOString())}</p>
            <p className="mt-1 text-sm text-ink-600">
              {status.verified.method === "ACCESS_CODE" ? "With an access code." : "With a screenshot an admin reviewed."}
            </p>
            {returnTo !== here && (
              <ButtonLink href={returnTo} variant="accent" size="sm" className="mt-4">
                Back to the market <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
            )}
          </div>
        </div>
      ) : (
        <>
          {status.lastRejected?.reviewNote && (
            <p role="status" className="rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">
              Your last screenshot wasn&apos;t approved: {status.lastRejected.reviewNote}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <AccessCodeForm action={redeemCodeAction.bind(null, startup.id, returnTo)} startupName={startup.name} />
            {status.pending ? (
              <div className="surface-card flex flex-col gap-3 p-6">
                <Clock className="size-6 text-red-700" aria-hidden />
                <h2 className="font-display text-lg font-semibold text-ink-900">Your screenshot is being reviewed</h2>
                <p className="text-sm text-ink-600">
                  Sent {formatDate(status.pending.createdAt.toISOString())}. We&apos;ll notify you when it&apos;s checked. An access
                  code still works in the meantime.
                </p>
              </div>
            ) : (
              <ScreenshotForm action={submitScreenshotAction.bind(null, startup.id, here)} startupName={startup.name} />
            )}
          </div>
        </>
      )}

      <section>
        <h2 className="mb-3 text-xl font-bold text-ink-900">
          {status.verified ? "Markets you can trade on" : "Markets this unlocks"}
        </h2>
        {markets.length === 0 ? (
          <p className="text-sm text-ink-600">No verified-users markets for {startup.name} yet. Your verification still counts on every {startup.name} market.</p>
        ) : (
          <ul className="grid gap-3">
            {markets.map((m) => (
              <li key={m.slug}>
                <Link href={`/markets/${m.slug}`} className="surface-card flex items-center justify-between gap-4 p-5 hover:shadow-[var(--shadow-lift)]">
                  <span className="font-medium text-ink-900">{m.question}</span>
                  <ArrowRight className="size-4 shrink-0 text-ink-500" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
