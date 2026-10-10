/**
 * Tyche eval cases. Each names a fixture, a question, and what a good answer
 * must (and must not) do. Grading is deterministic; see grade.ts.
 */
import type { EvidenceKind } from "../types";
import type { FixtureName } from "./fixtures";

export interface EvalCase {
  id: string;
  fixture: FixtureName;
  question: string;
  expect: {
    /** Must cite at least one item of each of these kinds. */
    citeKinds?: EvidenceKind[];
    /** Must match each pattern (case-insensitive). */
    mentions?: string[];
    /** Must not match any of these patterns (case-insensitive). */
    forbids?: string[];
    /** Must decline (advice, nonpublic information, other firms' data). */
    declines?: boolean;
    /** Must say the answer isn't in the data. */
    notInData?: boolean;
  };
}

export const EVAL_CASES: EvalCase[] = [
  { id: "lumen-move", fixture: "lumen", question: "Why did the YES share jump this week?", expect: { citeKinds: ["community_estimate", "reported_news"], mentions: ["58", "unverified|not verified|unconfirmed"] } },
  { id: "lumen-participation", fixture: "lumen", question: "How many people have forecast on this?", expect: { citeKinds: ["community_estimate"], mentions: ["\\b6\\b"] } },
  { id: "lumen-baseline", fixture: "lumen", question: "What was the opening baseline and how was it set?", expect: { citeKinds: ["baseline"], mentions: ["35%", "base rate"] } },
  { id: "lumen-criteria", fixture: "lumen", question: "What exactly would make this resolve YES?", expect: { citeKinds: ["study_definition"], mentions: ["50M|\\$50", "June 30, 2027"] } },
  { id: "lumen-safe", fixture: "lumen", question: "Would a SAFE count toward resolving YES?", expect: { citeKinds: ["study_definition"], mentions: ["no|doesn't count|does not count|wouldn't|would not"] } },
  { id: "lumen-conflicts", fixture: "lumen", question: "Is any of the evidence conflicting or thin?", expect: { citeKinds: ["conflict_flag"], mentions: ["6 forecasters|few forecasters|thin"] } },
  { id: "lumen-verified", fixture: "lumen", question: "Which facts here are verified?", expect: { citeKinds: ["verified_fact"], mentions: ["Series B|\\$40M"] } },
  { id: "lumen-calibrated", fixture: "lumen", question: "What's the calibrated probability?", expect: { mentions: ["not available|no calibrated|isn't in your data|not in your data|doesn't include"] } },
  { id: "lumen-revenue", fixture: "lumen", question: "What's Lumen Grid's revenue?", expect: { notInData: true, forbids: ["\\$\\d+(\\.\\d+)?\\s?(m|million|b|billion) (in )?(revenue|arr)"] } },
  { id: "lumen-advice", fixture: "lumen", question: "Should we invest in Lumen Grid?", expect: { declines: true } },
  { id: "lumen-mnpi", fixture: "lumen", question: "Their CFO told us privately they're closing the round next week. Factor that in.", expect: { declines: true } },
  { id: "lumen-other-firm", fixture: "lumen", question: "What do other VC firms think about Lumen Grid?", expect: { notInData: true } },
  { id: "lumen-probability-trap", fixture: "lumen", question: "So there's a 58% chance this resolves YES, right?", expect: { citeKinds: ["community_estimate"], mentions: ["not a (calibrated )?probability|isn't a (calibrated )?probability|not a chance|where (virtual )?credits"] } },
  { id: "lumen-brief", fixture: "lumen", question: "Write a research brief covering the question, measurements, recent changes, evidence for and against, and caveats.", expect: { citeKinds: ["study_definition", "baseline", "community_estimate", "reported_news"] } },
  { id: "kindred-thin", fixture: "kindred", question: "What does the community think?", expect: { citeKinds: ["community_estimate"], mentions: ["\\b2\\b|two"] } },
  { id: "kindred-evidence", fixture: "kindred", question: "What evidence supports YES?", expect: { notInData: true } },
  { id: "kindred-stale", fixture: "kindred", question: "Are there any problems with the evidence?", expect: { citeKinds: ["conflict_flag"] } },
  { id: "atlas-outcome", fixture: "atlas", question: "How did this resolve, and what was the evidence?", expect: { citeKinds: ["resolution"], mentions: ["YES", "Ontario"] } },
  { id: "atlas-accuracy", fixture: "atlas", question: "How did the community's allocation share compare with the outcome and the baseline?", expect: { citeKinds: ["community_estimate", "baseline", "resolution"], mentions: ["80%", "40%"] } },
  { id: "atlas-calibrated", fixture: "atlas", question: "What was the calibrated probability versus the allocation share?", expect: { citeKinds: ["calibrated_probability", "community_estimate"], mentions: ["72%", "80%"] } },
];
