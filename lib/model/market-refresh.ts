// Refreshes the model line of open, machine-resolvable markets when new
// scraped data arrives. Trades never feed it: the model is recomputed from
// data only, a snapshot is stored only when the inputs changed, and the new
// value goes to the market through the forecasting engine's model-service
// path (the only way the model line changes).
//
// Covers traffic-rank markets. Download markets are left to their own refresh
// while that model is being reworked; add a kind to REFRESHERS to include it.

import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db, type TxClient } from "@/lib/db";
import { engineFor } from "@/lib/forecasting/server/service";
import { COMPANIES, metricIds } from "./catalog";
import { baselineFor, trafficQuestion, type MarketQuestion } from "./question-kinds";
import { FileModelStore, type ModelStore } from "./store";
import type { BaselineResult } from "./types";

/** The service id the forecasting engine accepts model values from. */
const MODEL_SERVICE = { kind: "service", serviceId: "model-service" } as const;

interface SpecRow {
  metricId: string;
  threshold: number;
  windowEnd: Date;
  market: { id: string; opensAt: Date; category: string | null; startup: { slug: string } };
}

/** Rebuilds the market's question from its stored spec, by metric. */
const REFRESHERS: Record<string, (companyId: string, spec: SpecRow) => MarketQuestion> = {
  [metricIds.trancoRank]: (companyId, spec) =>
    trafficQuestion(companyId, spec.threshold, spec.windowEnd.toISOString().slice(0, 10), spec.market.opensAt.toISOString()),
};

export interface MarketRefreshResult {
  checked: number;
  /** Markets whose model line got a new value. */
  published: number;
  /** Markets whose inputs hadn't changed since the last stored snapshot. */
  unchanged: number;
  /** Markets the model couldn't price (e.g. missing data); their last value stays. */
  skipped: { marketId: string; reason: string }[];
}

/** Stores one model result. Same row shape the seed writes. */
export async function saveBaselineSnapshot(tx: TxClient, marketId: string, b: BaselineResult) {
  await tx.modelBaselineSnapshot.create({
    data: {
      marketId,
      status: b.status === "ok" ? "OK" : b.status === "observed" ? "OBSERVED" : "INSUFFICIENT_DATA",
      probability: b.probability,
      low: b.low,
      high: b.high,
      confidence: b.confidence,
      asOf: new Date(b.asOf),
      dataThrough: b.method.details.dataThrough ? new Date(`${b.method.details.dataThrough}T00:00:00Z`) : null,
      modelName: b.method.name,
      modelVersion: b.method.version,
      inputsHash: b.method.details.inputsHash,
      method: b.method as unknown as Prisma.InputJsonValue,
      inputsUsed: b.inputsUsed as unknown as Prisma.InputJsonValue,
      sources: b.sources as unknown as Prisma.InputJsonValue,
      missing: b.missing,
      notes: b.notes,
    },
  });
}

/**
 * Recomputes every open refreshable market from the latest scraped data and
 * publishes changed results. Idempotent: running it twice on the same data
 * publishes nothing the second time.
 */
export async function refreshMarketModels(options: { now?: Date; store?: ModelStore } = {}): Promise<MarketRefreshResult> {
  const now = options.now ?? new Date();
  const store = options.store ?? new FileModelStore();
  const specs: SpecRow[] = await db.modelQuestionSpec.findMany({
    where: { metricId: { in: Object.keys(REFRESHERS) }, market: { status: "OPEN" } },
    select: {
      metricId: true,
      threshold: true,
      windowEnd: true,
      market: { select: { id: true, opensAt: true, category: true, startup: { select: { slug: true } } } },
    },
  });

  const result: MarketRefreshResult = { checked: 0, published: 0, unchanged: 0, skipped: [] };
  for (const spec of specs) {
    const marketId = spec.market.id;
    result.checked++;
    // Only catalog companies have scraped data; never read a path from user input.
    const company = COMPANIES.find((c) => c.id === spec.market.startup.slug);
    if (!company) {
      result.skipped.push({ marketId, reason: "Company has no scraped data" });
      continue;
    }
    const q = REFRESHERS[spec.metricId]!(company.id, spec);
    const latest = baselineFor(q, store.readPoints(company.id), now);
    if (latest.status !== "ok" || latest.probability === null) {
      result.skipped.push({ marketId, reason: latest.missing.join("; ") || `Model status ${latest.status}` });
      continue;
    }
    const inputsHash = latest.method.details.inputsHash;
    const seen = await db.modelBaselineSnapshot.findUnique({ where: { marketId_inputsHash: { marketId, inputsHash } }, select: { id: true } });
    if (seen) {
      result.unchanged++;
      continue;
    }
    await db.$transaction(async (tx) => {
      await saveBaselineSnapshot(tx, marketId, latest);
      await engineFor(tx).recordModelValue(MODEL_SERVICE, marketId, {
        value: latest.probability!,
        asOf: now,
        modelVersion: `${latest.method.name}@${latest.method.version}`,
        inputsNote: `${spec.market.category ?? q.category} data through ${latest.method.details.dataThrough}`,
      });
    });
    result.published++;
  }
  return result;
}
