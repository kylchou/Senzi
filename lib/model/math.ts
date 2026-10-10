// Numeric helpers: standard normal CDF, seeded RNG, robust statistics.

import { createHash } from 'node:crypto';

/**
 * Standard normal CDF via the complementary error function (W. J. Cody's
 * rational approximation as used in Numerical Recipes erfc, |error| < 1.2e-7).
 */
export function normalCdf(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  if (z === Number.POSITIVE_INFINITY) return 1;
  if (z === Number.NEGATIVE_INFINITY) return 0;
  return 0.5 * erfc(-z / Math.SQRT2);
}

function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** z such that normalCdf(z) = 0.9. Used for 80% ranges. */
export const Z90 = 1.2815515655446004;

/** mulberry32: small, fast, deterministic PRNG. Returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 32-bit seed derived from arbitrary parts, so the same inputs always give the same band. */
export function seedFrom(...parts: string[]): number {
  return Number.parseInt(hashString(parts.join('|')).slice(0, 8), 16);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Linear-interpolated quantile (type 7, same as numpy's default). */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Median absolute deviation scaled to estimate a normal standard deviation. */
export function robustScale(residuals: readonly number[]): number {
  if (residuals.length === 0) return Number.NaN;
  const m = median(residuals);
  return 1.4826 * median(residuals.map((r) => Math.abs(r - m)));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
