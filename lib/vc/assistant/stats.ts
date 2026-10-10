/**
 * Key stats, computed in code from the data in a study's context package:
 * where the allocation share sits against the opening baseline, how far it
 * has moved, how participation grew, how long until forecasting closes, and
 * how much of the evidence is verified. The model quotes these instead of
 * doing arithmetic itself, so every derived number is exact and citable.
 */
import { formatPointChange, formatShare } from "../estimates";
import type { EvidenceItem } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export interface KeyStatsInput {
  id: string;
  href: string;
  now: Date;
  status: string;
  deadline: Date | null;
  current: { id: string; share: number | null; forecasters: number } | null;
  baseline: { id: string; value: number } | null;
  first: { id: string; share: number; forecasters: number; at: Date } | null;
  change7d: { value: number; fromId: string | null; toId: string | null } | null;
  facts: { id: string; verified: boolean; asOf: Date }[];
  news: { id: string; verification: "UNVERIFIED" | "VERIFIED" | "DISPUTED"; publishedAt: Date }[];
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function newest(dates: Date[]): Date | null {
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

export function studyKeyStats(input: KeyStatsInput): EvidenceItem | null {
  const lines: string[] = [];
  const related = new Set<string>();
  const share = input.current?.share ?? null;

  if (share != null && input.current) {
    related.add(input.current.id);
    if (input.baseline) {
      related.add(input.baseline.id);
      const gap = share - input.baseline.value;
      lines.push(
        `YES allocation share ${formatShare(share, 1)} is ${formatPointChange(gap).replace(/^[+−±]/, "")} ${gap >= 0 ? "above" : "below"} the ${formatShare(input.baseline.value)} opening baseline.`,
      );
    }
    if (input.first) {
      related.add(input.first.id);
      lines.push(
        `Change since the first recorded snapshot on ${day(input.first.at)}: ${formatPointChange(share - input.first.share)} (${formatShare(input.first.share, 1)} to ${formatShare(share, 1)}), with forecasters growing from ${input.first.forecasters} to ${input.current.forecasters}.`,
      );
    }
    if (input.change7d) lines.push(`Change over the last 7 days: ${formatPointChange(input.change7d.value)}.`);
  }

  if (input.deadline) {
    const left = daysBetween(input.now, input.deadline);
    if (input.status === "OPEN" && left >= 0) lines.push(`Forecasting closes in ${plural(left, "day")} (${day(input.deadline)}).`);
  }

  const verifiedFacts = input.facts.filter((f) => f.verified);
  const counts = {
    verified: verifiedFacts.length + input.news.filter((n) => n.verification === "VERIFIED").length,
    unverified: input.facts.length - verifiedFacts.length + input.news.filter((n) => n.verification === "UNVERIFIED").length,
    disputed: input.news.filter((n) => n.verification === "DISPUTED").length,
  };
  if (input.facts.length + input.news.length > 0) {
    lines.push(
      `Startup evidence: ${plural(counts.verified, "verified item")}, ${plural(counts.unverified, "unverified item")}, ${plural(counts.disputed, "disputed item")}.`,
    );
  }
  const latestVerified = newest([...verifiedFacts.map((f) => f.asOf), ...input.news.filter((n) => n.verification === "VERIFIED").map((n) => n.publishedAt)]);
  if (latestVerified) lines.push(`Newest verified evidence is from ${day(latestVerified)}, ${plural(daysBetween(latestVerified, input.now), "day")} ago.`);
  const latestNews = newest(input.news.map((n) => n.publishedAt));
  if (latestNews) lines.push(`Newest news report is from ${day(latestNews)}, ${plural(daysBetween(latestNews, input.now), "day")} ago.`);

  if (!lines.length) return null;
  return {
    id: input.id,
    kind: "key_stats",
    label: "Key stats",
    value: lines.join(" "),
    numeric: null,
    asOf: input.now.toISOString(),
    sourceUrl: null,
    caveat: "Computed by VentureCast from the evidence listed; not an independent source. The allocation share is where virtual credits were placed, not a probability.",
    href: input.href,
    relatedIds: [...related],
  };
}
