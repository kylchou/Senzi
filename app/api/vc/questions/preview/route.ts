import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { priceQuestion, structuredQuestionInput } from "@/lib/vc/server/company-model";
export const POST = withVc(async ({ ctx, req }) => ok(await priceQuestion(ctx, await parseBody(req, structuredQuestionInput))));
