// Question types beyond package downloads, chosen 2026-10-10:
// - downloads:      7-day npm download total at or above T (the trend model)
// - traffic_rank:   7-day average Tranco rank at or below R ("users of the site"
//                   proxy; same trend model on daily ranks, short history)
// - hiring:         open postings on the public job board at or above N on day D
// - funding_filing: a new SEC Form D filed between the open date and D
// Revenue and user counts are not public for these companies, so they appear
// only through these proxies. Every type resolves from a named public source.

import { computeBaseline, METHOD_DESCRIPTION } from "./baseline";
import { getCompany, metricIds } from "./catalog";
import { addDays, dayOf, toDayNumber } from "./dates";
import { clamp, hashString, normalCdf } from "./math";
import { defaultParams, MODEL_NAME, MODEL_VERSION } from "./params";
import { makeQuestion } from "./questions";
import type { BaselineResult, DataPoint, ModelConfidence, SourceId, ThresholdQuestion } from "./types";

export type QuestionKind = "downloads" | "traffic_rank" | "hiring" | "funding_filing";

export interface MarketQuestion {
  id: string;
  kind: QuestionKind;
  companyId: string;
  metricId: string;
  /** Downloads: total; traffic: rank; hiring: postings; funding: 1 (one filing). */
  threshold: number;
  /** Last day (inclusive, UTC) the question looks at. */
  windowEnd: string;
  windowDays: number;
  opensAt: string;
  /** Trading stops here: before the measured window starts. */
  closesAt: string;
  text: string;
  yesCriteria: string;
  noCriteria: string;
  category: string;
  source: SourceId;
  resolutionUrl: string;
  resolutionTitle: string;
}

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** 35000000 -> "35M", 5200000 -> "5.2M", 770 -> "770". */
export function compact(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${+(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString("en-US");
}

/** Two significant figures, so thresholds read like ones a sponsor would pick. */
export function niceRound(x: number): number {
  if (x < 10) return Math.max(1, Math.round(x));
  const mag = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.round(x / mag) * mag;
}

const fmt = (n: number) => n.toLocaleString("en-US");

// ---------------------------------------------------------------------------
// Builders

export function downloadsQuestion(companyId: string, threshold: number, windowEnd: string, opensAt: string): MarketQuestion {
  const c = getCompany(companyId);
  const q = makeQuestion({ id: `${companyId}-downloads-${windowEnd}`, companyId, metricId: c.questionMetricId, threshold, windowEnd, opensAt });
  const pkg = c.questionMetricId.slice("npm_downloads:".length);
  const start = addDays(windowEnd, -6);
  return {
    id: q.id,
    kind: "downloads",
    companyId,
    metricId: q.metricId,
    threshold,
    windowEnd,
    windowDays: 7,
    opensAt,
    closesAt: `${start}T00:00:00.000Z`,
    text: q.text,
    yesCriteria: `YES if the npm downloads API reports at least ${fmt(threshold)} downloads of the ${pkg} package in total for ${start} through ${windowEnd} (UTC).`,
    noCriteria: `NO if the npm downloads API reports fewer than ${fmt(threshold)} downloads of ${pkg} for ${start} through ${windowEnd} (UTC).`,
    category: "Developer adoption",
    source: "npm",
    resolutionUrl: q.resolutionSource.url,
    resolutionTitle: `npm downloads API: ${pkg}`,
  };
}

export function trafficQuestion(companyId: string, rank: number, windowEnd: string, opensAt: string): MarketQuestion {
  const c = getCompany(companyId);
  const start = addDays(windowEnd, -6);
  return {
    id: `${companyId}-traffic-${windowEnd}`,
    kind: "traffic_rank",
    companyId,
    metricId: metricIds.trancoRank,
    threshold: rank,
    windowEnd,
    windowDays: 7,
    opensAt,
    closesAt: `${start}T00:00:00.000Z`,
    text: `Will ${c.domain} average a top-${fmt(rank)} web rank in the 7 days ending ${shortDate(windowEnd)}?`,
    yesCriteria: `YES if the average of ${c.domain}'s daily Tranco ranks for ${start} through ${windowEnd} (UTC) is ${fmt(rank)} or better (lower). Tranco ranks sites by combined traffic signals; it is a proxy for site usage, not a user count.`,
    noCriteria: `NO if that 7-day average Tranco rank is worse (higher) than ${fmt(rank)}, or if ${c.domain} is unranked on any of those days.`,
    category: "Web traffic",
    source: "tranco",
    resolutionUrl: `https://tranco-list.eu/api/ranks/domain/${c.domain}`,
    resolutionTitle: `Tranco rank history: ${c.domain}`,
  };
}

export function hiringQuestion(companyId: string, postings: number, day: string, opensAt: string): MarketQuestion | null {
  const c = getCompany(companyId);
  if (!c.jobBoard) return null;
  const url =
    c.jobBoard.provider === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${c.jobBoard.board}/jobs`
      : c.jobBoard.provider === "ashby"
        ? `https://api.ashbyhq.com/posting-api/job-board/${c.jobBoard.board}`
        : `https://apply.workable.com/api/v1/widget/accounts/${c.jobBoard.board}`;
  return {
    id: `${companyId}-hiring-${day}`,
    kind: "hiring",
    companyId,
    metricId: metricIds.openJobs,
    threshold: postings,
    windowEnd: day,
    windowDays: 1,
    opensAt,
    closesAt: `${day}T00:00:00.000Z`,
    text: `Will ${c.name} list ${fmt(postings)}+ open jobs on ${shortDate(day)}?`,
    yesCriteria: `YES if ${c.name}'s public job board (${c.jobBoard.provider}) lists at least ${fmt(postings)} open postings when checked on ${day} (UTC).`,
    noCriteria: `NO if it lists fewer than ${fmt(postings)} open postings when checked on ${day} (UTC).`,
    category: "Hiring",
    source: c.jobBoard.provider,
    resolutionUrl: url,
    resolutionTitle: `${c.name} job board (${c.jobBoard.provider})`,
  };
}

export function fundingQuestion(companyId: string, byDay: string, opensAt: string): MarketQuestion | null {
  const c = getCompany(companyId);
  if (!c.secCik) return null;
  const from = dayOf(new Date(opensAt));
  return {
    id: `${companyId}-funding-${byDay}`,
    kind: "funding_filing",
    companyId,
    metricId: metricIds.formDAmountSold,
    threshold: 1,
    windowEnd: byDay,
    windowDays: toDayNumber(byDay) - toDayNumber(from) + 1,
    opensAt,
    closesAt: `${byDay}T00:00:00.000Z`,
    text: `Will ${c.name} file a new SEC Form D by ${shortDate(byDay)}?`,
    yesCriteria: `YES if SEC EDGAR lists a new Form D (not an amendment, D/A) for ${c.name} (CIK ${c.secCik}) filed between ${from} and ${byDay} (UTC). A Form D reports a private securities offering, so it usually signals a fundraise.`,
    noCriteria: `NO if EDGAR lists no new Form D for that filer in that period. Amendments (Form D/A) don't count.`,
    category: "Funding",
    source: "sec_edgar",
    resolutionUrl: `https://data.sec.gov/submissions/CIK${c.secCik.padStart(10, "0")}.json`,
    resolutionTitle: `SEC EDGAR filings: ${c.name}`,
  };
}

// ---------------------------------------------------------------------------
// Baselines

interface SimpleBaselineInput {
  q: MarketQuestion;
  asOf: Date;
  rawProbability: number;
  rawLow: number;
  rawHigh: number;
  /** Weight on the raw numbers; the rest goes to 50% and the uninformative band. */
  weight: number;
  confidence: ModelConfidence;
  methodName: string;
  description: string;
  dataThrough: string | null;
  inputs: DataPoint[];
  notes: string[];
}

function simpleBaseline(i: SimpleBaselineInput): BaselineResult {
  const w = i.weight * (1 - defaultParams.tailShrink);
  const [u0, u1] = defaultParams.uninformativeBand;
  const p = w * i.rawProbability + (1 - w) * 0.5;
  const lowRaw = Math.min(i.rawLow, i.rawProbability);
  const highRaw = Math.max(i.rawHigh, i.rawProbability);
  const urls = [...new Set(i.inputs.map((x) => x.sourceUrl))].slice(0, 5);
  return {
    questionId: i.q.id,
    questionText: i.q.text,
    status: "ok",
    probability: p,
    low: Math.min(p, w * lowRaw + (1 - w) * u0),
    high: Math.max(p, w * highRaw + (1 - w) * u1),
    bandLabel: "model uncertainty",
    asOf: i.asOf.toISOString(),
    confidence: i.confidence,
    method: {
      name: i.methodName,
      version: MODEL_VERSION,
      description: i.description,
      details: {
        dataThrough: i.dataThrough,
        weeksUsed: 0,
        horizonWeeks: null,
        weeklyGrowth: null,
        forecastMedian: null,
        forecastRange80: null,
        lastObservedWeek: null,
        mu: null,
        sigma: null,
        rawProbability: i.rawProbability,
        shrinkWeight: i.weight,
        tailShrink: defaultParams.tailShrink,
        bootstrapReplicates: 0,
        seed: null,
        inputsHash: hashString(JSON.stringify([i.methodName, i.q.id, i.q.threshold, i.q.windowEnd, i.inputs.map((x) => [x.periodEnd, x.value])])),
      },
    },
    inputsUsed: i.inputs.length
      ? [{ metricId: i.q.metricId, source: i.inputs[0]!.source, provenance: "scraped", simulated: false, role: "trend", points: i.inputs.length, periodStart: i.inputs[0]!.periodEnd, periodEnd: i.inputs.at(-1)!.periodEnd }]
      : [],
    sources: urls.map((url) => ({ source: i.inputs[0]!.source, url, fetchedAt: i.inputs.at(-1)?.fetchedAt ?? null })),
    missing: [],
    notes: i.notes,
  };
}

function insufficient(q: MarketQuestion, asOf: Date, why: string): BaselineResult {
  return {
    questionId: q.id,
    questionText: q.text,
    status: "insufficient_data",
    probability: null,
    low: null,
    high: null,
    bandLabel: "model uncertainty",
    asOf: asOf.toISOString(),
    confidence: null,
    method: {
      name: MODEL_NAME,
      version: MODEL_VERSION,
      description: METHOD_DESCRIPTION,
      details: {
        dataThrough: null, weeksUsed: 0, horizonWeeks: null, weeklyGrowth: null, forecastMedian: null, forecastRange80: null,
        lastObservedWeek: null, mu: null, sigma: null, rawProbability: null, shrinkWeight: null, tailShrink: defaultParams.tailShrink,
        bootstrapReplicates: 0, seed: null, inputsHash: hashString(`${q.id}|${why}`),
      },
    },
    inputsUsed: [],
    sources: [],
    missing: [why],
    notes: [],
  };
}

const visible = (points: readonly DataPoint[], metricId: string, asOf: Date) =>
  points
    .filter((p) => p.metricId === metricId && p.provenance === "scraped" && Date.parse(p.availableAt) <= asOf.getTime())
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

/** Assumed spread of weekly change in open postings while only one snapshot exists. */
export const HIRING_WEEKLY_SPREAD = 0.05;

export function baselineFor(q: MarketQuestion, points: readonly DataPoint[], asOf: Date): BaselineResult {
  switch (q.kind) {
    case "downloads": {
      const tq: ThresholdQuestion = makeQuestion({ id: q.id, companyId: q.companyId, metricId: q.metricId, threshold: q.threshold, windowEnd: q.windowEnd, opensAt: q.opensAt });
      return computeBaseline(tq, points, asOf);
    }

    case "traffic_rank": {
      // Same trend model on daily ranks: "7-day average rank <= R" is
      // "7-day rank total < 7R + 1", the complement of "total >= 7R + 1".
      const tq: ThresholdQuestion = { ...makeQuestion({ id: q.id, companyId: q.companyId, metricId: getCompany(q.companyId).questionMetricId, threshold: 1, windowEnd: q.windowEnd, opensAt: q.opensAt }), metricId: q.metricId, threshold: 7 * q.threshold + 1, text: q.text, resolutionSource: { source: "tranco", url: q.resolutionUrl, description: "Tranco daily rank" } };
      const b = computeBaseline(tq, points, asOf);
      if (b.probability === null || b.low === null || b.high === null) return b;
      // The fit ran on 7-day rank totals for the complementary event, so convert
      // its details back to this question: average rank, and P(YES) not P(NO).
      // Otherwise anything that shows them reads a sum of ranks as a rank.
      const d = b.method.details;
      const avg = (total: number | null) => (total === null ? null : total / 7);
      const range = d.forecastRange80;
      return {
        ...b,
        method: {
          ...b.method,
          details: {
            ...d,
            forecastMedian: avg(d.forecastMedian),
            forecastRange80: range ? [range[0] / 7, range[1] / 7] : null,
            lastObservedWeek: d.lastObservedWeek ? { ...d.lastObservedWeek, total: d.lastObservedWeek.total / 7 } : null,
            rawProbability: d.rawProbability === null ? null : 1 - d.rawProbability,
          },
        },
        probability: 1 - b.probability,
        low: 1 - b.high,
        high: 1 - b.low,
        confidence: "low",
        notes: [...b.notes, "Tranco history is only about 6 weeks, so this baseline is low-confidence. Lower rank is better."],
      };
    }

    case "hiring": {
      const snaps = visible(points, q.metricId, asOf);
      const last = snaps.at(-1);
      if (!last) return insufficient(q, asOf, "No job-board snapshot available yet");
      const weeks = Math.max(0.5, (toDayNumber(q.windowEnd) - toDayNumber(last.periodEnd)) / 7);
      const prob = (spread: number) => clamp(normalCdf((Math.log(last.value + 0.5) - Math.log(q.threshold - 0.5)) / (spread * Math.sqrt(weeks))), 0, 1);
      const raw = prob(HIRING_WEEKLY_SPREAD);
      const a = prob(HIRING_WEEKLY_SPREAD * 0.5);
      const z = prob(HIRING_WEEKLY_SPREAD * 2);
      return simpleBaseline({
        q,
        asOf,
        rawProbability: raw,
        rawLow: Math.min(a, z),
        rawHigh: Math.max(a, z),
        weight: snaps.length >= 4 ? 0.8 : 0.5,
        confidence: "low",
        methodName: "hiring-snapshot",
        description: `Starts from today's count of open postings (${fmt(last.value)} on ${last.periodEnd}) and assumes postings drift about ±${Math.round(HIRING_WEEKLY_SPREAD * 100)}% a week with no trend, then pulls toward 50% because only ${snaps.length} snapshot${snaps.length === 1 ? " is" : "s are"} available. Trades never feed the model.`,
        dataThrough: last.periodEnd,
        inputs: snaps,
        notes: [`Only ${snaps.length} job-board snapshot${snaps.length === 1 ? "" : "s"}; the weekly drift is an assumption, not measured.`],
      });
    }

    case "funding_filing": {
      // Rate of new Form D filings (amendments excluded) over the last 3 years.
      const filings = [...new Set(
        visible(points, q.metricId, asOf)
          .concat(visible(points, metricIds.formDOffering, asOf))
          .filter((p) => (p.note ?? "").startsWith("Form D ") && !(p.note ?? "").startsWith("Form D/A"))
          .map((p) => p.periodEnd),
      )].sort();
      const since = addDays(dayOf(asOf), -3 * 365);
      const recent = filings.filter((d) => d >= since);
      const n = recent.length;
      const years = 3;
      const horizonYears = Math.max(0, (toDayNumber(q.windowEnd) - toDayNumber(dayOf(asOf)) + 1) / 365.25);
      const p = (count: number) => 1 - Math.exp(-((count + 0.5) / years) * horizonYears);
      const inputs = visible(points, q.metricId, asOf);
      return simpleBaseline({
        q,
        asOf,
        rawProbability: p(n),
        rawLow: p(Math.max(0, n - Math.sqrt(n))),
        rawHigh: p(n + Math.sqrt(n) + 1),
        weight: n >= 3 ? 0.9 : 0.7,
        confidence: n >= 3 ? "medium" : "low",
        methodName: "formd-filing-rate",
        description: `Uses the company's rate of new Form D filings on SEC EDGAR over the last 3 years (${n}, amendments excluded) to estimate the chance of at least one more by ${q.windowEnd}. Trades never feed the model.`,
        dataThrough: filings.at(-1) ?? null,
        inputs,
        notes: [`${n} new Form D filing${n === 1 ? "" : "s"} since ${since}${filings.length ? `; latest ${filings.at(-1)}` : ""}.`],
      });
    }
  }
}
