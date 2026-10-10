/**
 * Renders a context package as the plain-text evidence list an AI provider
 * receives. One line per item, led by its id, so the model has exactly one
 * way to cite it. Deterministic output (same package → same text) keeps
 * prompt caching effective and makes the prompt easy to test and audit.
 */
import type { ContextPackage, EvidenceKind } from "./types";

export const KIND_LABEL: Record<EvidenceKind, string> = {
  study_definition: "Study definition",
  baseline: "Opening baseline",
  community_estimate: "Community estimate",
  calibrated_probability: "Calibrated probability",
  resolution: "Resolved outcome",
  source: "Cited source",
  verified_fact: "Verified fact",
  unverified_fact: "Unverified fact",
  reported_news: "Reported news",
  indicator: "Public indicator",
  track_record: "Track record",
  startup: "Startup",
  firm_note: "Firm note (private)",
  conflict_flag: "Conflict flag",
};

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function renderContext(pkg: ContextPackage): string {
  const lines = pkg.items.map((i) => {
    const parts = [`[[${i.id}]]`, `${KIND_LABEL[i.kind]}${i.asOf ? ` (as of ${i.asOf.slice(0, 10)})` : ""}:`, oneLine(i.value)];
    if (i.caveat) parts.push(`Caveat: ${oneLine(i.caveat)}`);
    if (i.relatedIds?.length) parts.push(`About: ${i.relatedIds.map((id) => `[[${id}]]`).join(" ")}`);
    if (i.sourceUrl) parts.push(`Source: ${i.sourceUrl}`);
    return parts.join(" ");
  });
  const omitted = pkg.omitted.map((o) => `- ${KIND_LABEL[o.kind as EvidenceKind] ?? "Restricted study questions"}${o.count ? ` (${o.count})` : ""}: ${o.reason}`);
  return [
    "EVIDENCE (cite ids exactly as written, e.g. [[fact:abc]]):",
    ...lines,
    ...(omitted.length ? ["", "NOT INCLUDED:", ...omitted] : []),
  ].join("\n");
}
