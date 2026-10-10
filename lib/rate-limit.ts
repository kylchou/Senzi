import { ApiError } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * Fixed-window rate limiting backed by Postgres, so limits hold across
 * serverless instances. Each call atomically increments the counter for the
 * current window and throws RATE_LIMITED (429) once it passes `limit`.
 *
 *   await rateLimit(`org-invite:${user.id}`, RATE_LIMITS.orgInvite);
 */

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

/** Limits for the sensitive endpoints. Teammates can add their own keys. */
export const RATE_LIMITS = {
  orgCreate: { limit: 5, windowSeconds: 60 * 60 },
  orgInvite: { limit: 30, windowSeconds: 60 * 60 },
  profileUpdate: { limit: 30, windowSeconds: 60 * 60 },
  verificationSubmit: { limit: 5, windowSeconds: 24 * 60 * 60 },
  /** Access-code guesses per user, so codes can't be brute-forced. */
  accessCodeRedeem: { limit: 10, windowSeconds: 60 * 60 },
  creditAdjust: { limit: 60, windowSeconds: 60 * 60 },
  resolutionReview: { limit: 60, windowSeconds: 60 * 60 },
  forecastSubmit: { limit: 60, windowSeconds: 60 },
  export: { limit: 30, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

export async function rateLimit(key: string, rule: RateLimitRule, now = new Date()): Promise<{ remaining: number }> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  const count = row?.count ?? 1;
  if (count > rule.limit) {
    const retryAfter = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
    throw new ApiError("RATE_LIMITED", "Too many requests. Try again later.", { retryAfter });
  }
  return { remaining: rule.limit - count };
}

/** For unauthenticated endpoints: limit by client IP instead of user. */
export function rateLimitByIp(req: Request, name: string, rule: RateLimitRule) {
  return rateLimit(`${name}:ip:${clientIp(req) ?? "unknown"}`, rule);
}

/** Drops windows older than a day. Run from cron. */
export async function pruneRateLimits(now = new Date()) {
  const { count } = await db.rateLimitBucket.deleteMany({
    where: { windowStart: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  });
  return count;
}
