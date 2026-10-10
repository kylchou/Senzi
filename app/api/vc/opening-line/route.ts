import { rateLimit } from "@/lib/rate-limit";
import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { openingLinePreviewInput } from "@/lib/vc/validation";

/** The AI suggestion and the model run together stay well inside this. */
export const maxDuration = 60;

/** Per-user limit on previews; each can call the AI once. */
const PREVIEW_RATE_LIMIT = { limit: 60, windowSeconds: 60 * 60 };

/**
 * POST /api/vc/opening-line — preview the model's opening line while drafting.
 * Body: { startupId, question, deadline, link?, observations? }
 * Without a link, the AI proposes how to measure the question; the model then
 * prices it, or answers "not enough data". Saves nothing: the study is priced
 * again on save and again when forecasting opens.
 */
export const POST = withVc(async ({ req, ctx, services }) => {
  const input = await parseBody(req, openingLinePreviewInput);
  await rateLimit(`vc-opening-line:${ctx.user.id}`, PREVIEW_RATE_LIMIT);
  return ok(await services.openingLine.preview(ctx, input));
});
