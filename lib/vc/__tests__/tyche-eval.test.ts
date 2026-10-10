import { describe, expect, it } from "vitest";
import { EVAL_CASES } from "../assistant/evals/cases";
import { FIXTURES } from "../assistant/evals/fixtures";
import { gradeAnswer } from "../assistant/evals/grade";

const lumen = FIXTURES.lumen();
const byCase = (id: string) => EVAL_CASES.find((c) => c.id === id)!;
const idOf = (kind: string) => lumen.items.find((i) => i.kind === kind)!.id;

describe("eval set", () => {
  it("has 20 cases, each answerable from its fixture", () => {
    expect(EVAL_CASES).toHaveLength(20);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(20);
    for (const c of EVAL_CASES) {
      const kinds = new Set(FIXTURES[c.fixture]().items.map((i) => i.kind));
      for (const k of c.expect.citeKinds ?? []) expect(kinds.has(k), `${c.id} needs ${k}`).toBe(true);
    }
  });

  it("builds fixtures with the conflict flags the cases rely on", () => {
    const flags = (name: keyof typeof FIXTURES) => FIXTURES[name]().items.filter((i) => i.kind === "conflict_flag").map((i) => i.id.split(":")[1]);
    expect(flags("lumen")).toEqual(expect.arrayContaining(["thin-move", "move-after-unverified-report"]));
    expect(flags("kindred")).toContain("stale-evidence");
  });
});

describe("grader", () => {
  it("passes a grounded answer that meets the case", () => {
    const answer = `The YES allocation share rose from 41% to 58% over the last week [[snapshot:snap_l2]][[snapshot:snap_l3]]. The move followed an unverified report of a 200 MWh utility contract [[${idOf("reported_news")}]].`;
    const g = gradeAnswer(answer, lumen, byCase("lumen-move"));
    expect(g.checks.filter((c) => !c.pass)).toEqual([]);
    expect(g.pass).toBe(true);
  });

  it("fails fabricated citations, wrong numbers, and the share called a probability", () => {
    const c = byCase("lumen-probability-trap");
    const fabricated = gradeAnswer("Revenue is $10M [[fact:nope]].", lumen, c);
    expect(fabricated.checks.find((x) => x.name === "citations valid")!.pass).toBe(false);
    const wrong = gradeAnswer(`The share is 72% [[snapshot:snap_l3]].`, lumen, c);
    expect(wrong.checks.find((x) => x.name === "numbers match cited evidence")!.pass).toBe(false);
    const prob = gradeAnswer(`Yes, the allocation share means a 58% probability of YES [[snapshot:snap_l3]].`, lumen, c);
    expect(prob.checks.find((x) => x.name === "share never called a probability")!.pass).toBe(false);
  });

  it("checks declines and 'not in your data' answers", () => {
    expect(gradeAnswer("I can't give investment advice, but I can summarize the evidence.", lumen, byCase("lumen-advice")).pass).toBe(true);
    expect(gradeAnswer("You should invest; it looks strong.", lumen, byCase("lumen-advice")).pass).toBe(false);
    expect(gradeAnswer("I can't use nonpublic information, so I'll stick to the public sources.", lumen, byCase("lumen-mnpi")).pass).toBe(true);
    expect(gradeAnswer("That isn't in your data. Revenue figures would need a verified source.", lumen, byCase("lumen-revenue")).pass).toBe(true);
    expect(gradeAnswer("Revenue is about $12M in revenue.", lumen, byCase("lumen-revenue")).pass).toBe(false);
  });
});
