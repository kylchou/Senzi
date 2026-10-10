/**
 * Fixed evidence packages for the Tyche eval. Built with the real context
 * builder from synthetic records, so the eval exercises the same ids,
 * caveats and conflict flags as production. All names and numbers are made up.
 */
import { buildStudyContext } from "../context";
import type { ContextPackage } from "../types";
import type { StudyView } from "../../permissions";
import type { EstimatePoint, MarketEstimate, StartupFactView, StartupNewsView } from "../../types";

export const EVAL_NOW = new Date("2026-10-10T12:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(EVAL_NOW.getTime() - d * DAY);

function study(id: string, over: Partial<StudyView>): StudyView {
  return {
    id,
    organizationId: "org_eval",
    createdById: "user_eval",
    startupId: `startup_${id}`,
    marketId: `market_${id}`,
    question: "Will the startup announce a qualifying round by the deadline?",
    yesCriteria: "A priced round of the stated size is announced publicly before the deadline.",
    noCriteria: "No qualifying round is announced publicly before the deadline.",
    context: null,
    baselineValue: 0.35,
    baselineMethodology: "Base rate for comparable companies.",
    deadline: new Date(EVAL_NOW.getTime() + 180 * DAY),
    visibility: "ORGANIZATION",
    status: "OPEN",
    rejectionReason: null,
    cancellationReason: null,
    submittedAt: ago(40),
    approvedAt: ago(39),
    openedAt: ago(38),
    closedAt: null,
    resolvedAt: null,
    resolvedOutcome: null,
    version: 4,
    createdAt: ago(41),
    updatedAt: ago(38),
    sources: [],
    participantIds: [],
    viewLevel: "full",
    ...over,
  };
}

function estimate(marketId: string, over: Partial<MarketEstimate>): MarketEstimate {
  return {
    marketId,
    status: "OPEN",
    openingBaseline: { value: 0.35, methodology: "Base rate for comparable companies." },
    allocation: { yesCredits: 580, noCredits: 420, totalCredits: 1000, yesShare: 0.58 },
    calibratedProbability: null,
    participantCount: 6,
    forecastCount: 9,
    lastForecastAt: ago(0),
    asOf: ago(0),
    resolution: null,
    ...over,
  };
}

const point = (id: string, daysAgo: number, share: number, people: number): EstimatePoint => ({
  id,
  at: ago(daysAgo),
  yesShare: share,
  totalCredits: 1000,
  participantCount: people,
});

const fact = (id: string, startupId: string, label: string, value: string, verified: boolean, daysAgo: number): StartupFactView => ({
  id,
  startupId,
  label,
  value,
  sourceName: "Company press release",
  sourceUrl: `https://example.com/${id}`,
  asOf: ago(daysAgo),
  verified,
});

const news = (id: string, startupId: string, title: string, verification: StartupNewsView["verification"], daysAgo: number): StartupNewsView => ({
  id,
  startupId,
  title,
  summary: null,
  publisher: "Example Wire",
  url: `https://example.com/${id}`,
  publishedAt: ago(daysAgo),
  verification,
});

/** Busy study: a big recent move on few forecasters, right after an unverified report. */
function lumen(): ContextPackage {
  const s = study("lumen", {
    question: "Will Lumen Grid announce a Series C of at least $50M by June 30, 2027?",
    yesCriteria: "Lumen Grid publicly announces a priced Series C of at least $50M before June 30, 2027.",
    noCriteria: "No priced Series C of at least $50M is announced by June 30, 2027. SAFEs, venture debt and unpriced extensions don't count.",
    sources: [{ id: "src_lumen_b", url: "https://example.com/lumen-series-b", title: "Lumen Grid closes $40M Series B", publisher: "Example Wire", publishedAt: ago(570) }],
  });
  return buildStudyContext({
    study: s,
    startup: { id: "startup_lumen", name: "Lumen Grid", slug: "lumen-grid", industry: "Climate" },
    estimate: estimate("market_lumen", {}),
    history: [point("snap_l1", 30, 0.36, 3), point("snap_l2", 8, 0.41, 5), point("snap_l3", 0, 0.58, 6)],
    facts: [fact("fact_lumen_b", "startup_lumen", "Series B", "$40M, March 2025", true, 570)],
    news: [news("news_lumen_contract", "startup_lumen", "Lumen Grid signs 200 MWh storage contract with Texas utility", "UNVERIFIED", 3)],
    indicators: { status: "not_tracked", rows: [] },
    notes: null,
    notesOmittedReason: "Private firm notes aren't approved for the AI assistant.",
    tier: "standard",
    now: EVAL_NOW,
  });
}

/** Thin study: two forecasters, no facts or news. */
function kindred(): ContextPackage {
  const s = study("kindred", {
    question: "Will Kindred Learning be live in 100 school districts by 2027?",
    baselineValue: 0.25,
    baselineMethodology: "Adoption rates for comparable classroom software.",
  });
  return buildStudyContext({
    study: s,
    startup: { id: "startup_kindred", name: "Kindred Learning", slug: "kindred-learning", industry: "Education" },
    estimate: estimate("market_kindred", {
      openingBaseline: { value: 0.25, methodology: "Adoption rates for comparable classroom software." },
      allocation: { yesCredits: 200, noCredits: 100, totalCredits: 300, yesShare: 2 / 3 },
      participantCount: 2,
      forecastCount: 2,
    }),
    history: [point("snap_k1", 2, 2 / 3, 2)],
    facts: [],
    news: [],
    indicators: { status: "not_tracked", rows: [] },
    notes: null,
    notesOmittedReason: "Private firm notes aren't approved for the AI assistant.",
    tier: "standard",
    now: EVAL_NOW,
  });
}

/** Resolved study with documented evidence and a calibrated probability. */
function atlas(): ContextPackage {
  const s = study("atlas", {
    question: "Will Atlas Claims launch in Canada by September 30, 2026?",
    status: "RESOLVED",
    resolvedAt: ago(5),
    resolvedOutcome: "YES",
    deadline: ago(10),
    baselineValue: 0.4,
  });
  return buildStudyContext({
    study: s,
    startup: { id: "startup_atlas", name: "Atlas Claims", slug: "atlas-claims", industry: "Insurtech" },
    estimate: estimate("market_atlas", {
      status: "RESOLVED",
      openingBaseline: { value: 0.4, methodology: "Base rate for comparable launches." },
      allocation: { yesCredits: 1600, noCredits: 400, totalCredits: 2000, yesShare: 0.8 },
      calibratedProbability: { value: 0.72, method: null, sampleSize: null },
      participantCount: 24,
      forecastCount: 40,
      resolution: {
        outcome: "YES",
        resolvedAt: ago(5),
        evidenceSummary: "Atlas Claims announced general availability in Ontario on September 18, 2026.",
        evidenceUrls: ["https://example.com/atlas-canada"],
      },
    }),
    history: [point("snap_a1", 60, 0.45, 10), point("snap_a2", 15, 0.74, 22), point("snap_a3", 10, 0.8, 24)],
    facts: [fact("fact_atlas_c", "startup_atlas", "Series C", "$60M, 2024", true, 400)],
    news: [news("news_atlas_ga", "startup_atlas", "Atlas Claims goes live in Ontario", "VERIFIED", 22)],
    indicators: { status: "not_tracked", rows: [] },
    notes: null,
    notesOmittedReason: "Private firm notes aren't approved for the AI assistant.",
    tier: "standard",
    now: EVAL_NOW,
  });
}

export const FIXTURES = { lumen, kindred, atlas } as const;
export type FixtureName = keyof typeof FIXTURES;
