import "server-only";

// Request handling for /api/forecasts, /api/forecasts/quote, /api/portfolio
// and /api/leaderboard. Routes stay thin; validation, permissions and the
// engine call live here.

import { z } from "zod";
import { forbidden } from "@/lib/api-response";
import { db } from "@/lib/db";
import { requireMarketVisible } from "@/lib/permissions";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { SessionUser } from "@/lib/types";
import type { LeaderboardMetric } from "../analytics";
import type { LmsrFill } from "../lmsr-pricing";
import type { ForecastReceipt } from "../submission";
import { translateErrors, withEngine } from "./service";

const side = z.enum(["YES", "NO"]);
const credits = z.coerce.number().int().positive().max(1_000_000);

export const submitForecastSchema = z.object({
  marketId: z.string().min(1).max(64),
  side,
  credits,
  idempotencyKey: z.string().min(1).max(128),
  /** YES price shown in the quote. Optional; when sent, moves beyond the tolerance are rejected. */
  quotedPrice: z.number().gt(0).lt(1).optional(),
});

export const quoteSchema = z.object({ marketId: z.string().min(1).max(64), side, credits });

export const leaderboardSchema = z.object({
  metric: z.enum(["net_result", "accuracy", "resolved_forecasts"]).default("net_result"),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

/** Receipt returned by POST /api/forecasts. The first six fields are what ForecastPanel already reads. */
export interface ForecastReceiptDTO {
  id: string;
  marketId: string;
  side: "YES" | "NO";
  credits: number;
  createdAt: string;
  balanceAfter: number | null;
  shares: number | null;
  averagePrice: number | null;
  /** Market probability (all users) just before and just after this trade. */
  priceBefore: number | null;
  priceAfter: number | null;
  sequence: number;
  replayed: boolean;
  digest: string;
}

export function toReceiptDTO(r: ForecastReceipt): ForecastReceiptDTO {
  const fill = r.fill as Partial<LmsrFill> | null;
  return {
    id: r.forecastId,
    marketId: r.marketId,
    side: r.side,
    credits: r.amount,
    createdAt: r.acceptedAt.toISOString(),
    balanceAfter: r.balanceAfter,
    shares: fill?.shares ?? null,
    averagePrice: fill?.averagePrice ?? null,
    priceBefore: fill?.priceBefore ?? r.entry.generalBefore,
    priceAfter: fill?.priceAfter ?? r.entry.generalAfter,
    sequence: r.sequence,
    replayed: r.replayed,
    digest: r.digest,
  };
}

/** The sponsor can't trade their own question: members of a private market's organization are barred. */
async function assertNotSponsor(userId: string, marketId: string) {
  const market = await db.market.findUnique({ where: { id: marketId }, select: { organizationId: true, createdById: true } });
  if (!market) return;
  if (market.createdById === userId) throw forbidden("You can't forecast on a market you created");
  if (market.organizationId) {
    const member = await db.organizationMembership.findFirst({ where: { organizationId: market.organizationId, userId }, select: { userId: true } });
    if (member) throw forbidden("Members of the sponsoring organization can't forecast on its markets");
  }
}

export async function submitForecastForUser(user: SessionUser, input: z.output<typeof submitForecastSchema>) {
  await rateLimit(`forecast:${user.id}`, RATE_LIMITS.forecastSubmit);
  await requireMarketVisible(user.id, input.marketId);
  await assertNotSponsor(user.id, input.marketId);
  const receipt = await translateErrors(() =>
    withEngine((engine) =>
      engine.submitForecast(
        { kind: "user", userId: user.id },
        {
          marketId: input.marketId,
          side: input.side,
          amount: input.credits,
          idempotencyKey: input.idempotencyKey,
          ...(input.quotedPrice !== undefined ? { quotedPrice: input.quotedPrice } : {}),
        },
      ),
    ),
  );
  return toReceiptDTO(receipt);
}

export async function quoteForUser(userId: string | null, input: z.output<typeof quoteSchema>) {
  await requireMarketVisible(userId, input.marketId);
  const quote = await translateErrors(() => withEngine((engine) => engine.quoteForecast({ marketId: input.marketId, side: input.side, amount: input.credits })));
  const fill = quote.fill as Partial<LmsrFill>;
  return {
    marketId: quote.marketId,
    side: quote.side,
    credits: quote.amount,
    shares: fill.shares ?? null,
    averagePrice: fill.averagePrice ?? null,
    priceBefore: fill.priceBefore ?? null,
    priceAfter: fill.priceAfter ?? null,
    /** If the YES price moves more than this before you submit, the trade is rejected with a new quote. */
    tolerance: 0.02,
    quotedAt: quote.quotedAt.toISOString(),
    label: "Market probability (all users)",
  };
}

export async function portfolioForUser(user: SessionUser) {
  return translateErrors(() => withEngine((engine) => engine.getPortfolio({ kind: "user", userId: user.id }, user.id), { timeout: 30_000 }));
}

export async function leaderboard(input: z.output<typeof leaderboardSchema>) {
  return translateErrors(() =>
    withEngine((engine) => engine.getLeaderboard({ metric: input.metric as LeaderboardMetric, limit: input.limit }), { timeout: 30_000 }),
  );
}
