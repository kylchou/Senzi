import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { updateStudyInput } from "@/lib/vc/validation";
import { priceQuestion, structuredQuestionInput } from "@/lib/vc/server/company-model";
import { VcError } from "@/lib/vc/errors";

type Params = { studyId: string };

/** GET /api/studies/:studyId — study detail, permissions, estimate and history. */
export const GET = withVc<Params>(async ({ params, ctx, services }) =>
  ok(await services.studies.get(ctx, params.studyId)),
);

/** PATCH /api/studies/:studyId — edit a DRAFT study. Requires `expectedVersion`. */
export const PATCH = withVc<Params>(async ({ req, params, ctx, services }) => {
  const input = await parseBody(req, structuredQuestionInput);
  if (!input.expectedVersion) throw new VcError("VALIDATION_ERROR", "expectedVersion is required");
  const { study, permissions } = await services.studies.loadVisible(ctx, params.studyId);
  if (!permissions.canEdit || study.organizationId !== ctx.activeOrg?.organizationId) throw new VcError("FORBIDDEN", "Select the owning organization and an editable draft");
  const priced = await priceQuestion(ctx, input);
  return ok(await services.studies.update(ctx, params.studyId, updateStudyInput.parse({ ...priced.fields, expectedVersion: input.expectedVersion })));
});
