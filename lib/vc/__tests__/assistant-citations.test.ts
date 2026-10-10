import { describe, expect, it } from "vitest";
import { checkCitations, splitSentences } from "../assistant/citations";
import type { ContextPackage, EvidenceItem } from "../assistant/types";

const item = (id: string, kind: EvidenceItem["kind"], value: string, numeric: number | null = null): EvidenceItem => ({
  id,
  kind,
  label: id,
  value,
  numeric,
  asOf: "2026-10-09T00:00:00.000Z",
  sourceUrl: null,
  caveat: null,
  href: `/vc/studies/s1#${id}`,
});

const pkg: ContextPackage = {
  scope: { kind: "study", studyId: "s1" },
  tier: "standard",
  builtAt: "2026-10-10T00:00:00.000Z",
  items: [
    item("snapshot:a", "community_estimate", "41.0% YES allocation share", 0.41),
    item("snapshot:b", "community_estimate", "58.0% YES allocation share", 0.58),
    item("study:s1#baseline", "baseline", "35%", 0.35),
    item("news:n1", "reported_news", "Utility contract (Utility Dive)"),
    item("trackrecord:x", "track_record", "2 of 3 resolved YES (95% interval 21%–94%)."),
    item("market:m1#calibrated", "calibrated_probability", "55.0%", 0.55),
  ],
  omitted: [],
};

describe("sentence splitting", () => {
  it("keeps decimals and attaches trailing markers to their sentence", () => {
    expect(splitSentences("It rose to 58.0% [[snapshot:b]]. Then it held. [[news:n1]]")).toEqual([
      "It rose to 58.0% [[snapshot:b]].",
      "Then it held. [[news:n1]]",
    ]);
  });
});

describe("citation checking", () => {
  it("accepts a fully grounded answer and returns clickable citations", () => {
    const r = checkCitations(
      "The YES allocation share rose from 41% to 58% this week [[snapshot:a]][[snapshot:b]]. A report said Lumen Grid signed a utility contract [[news:n1]].",
      pkg,
    );
    expect(r.grounded).toBe(true);
    expect(r.errorCount).toBe(0);
    expect(r.sentences[0].text).toBe("The YES allocation share rose from 41% to 58% this week.");
    expect(r.sentences[0].citations.map((c) => c.href)).toEqual(["/vc/studies/s1#snapshot:a", "/vc/studies/s1#snapshot:b"]);
    expect(r.citedIds.sort()).toEqual(["news:n1", "snapshot:a", "snapshot:b"]);
  });

  it("rejects citations that aren't in the package", () => {
    const r = checkCitations("Revenue doubled last year [[fact:made-up]].", pkg);
    expect(r.grounded).toBe(false);
    expect(r.unknownIds).toEqual(["fact:made-up"]);
    expect(r.sentences[0].citations).toEqual([]);
    expect(r.sentences[0].unsupported).toBe(true);
  });

  it("catches a real id next to a wrong number", () => {
    const r = checkCitations("The share is now 72% [[snapshot:b]].", pkg);
    expect(r.sentences[0].issues.map((i) => i.code)).toContain("number_mismatch");
    // "From 41% to 58%" citing only the 58% snapshot leaves 41% unaccounted for.
    const r2 = checkCitations("It rose from 41% to 58% [[snapshot:b]].", pkg);
    expect(r2.sentences[0].issues[0].message).toMatch(/^41%/);
  });

  it("accepts numbers stated in a cited item's text, within a point of rounding", () => {
    expect(checkCitations("The YES rate interval is 21% to 94% [[trackrecord:x]].", pkg).grounded).toBe(true);
    expect(checkCitations("The share is about 57.5% [[snapshot:b]].", pkg).grounded).toBe(true);
  });

  it("never lets the allocation share be called a probability", () => {
    const bad = checkCitations("There is a 58% probability of YES [[snapshot:b]].", pkg);
    expect(bad.sentences[0].issues.map((i) => i.code)).toContain("share_called_probability");
    expect(checkCitations("The share is 58%, which is not a calibrated probability [[snapshot:b]].", pkg).grounded).toBe(true);
    expect(checkCitations("The calibrated probability is 55% [[market:m1#calibrated]].", pkg).grounded).toBe(true);
  });

  it("warns on uncited claims and bare numbers but exempts headings and questions", () => {
    const r = checkCitations("Summary:\nThe company is growing quickly.\nAbout 40% of analysts agree.\nWant more detail?", pkg);
    const codes = r.sentences.map((s) => s.issues.map((i) => i.code));
    expect(codes).toEqual([[], ["uncited"], ["unsupported_number", "uncited"], []]);
    expect(r.grounded).toBe(true); // warnings, not errors
    expect(r.warningCount).toBe(3);
  });

  it("accepts several ids in one marker", () => {
    const r = checkCitations("Both the baseline and latest share matter here, at 35% and 58% [[study:s1#baseline, snapshot:b]].", pkg);
    expect(r.grounded).toBe(true);
    expect(r.sentences[0].citations).toHaveLength(2);
  });
});
