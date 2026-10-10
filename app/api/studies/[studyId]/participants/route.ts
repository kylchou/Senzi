import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { participantsInput } from "@/lib/vc/validation";

export const PUT = withVc<{ studyId: string }>(async ({ req, params, ctx, services }) => {
  const input = await parseBody(req, participantsInput);
  return ok(await services.studies.setParticipants(ctx, params.studyId, input));
});
