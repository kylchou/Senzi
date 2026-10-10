import { describe, expect, it } from "vitest";
import type { AssistantModel } from "../assistant/model";
import { parseSuggestion } from "../assistant/suggest-metric";
import { VcError } from "../errors";
import { confidenceFor, publicInputs } from "../opening-line";
import { createVcServices } from "../services";
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

function fakeAi(reply: string | Error): AssistantModel & { calls: number } {
  const ai = {
    name: "fake-ai",
    calls: 0,
    async complete() {
      ai.calls++;
      if (reply instanceof Error) throw reply;
      return { text: reply, finishReason: "stop", model: "fake-ai" };
    },
  };
  return ai;
}

const ARR_HISTORY = [
  { metricId: "sponsor_arr", value: 1_000_000, periodStart: "2026-07-01", periodEnd: "2026-07-01", note: "" },
  { metricId: "sponsor_arr", value: 1_200_000, periodStart: "2026-08-01", periodEnd: "2026-08-01", note: "" },
  { metricId: "sponsor_arr", value: 1_400_000, periodStart: "2026-09-01", periodEnd: "2026-09-01", note: "Board deck" },
];

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

  it("stores 'not enough data' for a question no metric measures, and keeps the typed wording", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput({ modelLink: null }));

    expect(study).toMatchObject({ question: "Will Acme raise a Series B by June 30, 2027?", baselineValue: null, baselineMethodology: null });
    expect((await s.repo.findModelEstimate(study.id))!).toMatchObject({ status: "NOT_MEASURABLE", link: null });
    const detail = await s.services.studies.get(users.analystA, study.id);
    expect(detail.openingLine?.notes[0]).toMatch(/Not enough data/);
  });

  it("rejects links the model can't price as asked", async () => {
    const s = setup();
    const create = (link: ReturnType<typeof modelLinkFor>) => s.services.studies.create(users.analystA, validStudyInput({ modelLink: link }));
    await expectCode(create(modelLinkFor("startup_1", { metricId: "downloads:globex" })), "VALIDATION_ERROR", /no metric/);
    await expectCode(create(modelLinkFor("startup_1", { targetDate: "2026-11-01" })), "VALIDATION_ERROR", /after the forecasting deadline/);
    await expectCode(
      create(modelLinkFor("startup_1", { observations: [{ ...ARR_HISTORY[0]! }] })),
      "VALIDATION_ERROR",
      /linked metric/,
    );
  });

  it("keeps a linked question's wording on edit, and frees it when the link is removed", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    const edited = await s.services.studies.update(users.analystA, study.id, { question: "Will Acme do great things soon?", expectedVersion: 1 });
    expect(edited.question).toBe(study.question);

    const unlinked = await s.services.studies.update(users.analystA, study.id, {
      question: "Will Acme do great things soon?",
      modelLink: null,
      expectedVersion: 2,
    });
    expect(unlinked).toMatchObject({ question: "Will Acme do great things soon?", baselineValue: null });
    expect((await s.repo.findModelEstimate(study.id))!.status).toBe("NOT_MEASURABLE");
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
  it("blocks opening when no metric measures the question", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput({ modelLink: null }));
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

  it("never sends the firm's own figures to the shared market tables", async () => {
    const s = setup();
    const study = await s.services.studies.create(
      users.analystA,
      validStudyInput({ modelLink: { metricId: "sponsor_arr", threshold: 2_000_000, targetDate: "2027-01-15", observations: ARR_HISTORY } }),
    );
    expect(study.baselineValue).toBe(0.4);
    const version = await approve(s, study.id);
    await s.services.studies.transition(users.admin, study.id, { action: "open", expectedVersion: version });

    const used = s.platform.state.createdMarkets[0]!.input.model.inputsUsed;
    expect(used).toHaveLength(3);
    expect(used.every((p) => !("value" in p))).toBe(true);
    expect(JSON.stringify(used)).not.toContain("Board deck");
  });

  it("shows the firm's figures only to the firm", async () => {
    const s = setup();
    const study = await s.services.studies.create(
      users.analystA,
      validStudyInput({
        visibility: "PUBLIC",
        modelLink: { metricId: "sponsor_arr", threshold: 2_000_000, targetDate: "2027-01-15", observations: ARR_HISTORY },
      }),
    );
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
});

describe("draft preview", () => {
  const preview = (s: ReturnType<typeof setup>, ai: AssistantModel | null, extra: object = {}) =>
    createVcServices(s.deps, { assistantModel: ai }).openingLine.preview(users.analystA, {
      startupId: "startup_1",
      question: "Will Acme's downloads pass 50k a week by mid January?",
      deadline: new Date(NOW.getTime() + 60 * DAY),
      observations: [],
      ...extra,
    });

  it("has the AI propose a measurable form, then prices it", async () => {
    const s = setup();
    const ai = fakeAi('Sure: {"metricId":"downloads:acme","threshold":50000,"targetDate":"2027-01-15","reason":"Weekly downloads measure this."}');
    const result = await preview(s, ai);
    expect(result.suggestion).toEqual({ link: { metricId: "downloads:acme", threshold: 50_000, targetDate: "2027-01-15" }, reason: "Weekly downloads measure this." });
    expect(result.estimate).toMatchObject({ status: "OK", probability: 0.4 });
    expect(result.estimate).not.toHaveProperty("inputsUsed");
    expect(result.metrics.map((m) => m.id)).toEqual(["downloads:acme", "sponsor_arr"]);
  });

  it("says not enough data when no metric measures the question", async () => {
    const s = setup();
    const result = await preview(s, fakeAi('{"metricId":null,"threshold":null,"targetDate":null,"reason":"Funding rounds aren\'t in the model\'s data."}'));
    expect(result).toMatchObject({ suggestion: null, suggestionNote: "Funding rounds aren't in the model's data.", estimate: { status: "NOT_MEASURABLE" } });
  });

  it("skips the AI when the firm picked the metric, and copes when the AI is down or not set up", async () => {
    const s = setup();
    const ai = fakeAi("unused");
    const picked = await preview(s, ai, { link: { metricId: "downloads:acme", threshold: 60_000, targetDate: "2027-01-15" } });
    expect(ai.calls).toBe(0);
    expect(picked.estimate.status).toBe("OK");

    expect((await preview(s, fakeAi(new Error("timeout")))).suggestionNote).toMatch(/isn't available right now/);
    expect((await preview(s, null)).suggestionNote).toMatch(/isn't set up/);
  });

  it("is limited to members who can propose studies", async () => {
    const s = setup();
    await expectCode(
      createVcServices(s.deps).openingLine.preview(users.viewerA, {
        startupId: "startup_1",
        question: "Will Acme grow?",
        deadline: new Date(NOW.getTime() + 60 * DAY),
        observations: [],
      }),
      "FORBIDDEN",
    );
  });
});

describe("AI suggestion parsing", () => {
  const metrics = [{ id: "downloads:acme", label: "weekly downloads", unit: "downloads", kind: "weekly_total" as const, hasPublicData: true }];
  const deadline = new Date("2026-12-01T00:00:00Z");

  it("accepts only listed metrics, real dates after the deadline, and a threshold", () => {
    const ok = '{"metricId":"downloads:acme","threshold":5,"targetDate":"2027-01-15","reason":"r"}';
    expect(parseSuggestion(ok, metrics, deadline).link).not.toBeNull();
    expect(parseSuggestion(ok.replace("downloads:acme", "downloads:other"), metrics, deadline).link).toBeNull();
    expect(parseSuggestion(ok.replace("2027-01-15", "2026-11-15"), metrics, deadline).link).toBeNull();
    expect(parseSuggestion(ok.replace("2027-01-15", "2027-02-30"), metrics, deadline).link).toBeNull();
    expect(parseSuggestion(ok.replace('"threshold":5', '"threshold":null'), metrics, deadline).link).toBeNull();
    expect(parseSuggestion("I think downloads.", metrics, deadline).link).toBeNull();
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
