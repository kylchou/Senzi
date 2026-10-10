import "server-only";
import { normalizePoints, type ActivityBucket, type ReplayData, type ReplayEvent, type ReplayPoint } from "./replay";

/**
 * DEMO DATA ONLY. Illustrative Market Replay history for presentations when a
 * market has no real Model, General, or Verified history yet. Never used
 * unless SENZI_REPLAY_DEMO=1 is set on the server, and every response built
 * here is marked source "demo" so the UI labels it.
 */
export function replayDemoEnabled(): boolean {
  return process.env.SENZI_REPLAY_DEMO === "1";
}

/** Small seeded generator so a market always gets the same demo replay. */
function seeded(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    return ((state ^= state >>> 16) >>> 0) / 4294967296;
  };
}

const clamp = (value: number) => Math.min(0.97, Math.max(0.03, value));

export function demoReplay(
  market: ReplayData["market"] & { resolution: ReplayData["resolution"] },
  now: number,
): ReplayData {
  const random = seeded(market.slug);
  const start = market.opensAt;
  const end = Math.max(start + 7 * 86_400_000, Math.min(now, market.resolution?.resolvedAt ?? now));
  const span = end - start;
  const count = 48;
  const catalyst = start + span * 0.38;
  const base = 0.4 + random() * 0.15;
  const lift = (0.18 + random() * 0.12) * (market.resolution?.outcome === "NO" ? -1 : 1);

  const raw: ReplayPoint[] = [];
  for (let i = 0; i < count; i++) {
    const at = start + (span * i) / (count - 1);
    const after = Math.max(0, (at - catalyst) / (span * 0.35));
    const wave = (random() - 0.5) * 0.03;
    // Verified users react first and hardest, General users follow, the Model moves least.
    const verified = clamp(base + lift * Math.min(1, after * 1.6) + wave);
    const general = clamp(base + lift * 0.65 * Math.min(1, after * 0.9) + wave * 0.8);
    const model = clamp(base - 0.02 + lift * 0.2 * Math.min(1, after * 0.6) + wave * 0.4);
    raw.push({ at, model, general, verified, forecasts: Math.round(i * 2.4), credits: Math.round(i * 180) });
  }

  const events: ReplayEvent[] = [
    { id: "opened", at: start, kind: "opened", origin: "real", title: "Market opened" },
    { id: "demo-1", at: start + span * 0.2, kind: "demo", origin: "demo", title: "Demo event: funding rumor" },
    { id: "demo-2", at: catalyst, kind: "demo", origin: "demo", title: "Demo event: hiring spike detected" },
    { id: "demo-3", at: start + span * 0.62, kind: "demo", origin: "demo", title: "Demo event: verified users turn bullish" },
  ];
  if (market.resolution) {
    events.push({
      id: "resolved",
      at: end,
      kind: "resolved",
      origin: "real",
      title: market.resolution.outcome === "VOID" ? "Resolved as void" : `Resolved ${market.resolution.outcome}`,
      url: market.resolution.evidenceUrl ?? undefined,
    });
  }

  const activity: ActivityBucket[] = Array.from({ length: 30 }, (_, i) => {
    const bucketStart = start + (span * i) / 30;
    const heat = bucketStart > catalyst ? 3 : 1;
    const yes = Math.round(random() * 4 * heat);
    const no = Math.round(random() * 2);
    return {
      start: bucketStart,
      end: bucketStart + span / 30,
      yes,
      no,
      yesCredits: yes * 60,
      noCredits: no * 50,
      verified: Math.round(yes * 0.3),
    };
  });

  return { source: "demo", market, start, end, points: normalizePoints(raw), events, activity, resolution: market.resolution };
}
