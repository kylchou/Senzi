/**
 * Evidence conflict flags, computed in code from the data in a context
 * package. Each flag becomes an EvidenceItem the assistant can explain and
 * cite, with relatedIds pointing at the items it is about. Deterministic and
 * testable; the model explains flags but never invents them.
 */
import { formatPointChange, formatShare } from "../estimates";
import type { EvidenceItem } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** Thresholds for each flag. Kept together so they're easy to review and tune. */
export const FLAG_THRESHOLDS = {
  /** A 7-day move at least this large (0–1)… */
  thinMoveSize: 0.1,
  /** …on fewer forecasters than this is flagged as a thin move. */
  thinMoveForecasters: 10,
  /** Community share this far from the opening baseline… */
  baselineGap: 0.25,
  /** …with at least this many forecasters. */
  baselineGapForecasters: 3,
  /** Calibrated probability this far from the allocation share. */
  calibrationGap: 0.15,
  /** An unverified report this close before a large move is flagged as coinciding with it. */
  unverifiedReportWindowDays: 7,
  /** Open questions whose newest dated evidence is older than this. */
  staleEvidenceDays: 180,
  /** Deadline this close… */
  deadlineSoonDays: 14,
  /** …with fewer forecasters than this. */
  deadlineThinForecasters: 3,
} as const;

export interface FlagInput {
  /** Subject the flags are about (study id or market id), used in flag ids. */
  subjectId: string;
  /** Where flag citations link to. */
  href: string;
  status: string;
  deadline: Date | null;
  now: Date;
  current: { id: string; share: number | null; forecasters: number; totalCredits: number } | null;
  baseline: { id: string; value: number } | null;
  calibrated: { id: string; value: number } | null;
  /** 7-day change and the snapshot ids it was measured between. */
  change7d: { value: number; fromId: string | null; toId: string | null } | null;
  facts: { id: string; verified: boolean; asOf: Date }[];
  news: { id: string; verification: "UNVERIFIED" | "VERIFIED" | "DISPUTED"; publishedAt: Date }[];
  sources: { id: string; publishedAt: Date | null }[];
}

function flag(input: FlagInput, key: string, label: string, value: string, relatedIds: (string | null | undefined)[]): EvidenceItem {
  return {
    id: `flag:${key}:${input.subjectId}`,
    kind: "conflict_flag",
    label,
    value,
    numeric: null,
    asOf: input.now.toISOString(),
    sourceUrl: null,
    caveat: "Computed by VentureCast from the evidence listed; not an independent source.",
    href: input.href,
    relatedIds: [...new Set(relatedIds.filter((id): id is string => !!id))],
  };
}

export function computeConflictFlags(input: FlagInput): EvidenceItem[] {
  const t = FLAG_THRESHOLDS;
  const out: EvidenceItem[] = [];
  const open = input.status === "OPEN";
  const cur = input.current;

  // 1. A large move driven by very few forecasters.
  if (cur && input.change7d && Math.abs(input.change7d.value) >= t.thinMoveSize && cur.forecasters < t.thinMoveForecasters) {
    out.push(
      flag(
        input,
        "thin-move",
        "Large move on thin participation",
        `The YES allocation share moved ${formatPointChange(input.change7d.value)} in 7 days with only ${cur.forecasters} forecaster${cur.forecasters === 1 ? "" : "s"}; a few allocations can cause a move this size.`,
        [input.change7d.fromId, input.change7d.toId, cur.id],
      ),
    );
  }

  // 2. The community disagrees strongly with the opening baseline.
  if (cur?.share != null && input.baseline && cur.forecasters >= t.baselineGapForecasters) {
    const gap = cur.share - input.baseline.value;
    if (Math.abs(gap) >= t.baselineGap) {
      out.push(
        flag(
          input,
          "baseline-gap",
          "Community allocation far from the opening baseline",
          `The YES allocation share (${formatShare(cur.share)}) is ${formatPointChange(gap)} from the opening baseline (${formatShare(input.baseline.value)}).`,
          [cur.id, input.baseline.id],
        ),
      );
    }
  }

  // 3. The calibrated probability and the allocation share disagree.
  if (cur?.share != null && input.calibrated && Math.abs(input.calibrated.value - cur.share) >= t.calibrationGap) {
    out.push(
      flag(
        input,
        "calibration-gap",
        "Calibrated probability differs from the allocation share",
        `The calibrated probability (${formatShare(input.calibrated.value)}) and the YES allocation share (${formatShare(cur.share)}) differ by ${formatPointChange(input.calibrated.value - cur.share).replace(/^[+−±]/, "")}.`,
        [input.calibrated.id, cur.id],
      ),
    );
  }

  // 4. Open for forecasting, but nobody has allocated credits.
  if (open && cur && cur.totalCredits === 0) {
    out.push(flag(input, "no-participation", "No community forecasts yet", "No credits have been allocated, so there is no community allocation share.", [cur.id]));
  }

  // 5. Disputed reports.
  const disputed = input.news.filter((n) => n.verification === "DISPUTED");
  if (disputed.length > 0) {
    out.push(
      flag(
        input,
        "disputed-news",
        "Disputed reports",
        `${disputed.length} news report${disputed.length === 1 ? " has" : "s have"} been marked disputed by VentureCast.`,
        disputed.map((n) => n.id),
      ),
    );
  }

  // 6. All supporting evidence is unverified.
  const verifiedCount = input.facts.filter((f) => f.verified).length + input.news.filter((n) => n.verification === "VERIFIED").length;
  const unverified = [...input.facts.filter((f) => !f.verified).map((f) => f.id), ...input.news.filter((n) => n.verification === "UNVERIFIED").map((n) => n.id)];
  if (verifiedCount === 0 && unverified.length > 0) {
    out.push(
      flag(
        input,
        "unverified-only",
        "Only unverified evidence",
        `None of the ${unverified.length} fact${unverified.length === 1 ? "" : "s"} and reports about this startup ${unverified.length === 1 ? "has" : "have"} been verified.`,
        unverified,
      ),
    );
  }

  // 7. A large recent move coincides with an unverified report.
  if (input.change7d && Math.abs(input.change7d.value) >= t.thinMoveSize) {
    const since = input.now.getTime() - t.unverifiedReportWindowDays * DAY;
    const recent = input.news.filter((n) => n.verification !== "VERIFIED" && n.publishedAt.getTime() >= since);
    if (recent.length > 0) {
      out.push(
        flag(
          input,
          "move-after-unverified-report",
          "Recent move coincides with an unverified report",
          `The ${formatPointChange(input.change7d.value)} move in the last 7 days follows ${recent.length} unverified or disputed report${recent.length === 1 ? "" : "s"} published in the same period.`,
          [input.change7d.toId, cur?.id, ...recent.map((n) => n.id)],
        ),
      );
    }
  }

  // 8. Evidence is stale for an open question.
  if (open) {
    const dates = [
      ...input.facts.map((f) => ({ id: f.id, at: f.asOf })),
      ...input.news.map((n) => ({ id: n.id, at: n.publishedAt })),
      ...input.sources.filter((s) => s.publishedAt).map((s) => ({ id: s.id, at: s.publishedAt! })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    const newest = dates[0];
    const cutoff = input.now.getTime() - t.staleEvidenceDays * DAY;
    if (!newest) {
      out.push(flag(input, "stale-evidence", "No dated evidence", "None of the facts, reports or sources for this question has a publication date.", []));
    } else if (newest.at.getTime() < cutoff) {
      const days = Math.floor((input.now.getTime() - newest.at.getTime()) / DAY);
      out.push(
        flag(input, "stale-evidence", "Stale evidence", `The newest dated evidence is ${days} days old.`, [newest.id]),
      );
    }
  }

  // 9. Deadline close with little participation.
  if (open && input.deadline && cur) {
    const remaining = input.deadline.getTime() - input.now.getTime();
    if (remaining > 0 && remaining <= t.deadlineSoonDays * DAY && cur.forecasters < t.deadlineThinForecasters) {
      out.push(
        flag(
          input,
          "deadline-thin",
          "Deadline soon with little participation",
          `Forecasting closes in ${Math.ceil(remaining / DAY)} days and only ${cur.forecasters} forecaster${cur.forecasters === 1 ? " has" : "s have"} participated.`,
          [cur.id],
        ),
      );
    }
  }

  return out;
}
