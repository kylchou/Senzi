import { ok, parseBody, parseQuery, withVc } from "@/lib/vc/server/http";
import { createStudyInput, studyListQuery } from "@/lib/vc/validation";
import { priceQuestion, structuredQuestionInput } from "@/lib/vc/server/company-model";

/** GET /api/studies?scope=organization|public|participating&status=OPEN */
export const GET = withVc(async ({ req, ctx, services }) => {
  const query = parseQuery(req, studyListQuery);
  return ok(await services.studies.list(ctx, query));
});

/** POST /api/studies — create a DRAFT study in the active organization. */
export const POST = withVc(async ({ req, ctx, services }) => {
  const priced = await priceQuestion(ctx, await parseBody(req, structuredQuestionInput));
  return ok(await services.studies.create(ctx, createStudyInput.parse(priced.fields)), { status: 201 });
});
