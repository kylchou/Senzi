/**
 * Pure assembly of evidence packages. Inputs are already authorized and
 * tier-filtered by services/assistant-context.ts; this module only decides how
 * each record becomes an EvidenceItem (stable id, kind, caveat, link) and how
 * much of each kind fits.
 */
import { ALLOCATION_SHARE_LABEL, DASHBOARD_MOVEMENT_WINDOW_MS } from "../constants";
import { formatPointChange, formatShare, resolveBaseline, sortPoints } from "../estimates";
import type { StudyView } from "../permissions";
import type {
  CompareIndicators,
  EstimatePoint,
  MarketEstimate,
  StartupComparison,
  StartupFactView,
  StartupNewsView,
  StudyNote,
} from "../types";
import { computeConflictFlags } from "./flags";
import { studyKeyStats } from "./stats";
import type { ContextPackage, DataTier, EvidenceItem, OmittedEvidence } from "./types";

/** Most items of each kind sent with one question; newest first. */
export const CONTEXT_LIMITS = { facts: 20, news: 10, notes: 10, indicators: 15 } as const;

export const CAVEATS = {
  allocationShare: "General LMSR market-maker price from all trades. Not a calibrated probability.",
  baseline: "Opening baseline set before forecasting began. A reference point, not a forecast.",
  calibrated: "Calibrated probability from the forecasting engine.",
  studySource: "Cited by the study's author; not independently verified by Senzi.",
  unverifiedFact: "Not yet verified by Senzi.",
  newsUnverified: "Unverified report.",
  newsDisputed: "Disputed: Senzi has marked this report as disputed.",
  indicator: "Public signal scraped from a public source. Not revenue, customers, or valuation.",
  trackRecord: "Track record over this firm-visible set of questions only; small samples vary a lot.",
  firmNote: "Private note from your firm. Opinion, not a verified fact.",
  resolution: "Outcome recorded by Senzi against documented evidence.",
} as const;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Keeps the newest `limit` items and records how many were left out. */
function take<T>(rows: T[], limit: number, kind: OmittedEvidence["kind"], omitted: OmittedEvidence[]): T[] {
  if (rows.length > limit) {
    omitted.push({ kind, count: rows.length - limit, reason: `Only the ${limit} most recent are included.` });
  }
  return rows.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Item builders shared by study and comparison packages
// ---------------------------------------------------------------------------

function factItems(facts: StartupFactView[], href: string): EvidenceItem[] {
  return facts.map((f) => ({
    id: `fact:${f.id}`,
    kind: f.verified ? "verified_fact" : "unverified_fact",
    label: f.label,
    value: `${f.label}: ${f.value} (${f.sourceName})`,
    numeric: null,
    asOf: iso(f.asOf),
    sourceUrl: f.sourceUrl,
    caveat: f.verified ? null : CAVEATS.unverifiedFact,
    href,
  }));
}

function newsItems(news: StartupNewsView[]): EvidenceItem[] {
  return news.map((n) => ({
    id: `news:${n.id}`,
    kind: "reported_news",
    label: n.title,
    value: `${n.title} (${n.publisher}, ${day(n.publishedAt)})${n.summary ? `: ${n.summary}` : ""}`,
    numeric: null,
    asOf: iso(n.publishedAt),
    sourceUrl: n.url,
    caveat: n.verification === "VERIFIED" ? "Verified by Senzi." : n.verification === "DISPUTED" ? CAVEATS.newsDisputed : CAVEATS.newsUnverified,
    href: n.url,
  }));
}

function indicatorItems(startupId: string, indicators: CompareIndicators, href: string): EvidenceItem[] {
  return indicators.rows
    .filter((r) => r.value != null)
    .map((r) => ({
      id: `indicator:${startupId}:${r.metricId}`,
      kind: "indicator",
      label: r.label,
      value: `${r.label}: ${r.value!.toLocaleString("en-US")} ${r.unit}${
        r.change4w != null ? ` (${r.change4w >= 0 ? "+" : "−"}${Math.abs(r.change4w * 100).toFixed(0)}% vs 4 weeks earlier)` : ""
      }`,
      numeric: null,
      asOf: r.asOf,
      sourceUrl: r.sourceUrl,
      caveat: CAVEATS.indicator,
      href,
    }));
}

function estimateItem(marketId: string, e: MarketEstimate, href: string): EvidenceItem {
  const a = e.allocation;
  return {
    id: `market:${marketId}#current`,
    kind: "community_estimate",
    label: ALLOCATION_SHARE_LABEL,
    value:
      e.generalPrice == null
        ? `LMSR price unavailable (${e.participantCount} forecasters).`
        : `${formatShare(e.generalPrice, 1)} General LMSR price (${a.yesCredits.toLocaleString("en-US")} YES / ${a.noCredits.toLocaleString("en-US")} NO virtual credits, ${e.participantCount} forecasters, ${e.forecastCount} forecasts).`,
    numeric: e.generalPrice ?? null,
    asOf: iso(e.asOf),
    sourceUrl: null,
    caveat: CAVEATS.allocationShare,
    href,
  };
}

function resolutionItem(marketId: string, r: NonNullable<MarketEstimate["resolution"]>, href: string): EvidenceItem {
  return {
    id: `market:${marketId}#resolution`,
    kind: "resolution",
    label: "Resolved outcome",
    value: `Resolved ${r.outcome} on ${day(r.resolvedAt)}.${r.evidenceSummary ? ` Evidence: ${r.evidenceSummary}` : ""}${
      r.evidenceUrls.length > 1 ? ` (${r.evidenceUrls.length} evidence links)` : ""
    }`,
    numeric: null,
    asOf: iso(r.resolvedAt),
    sourceUrl: r.evidenceUrls[0] ?? null,
    caveat: CAVEATS.resolution,
    href,
  };
}

// ---------------------------------------------------------------------------
// Study package
// ---------------------------------------------------------------------------

export interface StudyContextInput {
  study: StudyView;
  startup: { id: string; name: string; slug: string; industry: string | null } | null;
  estimate: MarketEstimate | null;
  history: EstimatePoint[];
  facts: StartupFactView[];
  news: StartupNewsView[];
  indicators: CompareIndicators;
  /** null when notes are not included (tier or permissions); the reason goes in `omitted`. */
  notes: StudyNote[] | null;
  notesOmittedReason: string | null;
  tier: DataTier;
  now: Date;
}

/** Latest point with a defined share at or before `at` (input sorted ascending). */
function pointAtOrBefore(sorted: EstimatePoint[], at: number): EstimatePoint | null {
  let found: EstimatePoint | null = null;
  for (const p of sorted) {
    if (p.at.getTime() > at) break;
    if (p.yesShare != null) found = p;
  }
  return found;
}

export function buildStudyContext(input: StudyContextInput): ContextPackage {
  const { study, estimate, now } = input;
  const studyHref = `/vc/studies/${study.id}`;
  const items: EvidenceItem[] = [];
  const omitted: OmittedEvidence[] = [];
  const updated = iso(study.updatedAt);

  const def = (suffix: string, label: string, value: string): EvidenceItem => ({
    id: `study:${study.id}#${suffix}`,
    kind: "study_definition",
    label,
    value,
    numeric: null,
    asOf: updated,
    sourceUrl: null,
    caveat: null,
    href: `${studyHref}#definition`,
  });

  items.push(def("question", "Research question", study.question));
  items.push(def("criteria-yes", "Resolves YES if", study.yesCriteria));
  items.push(def("criteria-no", "Resolves NO if", study.noCriteria));
  if (study.context) items.push(def("context", "Study context", study.context));
  items.push(
    def(
      "status",
      "Status and deadline",
      `Status ${study.status}; forecasting ${study.status === "OPEN" ? "closes" : "closed or closes"} ${study.deadline.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    ),
  );
  if (input.startup) {
    items.push({
      id: `startup:${input.startup.id}`,
      kind: "startup",
      label: input.startup.name,
      value: `${input.startup.name}${input.startup.industry ? ` (${input.startup.industry})` : ""}`,
      numeric: null,
      asOf: null,
      sourceUrl: null,
      caveat: null,
      href: `/startups/${input.startup.slug}`,
    });
  }

  // Baseline: the market's recorded baseline wins over the study proposal.
  const baseline = resolveBaseline(study, estimate);
  const baselineId = baseline.source === "market" && study.marketId ? `market:${study.marketId}#baseline` : `study:${study.id}#baseline`;
  if (baseline.value != null) {
    items.push({
      id: baselineId,
      kind: "baseline",
      label: "Opening baseline",
      value: `${formatShare(baseline.value)}${baseline.methodology ? `. Method: ${baseline.methodology}` : ""}`,
      numeric: baseline.value,
      asOf: updated,
      sourceUrl: null,
      caveat: CAVEATS.baseline,
      href: `${studyHref}#estimates`,
    });
  }

  for (const s of study.sources) {
    items.push({
      id: `source:${s.id}`,
      kind: "source",
      label: s.title,
      value: `${s.title}${s.publisher ? ` (${s.publisher}${s.publishedAt ? `, ${day(s.publishedAt)}` : ""})` : s.publishedAt ? ` (${day(s.publishedAt)})` : ""}`,
      numeric: null,
      asOf: iso(s.publishedAt),
      sourceUrl: s.url,
      caveat: CAVEATS.studySource,
      href: s.url,
    });
  }

  // Market measurements.
  let change7d: { value: number; fromId: string | null; toId: string | null } | null = null;
  let currentId: string | null = null;
  let calibratedId: string | null = null;
  let firstPoint: { id: string; share: number; forecasters: number; at: Date } | null = null;
  if (estimate && study.marketId) {
    const current = estimateItem(study.marketId, estimate, `${studyHref}#estimates`);
    currentId = current.id;
    items.push(current);

    if (estimate.calibratedProbability) {
      calibratedId = `market:${study.marketId}#calibrated`;
      items.push({
        id: calibratedId,
        kind: "calibrated_probability",
        label: "Calibrated probability",
        value: formatShare(estimate.calibratedProbability.value, 1),
        numeric: estimate.calibratedProbability.value,
        asOf: iso(estimate.asOf),
        sourceUrl: null,
        caveat: CAVEATS.calibrated,
        href: `${studyHref}#estimates`,
      });
    }

    // Three snapshots tell the trend: the first, the one a week ago, and the latest.
    const sorted = sortPoints(input.history).filter((p) => p.yesShare != null && p.id);
    const latest = sorted.at(-1) ?? null;
    const weekAgo = pointAtOrBefore(sorted, now.getTime() - DASHBOARD_MOVEMENT_WINDOW_MS);
    const first = sorted[0] ?? null;
    const picked = new Map<string, { p: EstimatePoint; label: string }>();
    if (first) picked.set(first.id!, { p: first, label: "Earliest recorded crowd price" });
    if (weekAgo) picked.set(weekAgo.id!, { p: weekAgo, label: "Crowd price 7 days ago" });
    if (latest) picked.set(latest.id!, { p: latest, label: "Latest recorded crowd price" });
    for (const { p, label } of picked.values()) {
      items.push({
        id: `snapshot:${p.id}`,
        kind: "community_estimate",
        label,
        value: `${formatShare(p.yesShare, 1)} General LMSR price with ${p.participantCount} forecasters on ${day(p.at)}.`,
        numeric: p.yesShare,
        asOf: iso(p.at),
        sourceUrl: null,
        caveat: CAVEATS.allocationShare,
        href: `${studyHref}#trend`,
      });
    }
    if (sorted.length > picked.size) {
      omitted.push({ kind: "community_estimate", count: sorted.length - picked.size, reason: "Only the earliest, 7-day-ago and latest snapshots are included." });
    }
    if (first && first.id !== latest?.id) {
      firstPoint = { id: `snapshot:${first.id}`, share: first.yesShare!, forecasters: first.participantCount, at: first.at };
    }
    if (latest && weekAgo && latest.id !== weekAgo.id) {
      change7d = { value: latest.yesShare! - weekAgo.yesShare!, fromId: `snapshot:${weekAgo.id}`, toId: `snapshot:${latest.id}` };
    }

    if (estimate.resolution) items.push(resolutionItem(study.marketId, estimate.resolution, `${studyHref}#outcome`));
  }

  // Startup facts, news and indicators.
  const startupHref = input.startup ? `/startups/${input.startup.slug}` : studyHref;
  const facts = take(input.facts, CONTEXT_LIMITS.facts, "verified_fact", omitted);
  const news = take(input.news, CONTEXT_LIMITS.news, "reported_news", omitted);
  items.push(...factItems(facts, startupHref), ...newsItems(news));
  if (input.startup) {
    if (input.indicators.status === "ok") {
      items.push(...take(indicatorItems(input.startup.id, input.indicators, startupHref), CONTEXT_LIMITS.indicators, "indicator", omitted));
    } else {
      omitted.push({
        kind: "indicator",
        count: 0,
        reason: input.indicators.status === "unavailable" ? "Public indicators are temporarily unavailable." : "This startup isn't tracked by the indicator model.",
      });
    }
  }

  // Private notes (extended tier, firm members only).
  if (input.notes) {
    for (const n of take(input.notes, CONTEXT_LIMITS.notes, "firm_note", omitted)) {
      items.push({
        id: `note:${n.id}`,
        kind: "firm_note",
        label: "Firm note",
        value: n.body,
        numeric: null,
        asOf: iso(n.createdAt),
        sourceUrl: null,
        caveat: CAVEATS.firmNote,
        href: `${studyHref}#notes`,
      });
    }
  } else if (input.notesOmittedReason) {
    omitted.push({ kind: "firm_note", count: 0, reason: input.notesOmittedReason });
  }

  const stats = studyKeyStats({
    id: `stats:${study.id}`,
    href: `${studyHref}#estimates`,
    now,
    status: study.status,
    deadline: study.deadline,
    current: estimate && currentId ? { id: currentId, share: estimate.allocation.yesShare, forecasters: estimate.participantCount } : null,
    baseline: baseline.value != null ? { id: baselineId, value: baseline.value } : null,
    first: firstPoint,
    change7d,
    facts: facts.map((f) => ({ id: `fact:${f.id}`, verified: f.verified, asOf: f.asOf })),
    news: news.map((n) => ({ id: `news:${n.id}`, verification: n.verification, publishedAt: n.publishedAt })),
  });
  if (stats) items.push(stats);

  items.push(
    ...computeConflictFlags({
      subjectId: study.id,
      href: `${studyHref}#estimates`,
      status: study.status,
      deadline: study.deadline,
      now,
      current:
        estimate && currentId
          ? { id: currentId, share: (estimate.generalPrice ?? null), forecasters: estimate.participantCount, totalCredits: estimate.allocation.totalCredits }
          : null,
      baseline: baseline.value != null ? { id: baselineId, value: baseline.value } : null,
      calibrated: estimate?.calibratedProbability && calibratedId ? { id: calibratedId, value: estimate.calibratedProbability.value } : null,
      change7d,
      facts: facts.map((f) => ({ id: `fact:${f.id}`, verified: f.verified, asOf: f.asOf })),
      news: news.map((n) => ({ id: `news:${n.id}`, verification: n.verification, publishedAt: n.publishedAt })),
      sources: study.sources.map((s) => ({ id: `source:${s.id}`, publishedAt: s.publishedAt })),
    }),
  );

  return { scope: { kind: "study", studyId: study.id }, tier: input.tier, builtAt: now.toISOString(), items, omitted };
}

// ---------------------------------------------------------------------------
// Comparison package
// ---------------------------------------------------------------------------

export interface ComparisonContextInput {
  comparison: StartupComparison;
  facts: StartupFactView[];
  news: StartupNewsView[];
  /** Questions dropped because their study isn't allowed at this tier. */
  restrictedQuestionsOmitted: number;
  tier: DataTier;
  now: Date;
}

export function buildComparisonContext(input: ComparisonContextInput): ContextPackage {
  const items: EvidenceItem[] = [];
  const omitted: OmittedEvidence[] = [];
  if (input.restrictedQuestionsOmitted > 0) {
    omitted.push({
      kind: "restricted_study",
      count: input.restrictedQuestionsOmitted,
      reason: "Questions from restricted studies aren't approved for the assistant at this data tier.",
    });
  }

  for (const col of input.comparison.columns) {
    const s = col.startup;
    const startupHref = `/startups/${s.slug}`;
    const compareHref = `/vc/compare?ids=${input.comparison.columns.map((c) => c.startup.id).join(",")}`;
    items.push({
      id: `startup:${s.id}`,
      kind: "startup",
      label: s.name,
      value: `${s.name}${s.industry ? ` (${s.industry})` : ""}`,
      numeric: null,
      asOf: null,
      sourceUrl: null,
      caveat: null,
      href: startupHref,
    });

    for (const q of [...col.open, ...col.closed, ...col.resolved]) {
      const href = q.href ?? compareHref;
      items.push({
        id: `market:${q.marketId}#current`,
        kind: "community_estimate",
        label: `${ALLOCATION_SHARE_LABEL}: ${q.question}`,
        value:
          q.allocationShare == null
            ? `${q.question} No credits allocated yet. Status ${q.status}.`
            : `${q.question} ${formatShare(q.allocationShare, 1)} General LMSR price, ${q.forecasters} forecasters. Status ${q.status}${
                q.change7d != null ? `; ${formatPointChange(q.change7d)} over 7 days` : ""
              }.`,
        numeric: q.allocationShare,
        asOf: input.now.toISOString(),
        sourceUrl: null,
        caveat: CAVEATS.allocationShare,
        href,
      });
      if (q.openingBaseline != null) {
        items.push({
          id: `market:${q.marketId}#baseline`,
          kind: "baseline",
          label: `Opening baseline: ${q.question}`,
          value: formatShare(q.openingBaseline),
          numeric: q.openingBaseline,
          asOf: null,
          sourceUrl: null,
          caveat: CAVEATS.baseline,
          href,
        });
      }
      if (q.calibratedProbability != null) {
        items.push({
          id: `market:${q.marketId}#calibrated`,
          kind: "calibrated_probability",
          label: `Calibrated probability: ${q.question}`,
          value: formatShare(q.calibratedProbability, 1),
          numeric: q.calibratedProbability,
          asOf: null,
          sourceUrl: null,
          caveat: CAVEATS.calibrated,
          href,
        });
      }
      if (q.outcome) {
        items.push({
          id: `market:${q.marketId}#resolution`,
          kind: "resolution",
          label: `Resolved outcome: ${q.question}`,
          value: `Resolved ${q.outcome}.`,
          numeric: null,
          asOf: null,
          sourceUrl: null,
          caveat: CAVEATS.resolution,
          href,
        });
      }
      // Per-question flags from the measurements the comparison carries. Evidence-quality
      // flags (news, facts) are computed once per startup below.
      items.push(
        ...computeConflictFlags({
          subjectId: q.marketId,
          href,
          status: "COMPARISON",
          deadline: null,
          now: input.now,
          current: { id: `market:${q.marketId}#current`, share: q.allocationShare, forecasters: q.forecasters, totalCredits: 0 },
          baseline: q.openingBaseline != null ? { id: `market:${q.marketId}#baseline`, value: q.openingBaseline } : null,
          calibrated: q.calibratedProbability != null ? { id: `market:${q.marketId}#calibrated`, value: q.calibratedProbability } : null,
          change7d: q.change7d != null ? { value: q.change7d, fromId: null, toId: null } : null,
          facts: [],
          news: [],
          sources: [],
        }),
      );
    }

    const t = col.trackRecord;
    items.push({
      id: `trackrecord:${s.id}`,
      kind: "track_record",
      label: `Track record: ${s.name}`,
      value:
        t.decided === 0
          ? "No resolved questions yet."
          : `${t.yes} of ${t.decided} resolved questions resolved YES${t.yesRateInterval ? ` (95% interval ${formatShare(t.yesRateInterval[0])}–${formatShare(t.yesRateInterval[1])})` : ""}. Brier score: opening baseline ${t.baselineBrier?.toFixed(3) ?? "—"}, final LMSR price ${t.allocationShareBrier?.toFixed(3) ?? "—"}.${t.voided ? ` ${t.voided} voided.` : ""}`,
      numeric: null,
      asOf: input.now.toISOString(),
      sourceUrl: null,
      caveat: CAVEATS.trackRecord,
      href: compareHref,
    });

    const facts = take(input.facts.filter((f) => f.startupId === s.id), CONTEXT_LIMITS.facts, "verified_fact", omitted);
    const news = take(input.news.filter((n) => n.startupId === s.id), CONTEXT_LIMITS.news, "reported_news", omitted);
    items.push(...factItems(facts, startupHref), ...newsItems(news));
    if (col.indicators.status === "ok") items.push(...indicatorItems(s.id, col.indicators, startupHref));

    // Evidence-quality flags per startup (disputed, unverified-only).
    items.push(
      ...computeConflictFlags({
        subjectId: s.id,
        href: startupHref,
        status: "COMPARISON",
        deadline: null,
        now: input.now,
        current: null,
        baseline: null,
        calibrated: null,
        change7d: null,
        facts: facts.map((f) => ({ id: `fact:${f.id}`, verified: f.verified, asOf: f.asOf })),
        news: news.map((n) => ({ id: `news:${n.id}`, verification: n.verification, publishedAt: n.publishedAt })),
        sources: [],
      }),
    );
  }

  if (input.comparison.columns.some((c) => c.indicators.status !== "ok")) {
    omitted.push({ kind: "indicator", count: 0, reason: "Public indicators are unavailable or not tracked for some startups." });
  }

  return {
    scope: { kind: "comparison", startupIds: input.comparison.columns.map((c) => c.startup.id) },
    tier: input.tier,
    builtAt: input.now.toISOString(),
    items: dedupeById(items),
    omitted,
  };
}

/** The same market can appear under two startups' columns only by mistake; keep the first. */
function dedupeById(items: EvidenceItem[]): EvidenceItem[] {
  return [...new Map(items.map((i) => [i.id, i])).values()];
}
