/**
 * DEMO ONLY: scales the activity counts shown on market pages, charts and VC views
 * (forecasts, forecasters, credits staked) so the demo reads like a busy market.
 * The seed places about 30-80 simulated trades per market; these show 18-32 times
 * that. Prices, probabilities, model values, a user's own positions, settlement and
 * the admin pages always use the real numbers.
 *
 * Read docs/DEMO-DISPLAY-REMINDER.md before changing this or removing it.
 * Set DEMO_INFLATE_COUNTS=false to show real counts.
 */

const MIN_FACTOR = 18;
const SPREAD = 15;

/** Same market, same factor, on every page and reload. FNV-1a over the market id. */
export function demoScaleFactor(marketId: string): number {
  if (/^(false|0|off)$/i.test(process.env.DEMO_INFLATE_COUNTS ?? "")) return 1;
  let h = 2166136261;
  for (let i = 0; i < marketId.length; i++) h = Math.imul(h ^ marketId.charCodeAt(i), 16777619) >>> 0;
  return MIN_FACTOR + (h % SPREAD);
}

/** A display count for a market. Zero stays zero, so empty markets still read as empty. */
export function demoCount(count: number, marketId: string): number {
  return count > 0 ? Math.round(count * demoScaleFactor(marketId)) : count;
}
