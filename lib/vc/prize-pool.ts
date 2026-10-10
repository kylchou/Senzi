/**
 * Prize pools: credits a firm attaches to a question, split among the traders
 * who gained credits on its market, in proportion to what each gained.
 *
 * A trader's gain is their net credits on the market after settlement:
 * payouts and refunds minus stakes. Traders who broke even or lost get
 * nothing. Shares are whole credits; leftover credits from rounding go to the
 * largest fractional remainders, ties broken by user id, so the whole pool is
 * paid and the result is deterministic.
 */

export interface TraderGain {
  userId: string;
  /** Net credits on the market after settlement; may be negative. */
  gain: number;
}

export interface PrizeShare {
  userId: string;
  amount: number;
}

export function splitPrizePool(pool: number, gains: TraderGain[]): PrizeShare[] {
  if (!Number.isInteger(pool) || pool <= 0) return [];
  const winners = gains.filter((g) => g.gain > 0);
  const total = winners.reduce((sum, g) => sum + g.gain, 0);
  if (total <= 0) return [];

  const raw = winners.map((g) => {
    const exact = (pool * g.gain) / total;
    return { userId: g.userId, amount: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = pool - raw.reduce((sum, r) => sum + r.amount, 0);
  const byRemainder = [...raw].sort((a, b) => b.remainder - a.remainder || a.userId.localeCompare(b.userId));
  for (const r of byRemainder) {
    if (left <= 0) break;
    r.amount += 1;
    left -= 1;
  }
  return raw.filter((r) => r.amount > 0).map(({ userId, amount }) => ({ userId, amount }));
}

/** Idempotency key for one trader's share, so retries never pay twice. */
export const prizeIdempotencyKey = (studyId: string, userId: string) => `prize:${studyId}:${userId}`;
