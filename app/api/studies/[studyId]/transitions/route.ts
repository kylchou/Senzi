import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { transitionInput } from "@/lib/vc/validation";

/** POST /api/studies/:studyId/transitions — { action, reason?, expectedVersion } */
export const POST = withVc<{ studyId: string }>(async ({ req, params, ctx, services }) => {
  const input = await parseBody(req, transitionInput);
  return ok(await services.studies.transition(ctx, params.studyId, input));
});
