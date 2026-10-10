/**
 * Evidence package for the AI research assistant.
 *
 * Everything the assistant may see is an EvidenceItem with a stable,
 * namespaced id built from real database ids (e.g. "snapshot:<id>",
 * "fact:<id>"). The model must cite these ids; the citation checker then
 * verifies every cited id exists in the same package before anything is shown.
 */

/**
 * Which data the team has approved sending to an AI provider.
 *  - standard: public data plus the firm's own study fields for studies the
 *    asker can view. Restricted studies and private notes are excluded.
 *  - extended: also restricted studies and private firm notes. Needs explicit
 *    team approval (see lib/vc/AI_RESEARCH_ASSISTANT.md).
 */
export type DataTier = "standard" | "extended";

export type EvidenceKind =
  | "study_definition"
  | "baseline"
  | "community_estimate"
  | "calibrated_probability"
  | "resolution"
  | "source"
  | "verified_fact"
  | "unverified_fact"
  | "reported_news"
  | "indicator"
  | "track_record"
  | "startup"
  | "firm_note"
  | "conflict_flag"
  | "key_stats";

export interface EvidenceItem {
  /** Stable, namespaced id from real records, e.g. "snapshot:clx…" or "study:clx…#criteria-yes". */
  id: string;
  kind: EvidenceKind;
  /** Short human label, e.g. "Community YES allocation share". */
  label: string;
  /** The content itself, as plain text. */
  value: string;
  /**
   * The number this item states, when it has one: a 0–1 share for estimates,
   * baselines and calibrated probabilities. Used to check numbers in answers.
   */
  numeric: number | null;
  /** ISO date the value refers to (or was last updated). */
  asOf: string | null;
  sourceUrl: string | null;
  /** Fixed wording that must travel with the item, e.g. "Not a calibrated probability". */
  caveat: string | null;
  /** In-app link a citation opens. */
  href: string;
  /** Items a conflict flag is about, so an answer can cite both sides. */
  relatedIds?: string[];
}

export type ContextScope =
  | { kind: "study"; studyId: string }
  | { kind: "comparison"; startupIds: string[] };

export interface OmittedEvidence {
  kind: EvidenceKind | "restricted_study";
  count: number;
  reason: string;
}

export interface ContextPackage {
  scope: ContextScope;
  tier: DataTier;
  builtAt: string;
  items: EvidenceItem[];
  /** What was left out and why, so an answer can say so instead of guessing. */
  omitted: OmittedEvidence[];
}

// ---------------------------------------------------------------------------
// Citation checking
// ---------------------------------------------------------------------------

export type CitationIssueCode =
  /** A cited id that isn't in the package (fabricated or out of scope). */
  | "unknown_citation"
  /** A percentage that doesn't match any cited estimate, baseline, or probability. */
  | "number_mismatch"
  /** A percentage with nothing numeric cited for it. */
  | "unsupported_number"
  /** The allocation share described as a probability. */
  | "share_called_probability"
  /** A factual-looking sentence with no valid citation. */
  | "uncited";

export interface CitationIssue {
  code: CitationIssueCode;
  severity: "error" | "warning";
  message: string;
  ids?: string[];
}

export interface CheckedCitation {
  id: string;
  kind: EvidenceKind;
  label: string;
  href: string;
  sourceUrl: string | null;
}

export interface CheckedSentence {
  /** Sentence text with citation markers removed, ready to render. */
  text: string;
  /** True when the sentence began a new line in the answer (paragraph or bullet). */
  startsLine: boolean;
  citations: CheckedCitation[];
  issues: CitationIssue[];
  /** True when the UI should mark the sentence "not from your data". */
  unsupported: boolean;
}

export interface CitationReport {
  sentences: CheckedSentence[];
  citedIds: string[];
  unknownIds: string[];
  errorCount: number;
  warningCount: number;
  /** No errors: every citation exists and every cited number matches. */
  grounded: boolean;
}
