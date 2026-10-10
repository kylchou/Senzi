// Small statistics helpers used by analytics.

/** Wilson score interval for a binomial proportion (95% by default). Null when n is 0. */
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Mean squared error between predicted probabilities and 0/1 outcomes. */
export function brierScore(pairs: ReadonlyArray<{ predicted: number; actual: 0 | 1 }>): number | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((s, p) => s + (p.predicted - p.actual) ** 2, 0) / pairs.length;
}

export interface Bin {
  lower: number;
  upper: number;
  count: number;
  meanPredicted: number | null;
  observedRate: number | null;
  /** 95% Wilson interval on the observed rate. */
  interval: [number, number] | null;
}

/** Equal-width bins over [0, 1]. A prediction of exactly 1 goes in the last bin. */
export function calibrationBins(pairs: ReadonlyArray<{ predicted: number; actual: 0 | 1 }>, binCount: number): Bin[] {
  const bins = Array.from({ length: binCount }, (_, i) => ({
    lower: i / binCount,
    upper: (i + 1) / binCount,
    predictedSum: 0,
    hits: 0,
    count: 0,
  }));
  for (const p of pairs) {
    const idx = Math.min(binCount - 1, Math.floor(p.predicted * binCount));
    const b = bins[idx]!;
    b.count++;
    b.predictedSum += p.predicted;
    b.hits += p.actual;
  }
  return bins.map((b) => ({
    lower: b.lower,
    upper: b.upper,
    count: b.count,
    meanPredicted: b.count ? b.predictedSum / b.count : null,
    observedRate: b.count ? b.hits / b.count : null,
    interval: wilsonInterval(b.hits, b.count),
  }));
}

/** Count-weighted mean gap between predicted and observed rates across bins. */
export function expectedCalibrationError(bins: readonly Bin[]): number | null {
  const total = bins.reduce((s, b) => s + b.count, 0);
  if (total === 0) return null;
  return bins.reduce(
    (s, b) => (b.count ? s + (b.count / total) * Math.abs(b.meanPredicted! - b.observedRate!) : s),
    0,
  );
}
