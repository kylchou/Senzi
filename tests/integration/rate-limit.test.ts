import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pruneRateLimits, rateLimit } from "@/lib/rate-limit";
import { resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const rule = { limit: 2, windowSeconds: 60 };
const at = new Date("2026-10-10T12:00:10Z");

describe("rate limiting", () => {
  it("allows up to the limit, then answers RATE_LIMITED with a retry time", async () => {
    await rateLimit("test:user1", rule, at);
    await rateLimit("test:user1", rule, at);
    await expect(rateLimit("test:user1", rule, at)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      details: { retryAfter: 50 },
    });
  });

  it("counts each key separately and resets in the next window", async () => {
    await rateLimit("test:user1", rule, at);
    await rateLimit("test:user1", rule, at);
    await expect(rateLimit("test:user2", rule, at)).resolves.toEqual({ remaining: 1 });
    await expect(rateLimit("test:user1", rule, new Date(at.getTime() + 60_000))).resolves.toEqual({ remaining: 1 });
  });

  it("holds under concurrent requests", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => rateLimit("test:burst", rule, at)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  });

  it("prunes old windows", async () => {
    await rateLimit("test:old", rule, new Date(at.getTime() - 2 * 24 * 60 * 60 * 1000));
    await rateLimit("test:new", rule, at);
    expect(await pruneRateLimits(at)).toBe(1);
  });
});
