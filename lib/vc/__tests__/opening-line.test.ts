import { describe, expect, it } from "vitest";
import { VcError } from "../errors";
import { confidenceFor, publicInputs } from "../opening-line";
import { notMeasurable } from "../services/opening-line";
import { createStudyInput, updateStudyInput } from "../validation";
import { DAY, NOW, modelLinkFor, setup, users, validStudyInput } from "./fixtures";

async function expectCode(p: Promise<unknown>, code: VcError["code"], message?: RegExp) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof VcError && e.code === code && (!message || message.test(e.message)));
}

/** Submit and approve as the right actors; returns the approved study's version. */
async function approve(s: ReturnType<typeof setup>, studyId: string) {
  let st = (await s.repo.findStudy(studyId))!;
  await s.services.studies.transition(users.analystA, studyId, { action: "submit", expectedVersion: st.version });
  st = (await s.repo.findStudy(studyId))!;
  await s.services.studies.transition(users.admin, studyId, { action: "approve", expectedVersion: st.version });
  return (await s.repo.findStudy(studyId))!.version;
}

/** Weekly download totals the firm entered on Acme's company page (Acme has no public history in these tests). */
const FIRM_WEEKS = [
  { metricId: "downloads:acme", value: 41_000, periodStart: "2026-09-02", periodEnd: "2026-09-08", note: "", availableAt: "2026-09-09T10:00:00.000Z" },
  { metricId: "downloads:acme", value: 44_000, periodStart: "2026-09-09", periodEnd: "2026-09-15", note: "", availableAt: "2026-09-16T10:00:00.000Z" },
  { metricId: "downloads:acme", value: 47_000, periodStart: "2026-09-16", periodEnd: "2026-09-22", note: "Board deck", availableAt: "2026-09-23T10:00:00.000Z" },
];

/** Acme loses its public data; only org_a's own figures can feed the model. */
function firmOnly(s: ReturnType<typeof setup>, figures = FIRM_WEEKS) {
  s.model.noPublicData.add("acme");
  s.repo.firmFigures.set("org_a:startup_1", figures);
}

describe("opening line on save", () => {
  it("prices a linked question with the model and words it exactly as priced", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput());

    expect(study.baselineValue).toBe(0.4);
    expect(study.baselineMethodology).toMatch(/Fake model/);
    expect(study.question).toBe("Will Acme's weekly downloads be at least 50000 downloads by 2027-01-15?");
    expect(study.yesCriteria).toMatch(/at least 50,000 downloads, as reported by the public source/);
    const stored = (await s.repo.findModelEstimate(study.id))!;
    expect(stored).toMatchObject({ status: "OK", link: { metricId: "downloads:acme", threshold: 50_000, targetDate: "2027-01-15" }, calculatedById: "analyst_a" });
  });

  it("requires an outcome: questions are never free text", () => {
    const without = (...keys: string[]) => Object.fromEntries(Object.entries(validStudyInput()).filter(([k]) => !keys.includes(k)));
    expect(createStudyInput.safeParse(without("modelLink")).success).toBe(false);
    expect(createStudyInput.safeParse({ ...validStudyInput(), modelLink: null }).success).toBe(false);
    // The wording comes from the outcome, so the client needn't send any.
    expect(createStudyInput.safeParse(without("question", "yesCriteria", "noCriteria")).success).toBe(true);
  });

  it("rejects links the model can't price as asked, including firm-only KPIs with no public resolution source", async () => {
    const s = setup();
    const create = (link: ReturnType<typeof modelLinkFor>) => s.services.studies.create(users.analystA, validStudyInput({ modelLink: link }));
    await expectCode(create(modelLinkFor("startup_1", { metricId: "downloads:globex" })), "VALIDATION_ERROR", /No metric/);
    await expectCode(create(modelLinkFor("startup_1", { metricId: "sponsor_arr" })), "VALIDATION_ERROR", /public resolution source/);
    await expectCode(create(modelLinkFor("startup_1", { targetDate: "2026-11-01" })), "VALIDATION_ERROR", /after the forecasting deadline/);
  });

  it("names the public resolution source on a linked study", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    expect(study.sources[0]).toMatchObject({ url: "https://example.com/downloads", title: "Resolution: weekly downloads" });
    expect(study.sources).toHaveLength(2);
  });

  it("keeps a question's wording tied to its outcome on edit; the outcome can change but not be removed", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    const edited = await s.services.studies.update(users.analystA, study.id, { question: "Will Acme do great things soon?", expectedVersion: 1 });
    expect(edited.question).toBe(study.question);
    expect(updateStudyInput.safeParse({ modelLink: null, expectedVersion: 2 }).success).toBe(false);

    const changed = await s.services.studies.update(users.analystA, study.id, {
      modelLink: modelLinkFor("startup_1", { threshold: 70_000 }),
      expectedVersion: 2,
    });
    expect(changed.question).toMatch(/at least 70000/);
  });

  it("re-prices when the deadline or the link changes", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    const calls = s.model.calls;
    s.model.probabilities.set("downloads:acme", 0.7);
    const moved = await s.services.studies.update(users.analystA, study.id, { deadline: new Date(NOW.getTime() + 61 * DAY), expectedVersion: 1 });
    expect(s.model.calls).toBe(calls + 1);
    expect(moved.baselineValue).toBe(0.7);
    await s.services.studies.update(users.analystA, study.id, { context: "Only context changed", expectedVersion: 2 });
    expect(s.model.calls).toBe(calls + 1);
  });
});

describe("opening forecasting", () => {
  it("blocks opening an older free-text draft that no metric measures", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    // Drafts written in words before outcomes were required have no link.
    await s.repo.saveModelEstimate({ ...notMeasurable(NOW, "Not enough data"), studyId: study.id, observations: [], calculatedById: null });
    const version = await approve(s, study.id);
    await expectCode(
      s.services.studies.transition(users.admin, study.id, { action: "open", expectedVersion: version }),
      "VALIDATION_ERROR",
      /Not enough data/,
    );
    expect(s.platform.state.createdMarkets).toHaveLength(0);
    expect((await s.repo.findStudy(study.id))!.status).toBe("APPROVED");
  });

  it("blocks opening on too little history, then opens once the data is there", async () => {
    const s = setup();
    s.model.insufficient.add("downloads:acme");
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    expect(study.baselineValue).toBeNull();
    const version = await approve(s, study.id);
    await expectCode(
      s.services.studies.transition(users.admin, study.id, { action: "open", expectedVersion: version }),
      "VALIDATION_ERROR",
      /Not enough data for the model/,
    );

    s.model.insufficient.delete("downloads:acme");
    s.model.probabilities.set("downloads:acme", 0.62);
    await s.services.studies.transition(users.admin, study.id, { action: "open", expectedVersion: version });
    const opened = (await s.repo.findStudy(study.id))!;
    expect(opened).toMatchObject({ status: "OPEN", baselineValue: 0.62 });
  });

  it("opens the market at the model's price from fresh data, with its band and confidence", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    const version = await approve(s, study.id);
    s.model.probabilities.set("downloads:acme", 0.55); // new data since the draft was priced at 40%
    await s.services.studies.transition(users.admin, study.id, { action: "open", expectedVersion: version });

    const { input } = s.platform.state.createdMarkets[0]!;
    expect(input.openingBaseline.value).toBe(0.55);
    expect(input.model).toMatchObject({ confidence: "medium", modelVersion: "fake-1" });
    expect(input.model.low).toBeCloseTo(0.45);
    expect(input.model.high).toBeCloseTo(0.65);
    expect(input.question).toBe(study.question);
  });

  it("prices from the firm's company-page figures when there's no public history, and only that firm's", async () => {
    const s = setup();
    s.model.noPublicData.add("acme");
    s.repo.firmFigures.set("org_b:startup_1", FIRM_WEEKS); // another firm's figures never count
    const without = await s.services.studies.create(users.analystA, validStudyInput());
    expect(without.baselineValue).toBeNull();
    expect((await s.repo.findModelEstimate(without.id))!.status).toBe("INSUFFICIENT_DATA");

    s.repo.firmFigures.set("org_a:startup_1", FIRM_WEEKS);
    const withFigures = await s.services.studies.create(users.analystA, validStudyInput());
    expect(withFigures.baselineValue).toBe(0.4);
    expect((await s.repo.findModelEstimate(withFigures.id))!.observations).toHaveLength(3);
  });

  it("never sends the firm's own figures to the shared market tables", async () => {
    const s = setup();
    firmOnly(s);
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    expect(study.baselineValue).toBe(0.4);
    const version = await approve(s, study.id);
    await s.services.studies.transition(users.admin, study.id, { action: "open", expectedVersion: version });

    const used = s.platform.state.createdMarkets[0]!.input.model.inputsUsed;
    expect(used).toHaveLength(3); // the fake has no public rows here: all three are the firm's
    expect(used.every((p) => !("value" in p))).toBe(true);
    expect(JSON.stringify(used)).not.toContain("Board deck");
  });

  it("shows the firm's figures only to the firm", async () => {
    const s = setup();
    firmOnly(s);
    const study = await s.services.studies.create(users.analystA, validStudyInput({ visibility: "PUBLIC" }));
    const version = await approve(s, study.id);
    await s.services.studies.transition(users.admin, study.id, { action: "open", expectedVersion: version });

    expect((await s.services.studies.get(users.analystA, study.id)).firmObservations).toHaveLength(3);
    const outside = await s.services.studies.get(users.analystB, study.id);
    expect(outside.firmObservations).toBeNull();
    expect(outside.openingLine).toMatchObject({ status: "OK", probability: 0.4 });
    expect(outside.openingLine).not.toHaveProperty("inputsUsed");
  });
});

describe("model line refresh", () => {
  it("publishes a changed estimate once, and leaves the line alone without enough data", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    const version = await approve(s, study.id);
    await s.services.studies.transition(users.admin, study.id, { action: "open", expectedVersion: version });

    expect(await s.services.openingLine.refreshOpenMarkets()).toEqual({ checked: 1, published: 0 });

    s.model.dataVersion.value++;
    s.model.probabilities.set("downloads:acme", 0.48);
    expect(await s.services.openingLine.refreshOpenMarkets()).toEqual({ checked: 1, published: 1 });
    expect(s.model.published).toEqual([{ marketId: `mkt_${study.id}`, probability: 0.48, inputsHash: expect.any(String) }]);
    expect(await s.services.openingLine.refreshOpenMarkets()).toEqual({ checked: 1, published: 0 });

    s.model.dataVersion.value++;
    s.model.insufficient.add("downloads:acme");
    expect(await s.services.openingLine.refreshOpenMarkets()).toEqual({ checked: 1, published: 0 });
    expect((await s.repo.findModelEstimate(study.id))!.probability).toBe(0.48);
  });

  it("picks up figures the firm adds on its company page after opening", async () => {
    const s = setup();
    firmOnly(s);
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    const version = await approve(s, study.id);
    await s.services.studies.transition(users.admin, study.id, { action: "open", expectedVersion: version });
    expect(await s.services.openingLine.refreshOpenMarkets()).toEqual({ checked: 1, published: 0 });

    s.repo.firmFigures.set("org_a:startup_1", [
      ...FIRM_WEEKS,
      { metricId: "downloads:acme", value: 50_000, periodStart: "2026-09-23", periodEnd: "2026-09-29", note: "", availableAt: "2026-09-30T10:00:00.000Z" },
    ]);
    expect(await s.services.openingLine.refreshOpenMarkets()).toEqual({ checked: 1, published: 1 });
    expect((await s.repo.findModelEstimate(study.id))!.observations).toHaveLength(4);
  });
});

describe("draft preview", () => {
  const preview = (s: ReturnType<typeof setup>, ctx = users.analystA, link = modelLinkFor()) =>
    s.services.openingLine.preview(ctx, { startupId: "startup_1", deadline: new Date(NOW.getTime() + 60 * DAY), link });

  it("prices the chosen outcome without saving anything", async () => {
    const s = setup();
    const result = await preview(s);
    expect(result.estimate).toMatchObject({ status: "OK", probability: 0.4, question: expect.stringMatching(/^Will Acme/) });
    expect(result.estimate).not.toHaveProperty("inputsUsed");
    expect(result.metrics.map((m) => m.id)).toEqual(["downloads:acme"]);
    expect(result).toMatchObject({ firmFigureCount: 0, companyPath: "/vc/companies/acme" });
    expect(s.repo.studies.size).toBe(0);
  });

  it("rejects outcomes the startup doesn't have, and members who can't propose", async () => {
    const s = setup();
    await expectCode(preview(s, users.analystA, modelLinkFor("startup_1", { metricId: "downloads:globex" })), "VALIDATION_ERROR");
    await expectCode(preview(s, users.viewerA), "FORBIDDEN");
  });
});

describe("opening line helpers", () => {
  it("rates confidence from the band, history and the firm's data", () => {
    expect(confidenceFor({ low: 0.3, high: 0.5, limitedHistory: false, usesFirmData: false })).toBe("high");
    expect(confidenceFor({ low: 0.3, high: 0.5, limitedHistory: false, usesFirmData: true })).toBe("medium");
    expect(confidenceFor({ low: 0.1, high: 0.7, limitedHistory: false, usesFirmData: false })).toBe("low");
    expect(confidenceFor({ low: 0.3, high: 0.5, limitedHistory: true, usesFirmData: false })).toBe("low");
  });

  it("keeps public values but drops the firm's", () => {
    const out = publicInputs([
      { metricId: "npm", provenance: "scraped", value: 5, sourceUrl: "https://x", note: "n" },
      { metricId: "sponsor_arr", provenance: "sponsor_provided", value: 9, sourceUrl: "sponsor-entry", note: "secret" },
    ]);
    expect(out[0]).toMatchObject({ value: 5 });
    expect(out[1]).not.toHaveProperty("value");
    expect(JSON.stringify(out)).not.toContain("secret");
  });
});
