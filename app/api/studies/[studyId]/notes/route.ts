import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { noteInput } from "@/lib/vc/validation";

type Params = { studyId: string };

/** GET /api/studies/:studyId/notes — private firm notes. */
export const GET = withVc<Params>(async ({ params, ctx, services }) =>
  ok(await services.studies.listNotes(ctx, params.studyId)),
);

/** POST /api/studies/:studyId/notes — { body } */
export const POST = withVc<Params>(async ({ req, params, ctx, services }) => {
  const { body } = await parseBody(req, noteInput);
  return ok(await services.studies.addNote(ctx, params.studyId, body), { status: 201 });
});
