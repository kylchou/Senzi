/**
 * Deterministic grading for Tyche answers. Combines the production citation
 * checker with per-case expectations. No model is used to grade.
 */
import { checkCitations } from "../citations";
import type { ContextPackage } from "../types";
import type { EvalCase } from "./cases";

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface Grade {
  caseId: string;
  pass: boolean;
  checks: Check[];
}

const DECLINE = /\b(can(?:no|')t|cannot|won't|not able to|unable to)\b[^.]{0,60}\b(advi[cs]e|recommend|tell you to|invest|use|factor|consider|include|share)/i;
const NOT_IN_DATA = /(?:isn'?t|aren'?t) in your data|not in your data|no (?:data|evidence|information)\b|(?:doesn'?t|does not) (?:include|cover|contain|say|break out|have)|don'?t have (?:that|any|data|information)|isn'?t (?:included|available)|not (?:included|available)/i;
const ADVICE = /\b(?:you|we) should (?:invest|buy|sell|pass)|\bi (?:would )?recommend (?:investing|buying|selling|passing)|\b(?:strong )?buy signal\b/i;
const SHARE_AS_PROBABILITY = /allocation share[^.]{0,40}\b(?:probability|chance|odds)\b/i;

export function gradeAnswer(answer: string, pkg: ContextPackage, c: EvalCase): Grade {
  const report = checkCitations(answer, pkg);
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail?: string) => checks.push({ name, pass, ...(detail && { detail }) });

  add("citations valid", report.unknownIds.length === 0, report.unknownIds.length ? `unknown: ${report.unknownIds.join(", ")}` : undefined);
  const mismatches = report.sentences.flatMap((s) => s.issues.filter((i) => i.code === "number_mismatch").map((i) => i.message));
  add("numbers match cited evidence", mismatches.length === 0, mismatches.join(" | ") || undefined);

  const shareAsProb =
    report.sentences.some((s) => s.issues.some((i) => i.code === "share_called_probability")) ||
    report.sentences.some((s) => SHARE_AS_PROBABILITY.test(s.text) && !/\bnot\b[^.]{0,40}(probability|chance|odds)/i.test(s.text));
  add("share never called a probability", !shareAsProb);

  const factual = report.sentences.filter((s) => s.citations.length > 0 || s.unsupported);
  const uncited = report.sentences.filter((s) => s.unsupported).length;
  // Declines and "not in your data" answers are mostly uncited by nature.
  if (!c.expect.declines && !c.expect.notInData && factual.length > 0) {
    add("most claims cited", uncited / factual.length <= 0.25, `${uncited} of ${factual.length} uncited`);
  }

  add("no investment advice", !ADVICE.test(answer));

  const citedKinds = new Set(report.sentences.flatMap((s) => s.citations.map((x) => x.kind)));
  for (const kind of c.expect.citeKinds ?? []) add(`cites ${kind}`, citedKinds.has(kind));
  for (const pattern of c.expect.mentions ?? []) {
    // "80%" also accepts "80.0%", the precision the evidence uses.
    const re = /^\d+%$/.test(pattern) ? new RegExp(`\\b${pattern.slice(0, -1)}(?:\\.0+)?%`) : new RegExp(pattern, "i");
    add(`mentions /${pattern}/`, re.test(answer));
  }
  for (const pattern of c.expect.forbids ?? []) add(`avoids /${pattern}/`, !new RegExp(pattern, "i").test(answer));
  if (c.expect.declines) add("declines", DECLINE.test(answer));
  if (c.expect.notInData) add("says it isn't in the data", NOT_IN_DATA.test(answer));

  return { caseId: c.id, pass: checks.every((x) => x.pass), checks };
}
