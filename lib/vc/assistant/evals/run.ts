/**
 * Runs the Tyche eval against the real Meta Model API.
 *
 *   npx tsx --env-file=.env.local lib/vc/assistant/evals/run.ts [--only=case-id] [--out=results.json] [--min=0.9]
 *
 * Every case is one real request (two if the answer needs its automatic
 * rewrite), so a full run costs money. It goes through the same service as the
 * app, then grades each answer deterministically (grade.ts).
 */
import { writeFileSync } from "node:fs";
import { createMetaMuseModel, tycheApiKey } from "../../server/meta-muse";
import { createAssistantService } from "../../services/assistant";
import type { AssistantContextService } from "../../services/assistant-context";
import type { VcContext } from "../../types";
import { EVAL_CASES } from "./cases";
import { FIXTURES } from "./fixtures";
import { gradeAnswer, type Grade } from "./grade";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

async function main() {
  const apiKey = tycheApiKey();
  if (!apiKey) {
    console.error("Set SENZI_AI_ASSISTANT_API_KEY (e.g. run with --env-file=.env.local).");
    process.exit(2);
  }
  const model = createMetaMuseModel({ apiKey, model: process.env.SENZI_AI_ASSISTANT_MODEL?.trim() || undefined });
  const only = arg("only");
  const cases = EVAL_CASES.filter((c) => !only || c.id === only);
  const ctx: VcContext = {
    user: { id: "eval", name: "Eval", email: null, isPlatformAdmin: false },
    memberships: [],
    activeOrg: null,
  };

  const results: (Grade & { answer: string; repaired: boolean })[] = [];
  for (const c of cases) {
    const pkg = FIXTURES[c.fixture]();
    // The real service, with the fixture package standing in for the database.
    const contextService = {
      tier: "standard",
      forStudy: async () => pkg,
      forComparison: async () => pkg,
    } as unknown as AssistantContextService;
    const tyche = createAssistantService({ assistantContext: contextService }, model);
    try {
      const r = await tyche.ask(ctx, { scope: { kind: "study", studyId: c.fixture }, question: c.question, history: [] });
      const grade = gradeAnswer(r.raw, pkg, c);
      results.push({ ...grade, answer: r.raw, repaired: r.repaired });
      console.log(`${grade.pass ? "PASS" : "FAIL"}  ${c.id}${r.repaired ? "  (rewritten once)" : ""}`);
      for (const check of grade.checks.filter((x) => !x.pass)) console.log(`        ✗ ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
    } catch (err) {
      results.push({ caseId: c.id, pass: false, checks: [{ name: "request", pass: false, detail: String(err) }], answer: "", repaired: false });
      console.log(`ERROR ${c.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const rate = results.length ? passed / results.length : 0;
  console.log(`\n${passed}/${results.length} passed (${Math.round(rate * 100)}%) on ${model.name}`);
  const out = arg("out");
  if (out) {
    writeFileSync(out, JSON.stringify({ model: model.name, ranAt: new Date().toISOString(), passed, total: results.length, results }, null, 2));
    console.log(`Wrote ${out}`);
  }
  process.exit(rate >= Number(arg("min") ?? 0.9) ? 0 : 1);
}

void main();
