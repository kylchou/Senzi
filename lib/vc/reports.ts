/**
 * Pure report construction and export formatting. Inputs come from the study
 * service (already permission-checked); nothing here touches storage.
 */
import {
  ALLOCATION_SHARE_LABEL,
  DASHBOARD_MOVEMENT_WINDOW_MS,
  STANDARD_LIMITATIONS,
  VC_DISCLAIMER,
} from "./constants";
import {
  describeFreshness,
  describeUncertainty,
  downsample,
  formatPointChange,
  formatShare,
  resolveBaseline,
  shareChangeOverWindow,
  shareChangeSinceOpen,
  shareRange,
  sortPoints,
} from "./estimates";
import type {
  EstimatePoint,
  MarketEstimate,
  StartupSummary,
  Study,
  StudyEvent,
  StudyReport,
} from "./types";

export interface ReportInputs {
  study: Study;
  organization: { id: string; name: string };
  startup: Pick<StartupSummary, "id" | "name"> | null;
  estimate: MarketEstimate | null;
  history: EstimatePoint[];
  events: StudyEvent[];
  now: Date;
}

export function buildStudyReport(input: ReportInputs): StudyReport {
  const { study, estimate, now } = input;
  const history = sortPoints(input.history);
  const baseline = resolveBaseline(study, estimate);
  const freshness = describeFreshness(estimate, study.status, now);

  const uncertainty = describeUncertainty(estimate, history, freshness);
  const limitations = [...STANDARD_LIMITATIONS];
  if (baseline.source === null) limitations.push("No opening baseline was recorded for this study.");

  return {
    reportVersion: 1,
    generatedAt: now.toISOString(),
    organization: input.organization,
    study: {
      id: study.id,
      question: study.question,
      yesCriteria: study.yesCriteria,
      noCriteria: study.noCriteria,
      context: study.context,
      status: study.status,
      visibility: study.visibility,
      deadline: study.deadline.toISOString(),
      startup: input.startup ? { id: input.startup.id, name: input.startup.name } : null,
    },
    baseline,
    communityEstimate: estimate
      ? {
          label: `${ALLOCATION_SHARE_LABEL} (not a calibrated probability)`,
          yesAllocationShare: (estimate.generalPrice ?? null),
          yesCredits: estimate.allocation.yesCredits,
          noCredits: estimate.allocation.noCredits,
          totalCredits: estimate.allocation.totalCredits,
          asOf: estimate.asOf.toISOString(),
          lastForecastAt: estimate.lastForecastAt?.toISOString() ?? null,
        }
      : null,
    calibratedProbability: estimate?.calibratedProbability ?? null,
    participation: estimate
      ? { participantCount: estimate.participantCount, forecastCount: estimate.forecastCount }
      : null,
    trend: {
      points: downsample(history).map((p) => ({ at: p.at.toISOString(), yesShare: p.yesShare })),
      changeSinceOpen: shareChangeSinceOpen(history, baseline.value),
      change7d: shareChangeOverWindow(history, DASHBOARD_MOVEMENT_WINDOW_MS, now),
      range: shareRange(history),
    },
    sources: study.sources.map((s) => ({
      title: s.title,
      url: s.url,
      publisher: s.publisher,
      publishedAt: s.publishedAt?.toISOString() ?? null,
    })),
    resolution: estimate?.resolution
      ? {
          outcome: estimate.resolution.outcome,
          resolvedAt: estimate.resolution.resolvedAt.toISOString(),
          evidenceUrls: estimate.resolution.evidenceUrls,
          evidenceSummary: estimate.resolution.evidenceSummary,
        }
      : study.resolvedOutcome && study.resolvedAt
        ? {
            outcome: study.resolvedOutcome,
            resolvedAt: study.resolvedAt.toISOString(),
            evidenceUrls: [],
            evidenceSummary: null,
          }
        : null,
    timeline: input.events.map((e) => ({
      at: e.createdAt.toISOString(),
      action: e.action,
      toStatus: e.toStatus,
      reason: e.reason,
    })),
    uncertainty,
    limitations,
    disclaimer: VC_DISCLAIMER,
  };
}

/** " (method, n=…)" when calibration metadata is known, else "". */
export function describeCalibration(c: { method: string | null; sampleSize: number | null }): string {
  const parts = [c.method, c.sampleSize != null ? `n=${c.sampleSize}` : null].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const mdEscape = (s: string) => s.replace(/([\\`*_[\]#|<>])/g, "\\$1");
const mdUrl = (u: string) => u.replace(/[()<>\s]/g, (c) =>
  `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
);

export function reportToMarkdown(r: StudyReport): string {
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  push(`# ${mdEscape(r.study.question)}`, "");
  push(`*${mdEscape(r.organization.name)} · Generated ${r.generatedAt} · Status: ${r.study.status} · Visibility: ${r.study.visibility}*`, "");
  push(`> ${r.disclaimer}`, "");

  push("## Research question", "");
  push(`- **Startup:** ${r.study.startup ? mdEscape(r.study.startup.name) : "—"}`);
  push(`- **Forecast deadline:** ${date(r.study.deadline)}`);
  push(`- **Resolves YES if:** ${mdEscape(r.study.yesCriteria)}`);
  push(`- **Resolves NO if:** ${mdEscape(r.study.noCriteria)}`, "");
  if (r.study.context) push("### Context", "", mdEscape(r.study.context), "");

  push("## Opening baseline", "");
  push(`- **Value:** ${formatShare(r.baseline.value)}${r.baseline.source ? ` (recorded on the ${r.baseline.source})` : ""}`);
  push(`- **Methodology:** ${r.baseline.methodology ? mdEscape(r.baseline.methodology) : "Not provided"}`, "");

  push("## Community estimate", "");
  if (r.communityEstimate) {
    push(`- **${r.communityEstimate.label}:** ${formatShare(r.communityEstimate.yesAllocationShare, 1)}`);
    push(`- **Credits allocated:** ${r.communityEstimate.yesCredits} YES / ${r.communityEstimate.noCredits} NO (${r.communityEstimate.totalCredits} total, virtual)`);
    push(`- **Data as of:** ${r.communityEstimate.asOf}; last forecast ${r.communityEstimate.lastForecastAt ?? "—"}`);
  } else {
    push("No community forecasts yet.");
  }
  push(
    `- **Calibrated probability:** ${
      r.calibratedProbability
        ? `${formatShare(r.calibratedProbability.value, 1)}${describeCalibration(r.calibratedProbability)}`
        : "Not available — insufficient resolved history"
    }`,
    "",
  );

  push("## Participation", "");
  push(
    r.participation
      ? `${r.participation.participantCount} participants, ${r.participation.forecastCount} forecasts.`
      : "No participation yet.",
    "",
  );

  push("## Historical trend", "");
  push(`- **Change since open:** ${formatPointChange(r.trend.changeSinceOpen)}`);
  push(`- **Change over last 7 days:** ${formatPointChange(r.trend.change7d)}`);
  push(`- **Range:** ${r.trend.range ? `${formatShare(r.trend.range.min)} – ${formatShare(r.trend.range.max)}` : "—"}`);
  push(`- **Data points:** ${r.trend.points.length}`, "");

  if (r.resolution) {
    push("## Resolution", "");
    push(`- **Outcome:** ${r.resolution.outcome} (resolved ${date(r.resolution.resolvedAt)})`);
    if (r.resolution.evidenceSummary) push(`- **Evidence:** ${mdEscape(r.resolution.evidenceSummary)}`);
    for (const url of r.resolution.evidenceUrls) push(`- **Evidence link:** <${mdUrl(url)}>`);
    push("");
  }

  push("## Sources", "");
  if (r.sources.length === 0) push("No sources recorded.");
  for (const s of r.sources) {
    push(`- [${mdEscape(s.title)}](${mdUrl(s.url)})${s.publisher ? ` — ${mdEscape(s.publisher)}` : ""}${s.publishedAt ? `, ${date(s.publishedAt)}` : ""}`);
  }
  push("");

  push("## Uncertainty", "");
  push(...(r.uncertainty.length ? r.uncertainty.map((u) => `- ${u}`) : ["- No specific uncertainty flags."]), "");
  push("## Limitations", "", ...r.limitations.map((l) => `- ${l}`), "");

  push("## Timeline", "");
  for (const t of r.timeline) push(`- ${t.at}: ${t.action} → ${t.toStatus}${t.reason ? ` (${mdEscape(t.reason)})` : ""}`);
  push("");
  return lines.join("\n");
}

/** Neutralizes CSV/formula injection and quotes fields. */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(r: StudyReport): string {
  // Saved v1 documents can predate LMSR. Preserve their original meaning.
  const label = r.communityEstimate?.label ?? "";
  const priceField = label.includes("LMSR") || label.includes("Crowd price") ? "general_lmsr_price" : "community_yes_allocation_share";
  const rows: unknown[][] = [
    ["field", "value"],
    ["question", r.study.question],
    ["organization", r.organization.name],
    ["status", r.study.status],
    ["deadline", r.study.deadline],
    ["opening_baseline", r.baseline.value],
    ["baseline_methodology", r.baseline.methodology],
    [priceField, r.communityEstimate?.yesAllocationShare ?? ""],
    ["calibrated_probability", r.calibratedProbability?.value ?? "not available"],
    ["participants", r.participation?.participantCount ?? 0],
    ["forecasts", r.participation?.forecastCount ?? 0],
    ["data_as_of", r.communityEstimate?.asOf ?? ""],
    ["resolved_outcome", r.resolution?.outcome ?? ""],
    ["generated_at", r.generatedAt],
    ["disclaimer", r.disclaimer],
    [],
    ["timestamp", priceField],
    ...r.trend.points.map((p) => [p.at, p.yesShare ?? ""]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function reportFilename(r: StudyReport, ext: string): string {
  const slug = r.study.question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `venturecast-report-${slug || r.study.id}-${r.generatedAt.slice(0, 10)}.${ext}`;
}
