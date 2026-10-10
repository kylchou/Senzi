/**
 * Checks an assistant answer against the context package it was given.
 *
 * Answers cite evidence with markers like [[snapshot:abc]] or
 * [[fact:x, news:y]], placed before the sentence's final punctuation. The
 * checker never trusts the model: an id must exist in this exact package, a
 * percentage must match the estimate it cites, and the LMSR price must
 * never be called a probability. It can't prove a claim is true, which is
 * what the eval set is for.
 */
import type { CheckedCitation, CheckedSentence, CitationIssue, CitationReport, ContextPackage, EvidenceItem, EvidenceKind } from "./types";

const MARKER = /\[\[([^\]]+)\]\]/g;
/** Allowed difference, in percentage points, between a quoted number and the cited value. */
const NUMBER_TOLERANCE_PTS = 1;
const NUMERIC_KINDS: readonly EvidenceKind[] = ["community_estimate", "baseline", "calibrated_probability"];

/**
 * Statements about the data's limits or what the assistant can do, rather than
 * claims about the subject: declines, "that isn't in your data", offers to help.
 */
const META_STATEMENT =
  /\b(?:I can(?:no|')t|I cannot|I can|I'll|I will|I'm (?:not )?able|isn't in your data|aren't in your data|not in your data|(?:doesn't|does not) (?:include|cover|contain|break out|have)|includes? no\b|would help|would be needed|if (?:that|it) would help|want me to)\b/i;

/** "No calibrated probability is in your data", "No revenue figures are in your evidence". */
const NOT_IN_DATA = /^(?:-\s*)?(?:[\w ]+:\s*)?no\b[^.]{0,80}\b(?:is|are) in your (?:data|evidence)\b/i;

/** Sentences that need no citation: headings, questions, short connectives, and meta statements without numbers. */
function exempt(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^#+\s|:$/.test(t)) return true;
  if (t.endsWith("?")) return true;
  if ((META_STATEMENT.test(t) || NOT_IN_DATA.test(t)) && !/\d/.test(t)) return true;
  return t.split(/\s+/).length < 4;
}

/**
 * Splits into sentences on ., ! or ? followed by whitespace, while keeping
 * decimals ("58.5%") and abbreviations like "e.g." intact. Markers that
 * trail a sentence's punctuation are attached to that sentence.
 */
export function splitSentences(answer: string): string[] {
  return splitSentenceParts(answer).map((p) => p.text);
}

/** Like splitSentences, also noting which sentences start a new line (for paragraph and bullet layout). */
export function splitSentenceParts(answer: string): { text: string; startsLine: boolean }[] {
  const out: { text: string; startsLine: boolean }[] = [];
  for (const line of answer.split(/\n+/)) {
    const parts = line.split(/(?<=[.!?])\s+(?=\[\[|[A-Z0-9"“(•\-*])/);
    let first = true;
    for (const raw of parts) {
      const part = raw.trim();
      if (!part) continue;
      // A fragment that is only markers belongs to the previous sentence.
      if (out.length && part.replace(MARKER, "").trim() === "") {
        out[out.length - 1].text += ` ${part}`;
      } else {
        out.push({ text: part, startsLine: first });
        first = false;
      }
    }
  }
  return out;
}

function percentages(text: string): number[] {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1]));
}

/** Whether an item's text states this percentage (e.g. "58%", "58.0%", "+12%"). */
function mentionsPercent(value: string, p: number): boolean {
  return percentages(value).some((q) => Math.abs(q - p) < 0.05);
}

function callsShareAProbability(text: string): boolean {
  if (!/probabilit/i.test(text)) return false;
  return !/\bnot\b[^.]{0,40}probabilit/i.test(text);
}

export function checkCitations(answer: string, pkg: ContextPackage): CitationReport {
  const byId = new Map<string, EvidenceItem>(pkg.items.map((i) => [i.id, i]));
  const sentences: CheckedSentence[] = [];
  const cited = new Set<string>();
  const unknown = new Set<string>();

  for (const { text: raw, startsLine } of splitSentenceParts(answer)) {
    const ids = [...raw.matchAll(MARKER)].flatMap((m) => m[1].split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean));
    const text = raw.replace(MARKER, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
    const issues: CitationIssue[] = [];

    const valid = [...new Set(ids)].filter((id) => byId.has(id));
    const invalid = [...new Set(ids)].filter((id) => !byId.has(id));
    valid.forEach((id) => cited.add(id));
    invalid.forEach((id) => unknown.add(id));
    if (invalid.length) {
      issues.push({
        code: "unknown_citation",
        severity: "error",
        message: "Cites evidence that isn't in the provided context.",
        ids: invalid,
      });
    }

    const items = valid.map((id) => byId.get(id)!);
    const numericItems = items.filter((i) => NUMERIC_KINDS.includes(i.kind) && i.numeric != null);
    const values = numericItems.map((i) => i.numeric! * 100);
    // A percentage is accounted for when it matches a cited estimate's value, or
    // appears in the text of a cited item (an interval, an indicator change).
    const accounted = (p: number) =>
      values.some((v) => Math.abs(v - p) <= NUMBER_TOLERANCE_PTS) || items.some((i) => mentionsPercent(i.value, p));
    const unaccounted = percentages(text).filter((p) => !accounted(p));
    if (unaccounted.length) {
      const listed = unaccounted.map((p) => `${p}%`).join(", ");
      if (items.length === 0) {
        issues.push({ code: "unsupported_number", severity: "warning", message: `States ${listed} without citing where it comes from.` });
      } else {
        issues.push({
          code: "number_mismatch",
          severity: "error",
          message: `${listed} doesn't match the cited evidence${values.length ? ` (${values.map((v) => `${Math.round(v * 10) / 10}%`).join(", ")})` : ""}.`,
          ids: valid,
        });
      }
    }

    const citesShare = items.some((i) => i.kind === "community_estimate");
    const citesCalibrated = items.some((i) => i.kind === "calibrated_probability");
    if (citesShare && !citesCalibrated && callsShareAProbability(text)) {
      issues.push({
        code: "share_called_probability",
        severity: "error",
        message: "Describes the general LMSR price as a probability.",
        ids: items.filter((i) => i.kind === "community_estimate").map((i) => i.id),
      });
    }

    if (valid.length === 0 && !exempt(text)) {
      issues.push({ code: "uncited", severity: "warning", message: "No citation; shown as not from your data." });
    }

    const citations: CheckedCitation[] = items.map((i) => ({ id: i.id, kind: i.kind, label: i.label, href: i.href, sourceUrl: i.sourceUrl }));
    sentences.push({ text, startsLine, citations, issues, unsupported: valid.length === 0 && !exempt(text) });
  }

  const all = sentences.flatMap((s) => s.issues);
  const errorCount = all.filter((i) => i.severity === "error").length;
  return {
    sentences,
    citedIds: [...cited],
    unknownIds: [...unknown],
    errorCount,
    warningCount: all.length - errorCount,
    grounded: errorCount === 0,
  };
}
