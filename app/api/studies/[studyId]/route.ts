import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { updateStudyInput } from "@/lib/vc/validation";

type Params = { studyId: string };

/** GET /api/studies/:studyId — study detail, permissions, estimate and history. */
export const GET = withVc<Params>(async ({ params, ctx, services }) =>
  ok(await services.studies.get(ctx, params.studyId)),
);

/** PATCH /api/studies/:studyId — edit a DRAFT study. Requires `expectedVersion`. */
export const PATCH = withVc<Params>(async ({ req, params, ctx, services }) => {
  const input = await parseBody(req, updateStudyInput);
  return ok(await services.studies.update(ctx, params.studyId, input));
});
