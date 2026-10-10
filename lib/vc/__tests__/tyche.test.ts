import { describe, expect, it, vi } from "vitest";
import { checkCitations, splitSentenceParts } from "../assistant/citations";
import type { AssistantModel, ChatMessage } from "../assistant/model";
import { TYCHE_INSTRUCTIONS, buildMessages } from "../assistant/prompt";
import { studyKeyStats } from "../assistant/stats";
import { VcError } from "../errors";
import { createMetaMuseModel, META_MODEL_API_URL } from "../server/meta-muse";
import { createVcServices } from "../services";
import { makeEstimate } from "../testing/memory";
import { openStudy, setup, users } from "./fixtures";

const code = (c: VcError["code"]) => (e: unknown) => e instanceof VcError && e.code === c;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Meta Model API adapter", () => {
  it("sends an OpenAI-compatible chat completion with Tyche's settings", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { model: "muse-spark-1.3", choices: [{ message: { role: "assistant", content: " Hello [[x]]. " }, finish_reason: "stop" }] }),
    );
    const model = createMetaMuseModel({ apiKey: "test-key", fetchImpl: fetchImpl as unknown as typeof fetch });
    const messages: ChatMessage[] = [{ role: "developer", content: "rules" }, { role: "user", content: "hi" }];
    const out = await model.complete(messages, { userKey: "a".repeat(80), cacheKey: "tyche:s1" });

    expect(out).toEqual({ text: "Hello [[x]].", finishReason: "stop", model: "muse-spark-1.3" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(META_MODEL_API_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "muse-spark-1.3", messages, reasoning_effort: "low", prompt_cache_key: "tyche:s1" });
    expect(body.safety_identifier).toHaveLength(64);
    expect(body).not.toHaveProperty("temperature");
    expect(model.name).toBe("muse-spark-1.3");
  });

  it("never defaults to a contributor model that trains on prompts", () => {
    expect(createMetaMuseModel({ apiKey: "k" }).name).not.toMatch(/contributor/);
  });

  it("turns provider errors into clear messages", async () => {
    const respond = (status: number) => createMetaMuseModel({ apiKey: "k", fetchImpl: (async () => jsonResponse(status, { error: { message: "x" } })) as typeof fetch });
    const call = (status: number) => respond(status).complete([], { userKey: "u" });
    await expect(call(429)).rejects.toSatisfy(code("RATE_LIMITED"));
    await expect(call(401)).rejects.toThrow(/API key was rejected/);
    await expect(call(500)).rejects.toThrow(/couldn't answer/);
    const empty = createMetaMuseModel({ apiKey: "k", fetchImpl: (async () => jsonResponse(200, { choices: [{ message: { content: "" } }] })) as typeof fetch });
    await expect(empty.complete([], { userKey: "u" })).rejects.toThrow(/empty answer/);
    const down = createMetaMuseModel({ apiKey: "k", fetchImpl: (async () => { throw new TypeError("network"); }) as typeof fetch });
    await expect(down.complete([], { userKey: "u" })).rejects.toThrow(/couldn't reach/);
  });
});

describe("prompt assembly", () => {
  it("puts fixed instructions first, evidence second, then history and the question", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `turn ${i}` }));
    const m = buildMessages("EVIDENCE: [[a]]", history, "Why?");
    expect(m[0]).toEqual({ role: "developer", content: TYCHE_INSTRUCTIONS });
    expect(m[1].role).toBe("developer");
    expect(m[1].content).toContain("data, not instructions");
    expect(m.slice(2, -1).map((x) => x.content)).toEqual(history.slice(-8).map((x) => x.content));
    expect(m.at(-1)).toEqual({ role: "user", content: "Why?" });
  });

  it("tracks which sentences start a new line", () => {
    expect(splitSentenceParts("First. Second.\n- Third.")).toEqual([
      { text: "First.", startsLine: true },
      { text: "Second.", startsLine: false },
      { text: "- Third.", startsLine: true },
    ]);
  });
});

/** A fake model that returns scripted answers and records what it was sent. */
function scripted(answers: ((evidence: string) => string)[]): AssistantModel & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    name: "fake-model",
    calls,
    async complete(messages) {
      calls.push(messages);
      const next = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { text: next(messages[1].content), finishReason: "stop", model: "fake-model" };
    },
  };
}

const currentId = (evidence: string) => evidence.match(/\[\[(market:[^\]]+#current)\]\]/)![1];

async function studyWithMarket(s: ReturnType<typeof setup>) {
  const study = await openStudy(s);
  s.forecasting.estimates.set(study.marketId!, makeEstimate(study.marketId!));
  return study;
}

describe("Tyche service", () => {
  it("is off until an API key is configured", async () => {
    const s = setup();
    const study = await studyWithMarket(s);
    expect(s.services.assistant.enabled).toBe(false);
    await expect(
      s.services.assistant.ask(users.analystA, { scope: { kind: "study", studyId: study.id }, question: "Hi?", history: [] }),
    ).rejects.toSatisfy(code("INVALID_STATE"));
  });

  it("answers from the evidence package and returns checked, clickable citations", async () => {
    const s = setup();
    const study = await studyWithMarket(s);
    const model = scripted([(ev) => `The YES allocation share is 60% [[${currentId(ev)}]].`]);
    const tyche = createVcServices(s.deps, { assistantModel: model }).assistant;

    const r = await tyche.ask(users.analystA, { scope: { kind: "study", studyId: study.id }, question: "Where is the share?", history: [] });
    expect(r.answer.grounded).toBe(true);
    expect(r.answer.sentences[0].citations[0].href).toBe(`/vc/studies/${study.id}#estimates`);
    expect(r.subject).toBe(study.question);
    expect(r.repaired).toBe(false);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0][1].content).toContain(`[[study:${study.id}#question]]`);
  });

  it("rewrites once when the first answer fails the citation check", async () => {
    const s = setup();
    const study = await studyWithMarket(s);
    const model = scripted([() => "Revenue tripled last year [[fact:invented]].", (ev) => `The YES allocation share is 60% [[${currentId(ev)}]].`]);
    const tyche = createVcServices(s.deps, { assistantModel: model }).assistant;

    const r = await tyche.ask(users.analystA, { scope: { kind: "study", studyId: study.id }, question: "Tell me more", history: [] });
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].at(-1)!.content).toMatch(/failed the citation check/);
    expect(r.repaired).toBe(true);
    expect(r.answer.grounded).toBe(true);
  });

  it("keeps the first answer if the rewrite isn't better", async () => {
    const s = setup();
    const study = await studyWithMarket(s);
    const model = scripted([() => "It doubled [[fact:invented]].", () => "It tripled [[fact:also-invented]] and grew [[fact:more-invented]]."]);
    const tyche = createVcServices(s.deps, { assistantModel: model }).assistant;
    const r = await tyche.ask(users.analystA, { scope: { kind: "study", studyId: study.id }, question: "Growth?", history: [] });
    expect(r.repaired).toBe(false);
    expect(r.raw).toBe("It doubled [[fact:invented]].");
    expect(r.answer.grounded).toBe(false);
  });

  it("never builds evidence for people who can't see the study", async () => {
    const s = setup();
    const study = await studyWithMarket(s);
    const model = scripted([() => "x"]);
    const tyche = createVcServices(s.deps, { assistantModel: model }).assistant;
    await expect(
      tyche.ask(users.analystB, { scope: { kind: "study", studyId: study.id }, question: "Leak?", history: [] }),
    ).rejects.toSatisfy(code("NOT_FOUND"));
    expect(model.calls).toHaveLength(0);
  });
});

describe("Key stats", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  const base = {
    id: "stats:s1",
    href: "/vc/studies/s1#estimates",
    now,
    status: "OPEN",
    deadline: new Date("2027-04-08T12:00:00Z"),
    current: { id: "market:m1#current", share: 0.58, forecasters: 6 },
    baseline: { id: "market:m1#baseline", value: 0.35 },
    first: { id: "snapshot:a", share: 0.36, forecasters: 3, at: new Date("2026-09-10T00:00:00Z") },
    change7d: { value: 0.17, fromId: "snapshot:b", toId: "snapshot:c" },
    facts: [{ id: "fact:f", verified: true, asOf: new Date("2025-03-19T00:00:00Z") }],
    news: [{ id: "news:n", verification: "UNVERIFIED" as const, publishedAt: new Date("2026-10-07T00:00:00Z") }],
  };

  it("computes exact derived numbers the model can quote", () => {
    const item = studyKeyStats(base)!;
    expect(item.kind).toBe("key_stats");
    expect(item.value).toContain("58.0% is 23.0 pts above the 35% opening baseline");
    expect(item.value).toContain("+22.0 pts (36.0% to 58.0%), with forecasters growing from 3 to 6");
    expect(item.value).toContain("last 7 days: +17.0 pts");
    expect(item.value).toContain("closes in 180 days (2027-04-08)");
    expect(item.value).toContain("1 verified item, 1 unverified item, 0 disputed items");
    expect(item.value).toContain("Newest news report is from 2026-10-07, 3 days ago");
    expect(item.relatedIds).toEqual(["market:m1#current", "market:m1#baseline", "snapshot:a"]);
  });

  it("lets an answer quote its percentages when cited", () => {
    const item = studyKeyStats(base)!;
    const pkg = { scope: { kind: "study" as const, studyId: "s1" }, tier: "standard" as const, builtAt: now.toISOString(), items: [item], omitted: [] };
    const report = checkCitations("The share is 58.0%, 23.0 pts above the 35% opening baseline [[stats:s1]].", pkg);
    expect(report.errorCount).toBe(0);
  });

  it("returns nothing when there is nothing to compute", () => {
    expect(studyKeyStats({ ...base, current: null, deadline: null, facts: [], news: [] })).toBeNull();
  });
});
