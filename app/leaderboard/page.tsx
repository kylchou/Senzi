import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Trophy } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { leaderboard } from "@/lib/forecasting/server/api";
import { safe } from "@/lib/market-view/safe";
import { PENDING_AUTH_PREFIX } from "@/lib/types";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Top Senzi forecasters by virtual-credit result, accuracy, and resolved forecasts.",
};

const METRICS = [
  { key: "net_result", label: "Profit", heading: "Lifetime profit/loss" },
  { key: "accuracy", label: "Accuracy", heading: "Calls right" },
  { key: "resolved_forecasts", label: "Most resolved", heading: "Resolved forecasts" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

export default function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  return (
    <main id="main" className="flex-1">
      <PageHeader
        title="Leaderboard"
        subtitle="Who's been right about startups. Rankings use settled markets only, and credits are virtual."
      />
      <Container className="pb-16 pt-6">
        <Suspense fallback={<Skeleton className="h-96 rounded-[var(--radius-card)]" />}>
          <Board searchParams={searchParams} />
        </Suspense>
      </Container>
    </main>
  );
}

async function Board({ searchParams }: Pick<PageProps<"/leaderboard">, "searchParams">) {
  const raw = (await searchParams).metric;
  const metric: MetricKey = METRICS.find((m) => m.key === raw)?.key ?? "net_result";
  const meta = METRICS.find((m) => m.key === metric)!;

  const [result, viewer] = await Promise.all([safe(() => leaderboard({ metric, limit: 100 })), getCurrentUser()]);
  if (result.failed) return <ErrorState body="The leaderboard couldn't load. Try again shortly." />;
  const board = result.data;

  // Public profile fields only: never emails or balances.
  const people = new Map(
    (
      await db.user.findMany({
        where: {
          id: { in: board.entries.map((e) => e.userId) },
          NOT: [{ authId: { startsWith: PENDING_AUTH_PREFIX } }, { authId: { startsWith: "deleted:" } }],
        },
        select: { id: true, displayName: true, username: true },
      })
    ).map((u) => [u.id, u]),
  );
  const entries = board.entries.filter((e) => people.has(e.userId));
  const ranked = entries.filter((e) => e.rank !== null);
  const unranked = entries.filter((e) => e.rank === null);
  const mine = viewer ? entries.find((e) => e.userId === viewer.id) : undefined;

  return (
    <div className="space-y-6">
      <nav aria-label="Rank by" className="flex flex-wrap gap-2">
        {METRICS.map((m) => (
          <Link
            key={m.key}
            href={m.key === "net_result" ? "/leaderboard" : `/leaderboard?metric=${m.key}`}
            aria-current={m.key === metric ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold transition-colors",
              m.key === metric ? "border-ink-900 bg-ink-900 text-surface" : "border-hairline bg-surface text-ink-700 hover:border-ink-300 hover:text-ink-900",
            )}
          >
            {m.label}
          </Link>
        ))}
      </nav>

      {mine && (
        <p className="surface-card flex items-center gap-2 p-4 text-sm text-ink-700">
          <Trophy className="size-4 text-red-700" aria-hidden />
          {mine.rank !== null ? (
            <span>
              You&apos;re <strong className="text-ink-900">#{mine.rank}</strong> by {meta.label.toLowerCase()}.
            </span>
          ) : (
            <span>{mine.note ?? "You're not ranked yet."}</span>
          )}
        </p>
      )}

      {ranked.length === 0 ? (
        <EmptyState
          illustration="markets"
          title="No rankings yet"
          body={metric === "accuracy" ? `Accuracy rankings need at least ${board.minResolvedForAccuracyRank} resolved forecasts per person.` : "Rankings appear once markets resolve and settle."}
        />
      ) : (
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-500">
              <tr className="border-b border-hairline">
                <th scope="col" className="w-14 px-4 py-3 font-medium">Rank</th>
                <th scope="col" className="px-4 py-3 font-medium">Forecaster</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">{meta.heading}</th>
                <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">Resolved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline tabular-nums">
              {ranked.map((e) => {
                const person = people.get(e.userId)!;
                const isMe = viewer?.id === e.userId;
                return (
                  <tr key={e.userId} className={cn(isMe && "bg-red-50/60 dark:bg-red-500/10")}>
                    <td className="px-4 py-3 font-display font-bold text-ink-900">{medal(e.rank!)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-bold text-surface">
                          {person.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink-900">
                            {person.displayName}
                            {isMe && <span className="ml-1.5 text-xs font-semibold text-red-700">You</span>}
                          </span>
                          {person.username && <span className="block truncate text-xs text-ink-500">@{person.username}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{formatValue(metric, e)}</td>
                    <td className="hidden px-4 py-3 text-right text-ink-600 sm:table-cell">{e.resolvedForecasts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {unranked.length > 0 && (
        <p className="text-sm text-ink-500">
          {unranked.length} {unranked.length === 1 ? "forecaster isn't" : "forecasters aren't"} ranked yet
          {metric === "accuracy" ? ` (accuracy needs ${board.minResolvedForAccuracyRank} resolved forecasts)` : " (no settled forecasts yet)"}.
        </p>
      )}
      {board.limitations.length > 0 && (
        <ul className="space-y-1 text-xs text-ink-500">
          {board.limitations.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function medal(rank: number) {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
}

function formatValue(metric: MetricKey, e: { value: number | null; netResult: number; accuracy: number | null; resolvedForecasts: number }) {
  if (metric === "accuracy") return e.accuracy === null ? "N/A" : `${Math.round(e.accuracy * 100)}%`;
  if (metric === "resolved_forecasts") return e.resolvedForecasts.toLocaleString();
  const n = e.netResult;
  return (
    <span className={n > 0 ? "text-emerald-700 dark:text-emerald-300" : n < 0 ? "text-red-700" : "text-ink-900"}>
      {n > 0 ? "+" : ""}
      {n.toLocaleString()} credits
    </span>
  );
}
