import { recordAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { assistantAskInput } from "@/lib/vc/validation";

/** A reasoning model can take a while; one automatic rewrite may follow the first answer. */
export const maxDuration = 60;

/** Per-user limit on Tyche questions. */
const TYCHE_RATE_LIMIT = { limit: 30, windowSeconds: 60 * 60 };

/**
 * POST /api/vc/assistant — ask Tyche about a study or comparison.
 * Body: { scope: { kind: "study", studyId } | { kind: "comparison", startupIds }, question, history? }
 * Returns the citation-checked answer. Signed-in users only; the evidence is
 * limited to what the caller can already see.
 */
export const POST = withVc(async ({ req, ctx, services }) => {
  const input = await parseBody(req, assistantAskInput);
  await rateLimit(`vc-assistant:${ctx.user.id}`, TYCHE_RATE_LIMIT);
  const result = await services.assistant.ask(ctx, input);

  // The question and how well the answer was grounded, not the answer itself.
  await recordAudit({
    actorId: ctx.user.id,
    organizationId: ctx.activeOrg?.organizationId ?? null,
    action: "assistant.ask",
    entityType: input.scope.kind === "study" ? "ResearchStudy" : "Startup",
    entityId: input.scope.kind === "study" ? input.scope.studyId : input.scope.startupIds.join(","),
    data: {
      question: input.question.slice(0, 500),
      model: result.model,
      grounded: result.answer.grounded,
      errors: result.answer.errorCount,
      warnings: result.answer.warningCount,
      repaired: result.repaired,
    },
  }).catch((err) => console.error("[tyche] audit failed", err));

  return ok(result);
});
